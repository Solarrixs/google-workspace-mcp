import { describe, it, expect } from 'vitest';
import {
  extractEmailAddresses,
  stripHtmlTags,
  stripQuotedText,
  stripSignature,
  getHeader,
} from '../src/gmail/threads.js';

describe('Email Security Attack Tests', () => {
  describe('1. Emoji and Spoofing Pattern Validation', () => {
    it('should handle ✉️ emoji in email display names', () => {
      const input = '✉️ Important Notification <noreply@example.com>';
      const result = extractEmailAddresses(input);
      expect(result).toEqual(['noreply@example.com']);
    });

    it('should handle multiple emojis in display names', () => {
      const input = '🔴🟢🔵 📧 Test <test@example.com>';
      const result = extractEmailAddresses(input);
      expect(result).toEqual(['test@example.com']);
    });

    it('should handle emoji-like characters in local part', () => {
      const input = 'tes✉️t@example.com, another@example.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(2);
      expect(result[0]).toContain('example.com');
    });

    it('should detect spoofing patterns with lookalike characters', () => {
      const input = 'PayPal Security <noreply@paypa1.com>';
      const result = extractEmailAddresses(input);
      expect(result).toEqual(['noreply@paypa1.com']);
    });

    it('should handle homograph attacks (unicode lookalikes)', () => {
      const input = 'Admin <admin@ɡoogle.com>'; // g is actually U+0261 Latin small letter script g
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
      expect(result[0]).toContain('ɡoogle.com');
    });

    it('should handle IDN (Internationalized Domain Names)', () => {
      const input = 'Test <test@例子.测试>';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle spoofed sender with legitimate-looking domain', () => {
      const input = '"Security Team" <security@googIe.com>'; // Capital I instead of l
      const result = extractEmailAddresses(input);
      expect(result).toEqual(['security@googIe.com']);
    });
  });

  describe('2. Malicious Email Address Extraction', () => {
    it('should handle email with SQL injection pattern', () => {
      const input = 'user@\' OR 1=1 --.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with XSS payload', () => {
      const input = '<script>alert(1)</script>@evil.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with command injection', () => {
      const input = 'test@$(rm -rf /).com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with null byte injection', () => {
      const input = 'test%00@example.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with path traversal pattern', () => {
      const input = '../../../etc/passwd@evil.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle extremely long email addresses (DoS attempt)', () => {
      const localPart = 'a'.repeat(300);
      const input = `${localPart}@example.com`;
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with multiple @ symbols', () => {
      const input = 'test@@example.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with special characters in name', () => {
      const input = '"Test; rm -rf /; <test@example.com>" <test@example.com>';
      const result = extractEmailAddresses(input);
      expect(result).toEqual(['test@example.com']);
    });

    it('should handle email with comment injection', () => {
      const input = 'test(comment)@example.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(1);
    });

    it('should handle email with Unicode normalization bypass', () => {
      const input = 'tést@example.com, test@example.com';
      const result = extractEmailAddresses(input);
      expect(result).toHaveLength(2);
    });
  });

  describe('3. Quote Stripping Bypass Attempts', () => {
    it('should bypass quote detection with extra whitespace', () => {
      const input = 'Original text\n\n\n\nOn Mon, Jan 1, 2026 at 10:00 AM, someone wrote:\nQuoted text';
      const result = stripQuotedText(input);
      expect(result).toContain('Original text');
      expect(result).not.toContain('Quoted text');
    });

    it('should bypass quote detection with unusual date format', () => {
      const input = 'Original\nOn 1st January 2026, at 10:00, Test wrote:\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with missing comma', () => {
      const input = 'Original\nOn Mon Jan 1 2026 at 10:00 AM Test wrote:\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with HTML tags', () => {
      const input = 'Original\n<br>On Mon, Jan 1, 2026 at 10:00 AM wrote:<br>Quoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with encoded entities', () => {
      const input = 'Original\nOn Mon, Jan 1, 2026 at 10:00 AM&nbsp;wrote:\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with "wrote:" variations', () => {
      const input = 'Original\nOn Mon, Jan 1, 2026 at 10:00 AM saïd:\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with unicode wrote', () => {
      const input = 'Original\nOn Mon, Jan 1, 2026 at 10:00 AM wrоte:\nQuoted'; // Cyrillic o
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with different quote marker', () => {
      const input = 'Original\n--- Forwarded message ---\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with styled wrote', () => {
      const input = 'Original\nOn Mon, Jan 1, 2026 at 10:00 AM *wrote*:\nQuoted';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });

    it('should bypass quote detection with nested quotes', () => {
      const input = 'Original\n\nOn Mon, Jan 1, 2026 at 10:00 AM wrote:\n> Quoted\n> On Sun wrote:\n> > Nested';
      const result = stripQuotedText(input);
      expect(result).toContain('Original');
    });
  });

  describe('4. Signature Detection Bypass with Complex Delimiters', () => {
    it('should bypass signature detection with 📧 emoji', () => {
      const input = 'Hello World\n\n📧\nSignature text';
      const result = stripSignature(input);
      expect(result).toContain('Hello World');
    });

    it('should bypass signature detection with multiple dashes', () => {
      const input = 'Hello\n---\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass signature detection with emoji dash', ()      => {
      const input = 'Hello\n——\nSignature'; // em dash variation
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass signature detection with unicode dashes', () => {
      const input = 'Hello\n―\nSignature'; // U+2015 horizontal bar
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass with 3 underscores instead of 4', () => {
      const input = 'Hello\n___\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass with *** delimiter', () => {
      const input = 'Hello\n***\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass with +++ delimiter', () => {
      const input = 'Hello\n+++\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass with === delimiter', () => {
      const input = 'Hello\n===\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass with ### delimiter', () => {
      const input = 'Hello\n###\nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Hello');
    });

    it('should bypass signature detection with sign-off variations', () => {
      const input = 'Content\n\nBest Wishes,\nName\nTitle';
      const result = stripSignature(input);
      expect(result).toContain('Content');
    });

    it('should bypass with "From" in signature', () => {
      const input = 'Content\n\n-- \nFrom: Me\nTo: You';
      const result = stripSignature(input);
      expect(result).not.toContain('From: Me');
    });

    it('should bypass with encoded signature delimiter', () => {
      const input = 'Content\n\n&#45;&#45; \nSignature';
      const result = stripSignature(input);
      expect(result).toContain('Content');
    });

    it('should bypass with non-standard mobile signature', () => {
      const input = 'Content\n\nSent from my OnePlus phone';
      const result = stripSignature(input);
      expect(result).toContain('Content');
    });

    it('should bypass with legal notice variations', () => {
      const input = 'Content\n\nCONFIDENTIAL\nThis is confidential';
      const result = stripSignature(input);
      expect(result).toContain('Content');
    });
  });

  describe('5. HTML Entity Injection in Headers', () => {
    it('should handle HTML entities in header values', () => {
      const headers = [
        { name: 'From', value: '&lt;script&gt;alert(1)&lt;/script&gt;' },
        { name: 'To', value: 'test@example.com' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toContain('&lt;');
    });

    it('should handle mixed entities and text in headers', () => {
      const headers = [
        { name: 'Subject', value: 'Hello &amp; world &lt;test&gt;' }
      ];
      const result = getHeader(headers as any, 'Subject');
      expect(result).toContain('&amp;');
    });

    it('should handle unicode characters in header names', () => {
      const headers = [
        { name: 'From', value: 'test@example.com' },
        { name: 'Frøm', value: 'other@example.com' } // unicode o
      ];
      const normal = getHeader(headers as any, 'From');
      const unicode = getHeader(headers as any, 'Frøm');
      expect(normal).toBe('test@example.com');
      expect(unicode).toBe('other@example.com');
    });

    it('should handle null bytes in header values', () => {
      const headers = [
        { name: 'From', value: 'test\x00@example.com' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toContain('\x00');
    });

    it('should handle multiline header values', () => {
      const headers = [
        { name: 'From', value: 'test@example.com\r\nInjected: header' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toContain('\r\n');
    });

    it('should handle header injection attempts', () => {
      const headers = [
        { name: 'From', value: 'test@example.com\r\nBcc: victim@example.com' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toContain('\r\n');
      expect(result).toContain('Bcc:');
    });

    it('should handle extremely long header values', () => {
      const longValue = 'a'.repeat(10000);
      const headers = [
        { name: 'Subject', value: longValue }
      ];
      const result = getHeader(headers as any, 'Subject');
      expect(result.length).toBe(10000);
    });

    it('should handle undefined header value', () => {
      const headers = [
        { name: 'From' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toBe('');
    });

    it('should handle missing header', () => {
      const headers = [
        { name: 'From', value: 'test@example.com' }
      ];
      const result = getHeader(headers as any, 'To');
      expect(result).toBe('');
    });

    it('should handle case-insensitive header matching with unicode', () => {
      const headers = [
        { name: 'FROM', value: 'test@example.com' },
        { name: 'from', value: 'test2@example.com' }
      ];
      const result = getHeader(headers as any, 'From');
      expect(result).toStrictEqual('test@example.com');
    });
  });

  describe('Combined Attack Scenarios', () => {
    it('should handle phishing email with spoofed sender and malicious signature', () => {
      const headers = [
        { name: 'From', value: '🏦 Bank Security <security@banque.com>' }
      ];
      const body = 'URGENT: Verify your account now!\n\n📧\nClick here: http://evil.com/login';
      
      const from = getHeader(headers as any, 'From');
      const emails = extractEmailAddresses(from);
      const strippedBody = stripSignature(body);
      
      expect(emails).toHaveLength(1);
      expect(strippedBody).toContain('URGENT');
    });

    it('should handle email with XSS in body and HTML entities', () => {
      const html = '<div onclick="alert(1)">Click me</div>&lt;script&gt;evil&lt;/script&gt;';
      const result = stripHtmlTags(html);
      expect(result).toContain('Click me');
      expect(result).toContain('&lt;script&gt;');
    });

    it('should handle email with quote injection and signature bypass', () => {
      const text = 'New message\n\nOn Mon wrote:\nInjected quoted text\n\n📧\nFake signature';
      const result = stripQuotedText(text);
      const signature = stripSignature(result);
      expect(signature).toContain('New message');
    });

    it('should handle email with homograph attack in reply chain', () => {
      const quoted = 'On Mon at 10:00, admin@ɡoogle.com wrote:\nClick here to verify';
      const result = stripQuotedText(quoted);
      expect(result).toBe('[quoted reply only — no new content]');
    });
  });
});
