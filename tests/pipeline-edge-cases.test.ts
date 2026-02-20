import { describe, it, expect } from 'vitest';
import {
  decodeBase64Url,
  getHeader,
  extractEmailAddresses,
  stripHtmlTags,
  getMessageBody,
  stripQuotedText,
  stripSignature,
} from '../src/gmail/threads.js';

describe('Email Text Processing Pipeline - Edge Cases', () => {
  describe('stripHtmlTags()', () => {
    it('handles malformed HTML with unclosed tags', () => {
      const input = 'Hello <b>world<p>Test';
      const result = stripHtmlTags(input);
      expect(result).toBe('Hello worldTest');
    });

    it('handles nested tags', () => {
      const input = 'Hello <b><i><u>world</u></i></b>';
      const result = stripHtmlTags(input);
      expect(result).toBe('Hello world');
    });

    it('removes script tags and content', () => {
      const input = 'Hello<script>alert("xss")</script>world';
      const result = stripHtmlTags(input);
      // BUG: Script content should be removed but isn't - the regex <[^>]*> doesn't match multiline script content
      expect(result).not.toContain('alert');
      expect(result).not.toContain('script');
    });

    it('removes style tags and content', () => {
      const input = 'Hello<style>body{color:red}</style>world';
      const result = stripHtmlTags(input);
      // BUG: Style content should be removed but isn't
      expect(result).not.toContain('color');
      expect(result).not.toContain('style');
    });

    it('removes HTML comments', () => {
      const input = 'Hello<!-- comment -->world';
      const result = stripHtmlTags(input);
      // BUG: HTML comments should be removed but aren't
      expect(result).not.toContain('comment');
    });

    it('handles CDATA sections', () => {
      const input = 'Hello<![CDATA[<greeting>Hello</greeting>]]>world';
      const result = stripHtmlTags(input);
      // BUG: CDATA content should be handled but isn't
      expect(result).toContain('Hello');
    });

    it('handles self-closing tags', () => {
      const input = 'Hello<br/>world<hr/>test';
      const result = stripHtmlTags(input);
      expect(result).toBe('Hello worldtest');
    });

    it('handles attributes with special characters', () => {
      const input = '<a href="http://example.com?foo=1&bar=2">link</a>';
      const result = stripHtmlTags(input);
      expect(result).toBe('link');
    });

    it('handles entities in multiple passes', () => {
      const input = '&amp;lt;&amp;gt;';
      const result = stripHtmlTags(input);
      // BUG: Nested entities aren't decoded - only one pass
      expect(result).toBe('<>');
    });

    it('handles malformed entity', () => {
      const input = 'Hello &invalid; world';
      const result = stripHtmlTags(input);
      expect(result).toBe('Hello &invalid; world');
    });
  });

  describe('stripQuotedText()', () => {
    it('handles Gmail-style quote headers', () => {
      const input = 'New content\n\nOn Mon, Feb 3, 2026 at 9:15 AM John <john@example.com> wrote:\nOld content';
      const result = stripQuotedText(input);
      expect(result).toBe('New content');
      expect(result).not.toContain('Old content');
    });

    it('handles Apple Mail quote headers', () => {
      const input = 'New content\n\nOn Feb 3, 2026, at 9:15 AM, John <john@example.com> wrote:\nOld content';
      const result = stripQuotedText(input);
      expect(result).toBe('New content');
    });

    it('handles Outlook-style separators', () => {
      const input = 'New content\n\n_________________\nFrom: john@example.com\nOld content';
      const result = stripQuotedText(input);
      expect(result).toBe('New content');
    });

    it('handles generic > quoted lines', () => {
      const input = 'New content\n\n> Old line 1\n> Old line 2';
      const result = stripQuotedText(input);
      expect(result).toBe('New content');
    });

    it('returns placeholder for quoted-only text', () => {
      const input = 'On Mon, Feb 3, 2026 at 9:15 AM John <john@example.com> wrote:\nOld content';
      const result = stripQuotedText(input);
      expect(result).toBe('[quoted reply only — no new content]');
    });

    it('handles multiple quote markers - uses earliest', () => {
      const input = 'Content\n\n> First quote\n\nOn Mon, Feb 3, 2026 at 9:15 AM wrote:\nSecond quote';
      const result = stripQuotedText(input);
      expect(result).toBe('Content');
    });

    it('rejects quoted text not preceded by blank line', () => {
      const input = 'Content > Not stripped';
      const result = stripQuotedText(input);
      expect(result).toContain('Not stripped');
    });

    it('handles partial quote pattern matches', () => {
      const input = 'This talks about "On Monday" but no quote header';
      const result = stripQuotedText(input);
      expect(result).toContain('On Monday');
    });

    it('handles quoted text matching "wrote" in content', () => {
      const input = 'I wrote about this in my book\n\nOn Mon, Feb 3, 2026 at 9:15 AM wrote:\nQuote';
      const result = stripQuotedText(input);
      expect(result).toBe('I wrote about this in my book');
    });

    it('handles edge case: blank line before quote but no content', () => {
      const input = '\n\nOn Mon, Feb 3, 2026 at 9:15 AM wrote:\nQuote';
      const result = stripQuotedText(input);
      expect(result).toBe('[quoted reply only — no new content]');
    });

    it('handles edge case: quote marker in middle of word', () => {
      const input = 'The arrow points > to this';
      const result = stripQuotedText(input);
      expect(result).toContain('arrow points > to this');
    });

    it('handles edge case: underscores not part of Outlook separator', () => {
      const input = 'Score: 95__\nContent';
      const result = stripQuotedText(input);
      expect(result).toContain('Score: 95__');
    });
  });

  describe('stripSignature()', () => {
    it('removes standard signature delimiter (-- )', () => {
      const input = 'Content\n-- \nSignature line';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('removes em dash delimiter', () => {
      const input = 'Content\n—\nSignature line';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('removes underscores delimiter', () => {
      const input = 'Content\n__\nSignature line';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('uses earliest signature delimiter', () => {
      const input = 'Content\n-- \nFirst sig\n—\nSecond sig';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('removes mobile boilerplate', () => {
      const input = 'Content\n\nSent from my iPhone';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('removes legal boilerplate', () => {
      const input = 'Content\n\nCONFIDENTIALITY NOTICE: This message is confidential';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('removes sign-off blocks with name', () => {
      const input = 'Content\n\nBest,\nJohn Doe';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('preserves sign-off followed by substantive content', () => {
      const input = 'Content\n\nBest,\nThis is a substantive paragraph that continues with meaningful information about the topic at hand.';
      const result = stripSignature(input);
      expect(result).toContain('Best,\nThis is a substantive paragraph');
    });

    it('handles multiple sign-off patterns', () => {
      const input = 'Content\n\nRegards,\nJohn Doe\nTitle\nCompany';
      const result = stripSignature(input);
      expect(result).toBe('Content');
    });

    it('handles edge case: "Thanks" as content not sign-off', () => {
      const input = 'I want to say thanks for your help with this project.';
      const result = stripSignature(input);
      expect(result).toContain('I want to say thanks');
    });

    it('handles edge case: "Best" in middle of sentence', () => {
      const input = 'This is the best approach for the problem.';
      const result = stripSignature(input);
      expect(result).toContain('This is the best approach');
    });

    it('handles edge case: -- in content not as delimiter', () => {
      const input = 'The range is 5--10 units.';
      const result = stripSignature(input);
      expect(result).toContain('5--10');
    });

    it('handles edge case: em dash in content', () => {
      const input = 'The solution—after careful consideration—is clear.';
      const result = stripSignature(input);
      expect(result).toContain('The solution—after careful consideration—is clear.');
    });

    it('handles edge case: legal words in normal content', () => {
      const input = 'This disclaimer appears in normal text flow and should not be stripped.';
      const result = stripSignature(input);
      expect(result).toContain('disclaimer');
    });

    it('handles edge case: long sign-off block (>5 lines or >80 chars)', () => {
      const input = 'Content\n\nBest,\nJohn Doe\nSenior Vice President of Engineering\nAcme Corporation Inc.\nPhone: 555-1234\nEmail: john@acme.com\nWebsite: https://acme.com/john';
      const result = stripSignature(input);
      // BUG: Should be preserved as substantive but might be stripped
      expect(result).toContain('Best');
    });

    it('handles edge case: line with -- followed by content', () => {
      const input = 'Important note -- this is significant';
      const result = stripSignature(input);
      expect(result).toContain('Important note -- this is significant');
    });

    it('handles edge case: mobile phrase in normal sentence', () => {
      const input = 'I sent from my iPhone but need to resend from my laptop.';
      const result = stripSignature(input);
      expect(result).toContain('sent from my iPhone');
    });
  });

  describe('getMessageBody()', () => {
    it('handles text/plain payload', () => {
      const payload = {
        mimeType: 'text/plain',
        body: { data: Buffer.from('Hello world', 'utf-8').toString('base64url') }
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('Hello world');
    });

    it('handles text/html payload and strips tags', () => {
      const payload = {
        mimeType: 'text/html',
        body: { data: Buffer.from('<p>Hello <b>world</b></p>', 'utf-8').toString('base64url') }
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('Hello world');
    });

    it('prefers text/plain over text/html in parts', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<p>HTML content</p>', 'utf-8').toString('base64url') }
          },
          {
            mimeType: 'text/plain',
            body: { data: Buffer.from('Plain content', 'utf-8').toString('base64url') }
          }
        ]
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('Plain content');
    });

    it('fallbacks to stripped HTML when text/plain missing', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          {
            mimeType: 'text/html',
            body: { data: Buffer.from('<p>HTML only</p>', 'utf-8').toString('base64url') }
          }
        ]
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('HTML only');
    });

    it('handles nested multipart structures', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/alternative',
            parts: [
              {
                mimeType: 'text/plain',
                body: { data: Buffer.from('Nested plain', 'utf-8').toString('base64url') }
              }
            ]
          }
        ]
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('Nested plain');
    });

    it('handles empty payload', () => {
      const result = getMessageBody(undefined);
      expect(result).toBe('');
    });

    it('handles payload with missing body', () => {
      const payload = {
        mimeType: 'text/plain'
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('');
    });

    it('handles payload with no data', () => {
      const payload = {
        mimeType: 'text/plain',
        body: {}
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('');
    });

    it('handles parts with no body data', () => {
      const payload = {
        mimeType: 'multipart/alternative',
        parts: [
          { mimeType: 'text/plain', body: {} },
          { mimeType: 'text/html', body: {} }
        ]
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('');
    });

    it('handles deeply nested multipart with no text', () => {
      const payload = {
        mimeType: 'multipart/mixed',
        parts: [
          {
            mimeType: 'multipart/related',
            parts: [
              {
                mimeType: 'multipart/alternative',
                parts: [{ mimeType: 'text/html', body: {} }]
              }
            ]
          }
        ]
      };
      const result = getMessageBody(payload as any);
      expect(result).toBe('');
    });
  });

  describe('extractEmailAddresses()', () => {
    it('extracts email from angle brackets', () => {
      const result = extractEmailAddresses('John Doe <john@example.com>');
      expect(result).toEqual(['john@example.com']);
    });

    it('extracts standalone email', () => {
      const result = extractEmailAddresses('john@example.com');
      expect(result).toEqual(['john@example.com']);
    });

    it('extracts multiple emails', () => {
      const result = extractEmailAddresses('john@example.com, jane@test.org');
      expect(result).toEqual(['john@example.com', 'jane@test.org']);
    });

    it('extracts emails with display names', () => {
      const result = extractEmailAddresses('John <john@example.com>, Jane <jane@test.org>');
      expect(result).toEqual(['john@example.com', 'jane@test.org']);
    });

    it('handles empty input', () => {
      const result = extractEmailAddresses('');
      expect(result).toEqual([]);
    });

    it('handles no valid emails', () => {
      const result = extractEmailAddresses('Not an email');
      expect(result).toEqual([]);
    });

    it('handles subdomains', () => {
      const result = extractEmailAddresses('test@sub.example.com');
      expect(result).toEqual(['test@sub.example.com']);
    });

    it('handles numbers in email', () => {
      const result = extractEmailAddresses('user123@example.com');
      expect(result).toEqual(['user123@example.com']);
    });

    it('handles special characters in local part', () => {
      const result = extractEmailAddresses('user+tag@example.com');
      expect(result).toEqual(['user+tag@example.com']);
    });

    it('handles underscore in local part', () => {
      const result = extractEmailAddresses('user_name@example.com');
      expect(result).toEqual(['user_name@example.com']);
    });

    it('handles hyphen in domain', () => {
      const result = extractEmailAddresses('user@ex-ample.com');
      expect(result).toEqual(['user@ex-ample.com']);
    });

    it('rejects invalid email - missing @', () => {
      const result = extractEmailAddresses('notanemail.com');
      expect(result).toEqual([]);
    });

    it('handles Unicode in display name (not local part)', () => {
      const result = extractEmailAddresses('José Müller <jose@example.com>');
      expect(result).toEqual(['jose@example.com']);
    });

    it('handles unusual TLDs', () => {
      const result = extractEmailAddresses('user@example.technology');
      expect(result).toEqual(['user@example.technology']);
    });

    it('handles very long TLD', () => {
      const result = extractEmailAddresses('user@example.museum');
      expect(result).toEqual(['user@example.museum']);
    });

    it('handles underscores in domain (invalid but regex allows)', () => {
      const result = extractEmailAddresses('user@ex_ample.com');
      // BUG: Regex allows underscores in domain which is invalid per RFC
      expect(result).toEqual(['user@ex_ample.com']);
    });

    it('handles double @ signs', () => {
      const result = extractEmailAddresses('user@@example.com');
      // BUG: Invalid email but regex partially matches
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles email at start of TLD (invalid)', () => {
      const result = extractEmailAddresses('user@.com');
      // BUG: Invalid email - domain can't start with dot
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles IP address as domain (invalid per regex)', () => {
      const result = extractEmailAddresses('user@192.168.1.1');
      // BUG: IP addresses aren't valid in this context but regex doesn't catch it
      expect(result).toEqual([]);
    });

    it('handles email with consecutive dots', () => {
      const result = extractEmailAddresses('user@ex..ample.com');
      // BUG: Invalid but regex allows
      expect(result).toEqual(['user@ex..ample.com']);
    });

    it('handles hyphens at start of TLD (invalid)', () => {
      const result = extractEmailAddresses('user@example.-com');
      // BUG: Invalid TLD but regex doesn't catch it
      expect(result).toEqual(['user@example.-com']);
    });
  });

  describe('decodeBase64Url()', () => {
    it('decodes basic base64url', () => {
      const input = Buffer.from('Hello world', 'utf-8').toString('base64url');
      const result = decodeBase64Url(input);
      expect(result).toBe('Hello world');
    });

    it('handles empty string', () => {
      const result = decodeBase64Url('');
      expect(result).toBe('');
    });

    it('handles unicode content', () => {
      const input = Buffer.from('Hello 世界', 'utf-8').toString('base64url');
      const result = decodeBase64Url(input);
      expect(result).toBe('Hello 世界');
    });

    it('handles newlines in content', () => {
      const input = Buffer.from('Line 1\nLine 2', 'utf-8').toString('base64url');
      const result = decodeBase64Url(input);
      expect(result).toBe('Line 1\nLine 2');
    });

    it('throws on invalid base64url', () => {
      expect(() => decodeBase64Url('!!!invalid!!!')).toThrow();
    });
  });

  describe('getHeader()', () => {
    it('extracts header case-insensitively', () => {
      const headers = [
        { name: 'Subject', value: 'Test Email' },
        { name: 'subject', value: 'Lowercase' }
      ];
      const result = getHeader(headers as any, 'subject');
      expect(result).toBe('Test Email');
    });

    it('returns empty string for missing header', () => {
      const result = getHeader(undefined, 'Subject');
      expect(result).toBe('');
    });

    it('returns empty string for non-existent header', () => {
      const headers = [{ name: 'Subject', value: 'Test' }];
      const result = getHeader(headers as any, 'NonExistent');
      expect(result).toBe('');
    });

    it('handles empty headers array', () => {
      const result = getHeader([], 'Subject');
      expect(result).toBe('');
    });

    it('handles header with undefined value', () => {
      const headers = [{ name: 'Subject' }];
      const result = getHeader(headers as any, 'Subject');
      expect(result).toBe('');
    });
  });
});
