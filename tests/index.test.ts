import { describe, it, expect } from 'vitest';
import { validateStringSize, stripControlChars } from '../src/index.js';
import { buildRawEmail } from '../src/gmail/drafts.js';

describe('validateStringSize', () => {
  it('accepts string within limit', () => {
    expect(validateStringSize('hello', 10, 'test')).toBe('hello');
  });

  it('throws on string exceeding limit', () => {
    expect(() => validateStringSize('hello world', 5, 'test')).toThrow();
  });

  it('error message includes field name', () => {
    expect(() => validateStringSize('too long', 3, 'myField')).toThrow('myField');
  });
});

describe('stripControlChars', () => {
  it('strips null bytes', () => {
    expect(stripControlChars('hello\x00world')).toBe('helloworld');
  });

  it('strips control chars \\x01-\\x08', () => {
    expect(stripControlChars('a\x01b\x08c')).toBe('abc');
  });

  it('strips \\x0B and \\x0C', () => {
    expect(stripControlChars('a\x0Bb\x0Cc')).toBe('abc');
  });

  it('strips \\x0E-\\x1F', () => {
    expect(stripControlChars('a\x0Eb\x1Fc')).toBe('abc');
  });

  it('strips \\x7F (DEL)', () => {
    expect(stripControlChars('a\x7Fb')).toBe('ab');
  });

  it('strips \\r (\\x0D) — BUG-001 fix', () => {
    expect(stripControlChars('line1\r\nline2')).toBe('line1\nline2');
  });

  it('preserves normal ASCII text', () => {
    expect(stripControlChars('Hello, World! 123')).toBe('Hello, World! 123');
  });

  it('preserves Unicode characters', () => {
    expect(stripControlChars('こんにちは 👋')).toBe('こんにちは 👋');
  });

  it('preserves newlines (\\n)', () => {
    expect(stripControlChars('line1\nline2\n')).toBe('line1\nline2\n');
  });
});

describe('buildRawEmail header injection defense', () => {
  it('CRLF in to field does not inject a separate header', () => {
    const raw = buildRawEmail({
      to: 'victim@example.com\r\nBcc: attacker@evil.com',
      from: 'sender@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // CRLF stripped — injected text is concatenated into To value, not a separate header
    expect(decoded).toContain('To: victim@example.comBcc: attacker@evil.com');
    // Verify no separate Bcc header line was injected
    expect(decoded).not.toMatch(/\r\nBcc: attacker@evil\.com/);
  });

  it('CRLF in cc field does not inject a separate header', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
      cc: 'friend@example.com\r\nBcc: attacker@evil.com',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // CRLF stripped — injected text is concatenated into Cc value
    expect(decoded).toContain('Cc: friend@example.comBcc: attacker@evil.com');
    expect(decoded).not.toMatch(/\r\nBcc: attacker@evil\.com/);
  });

  it('CRLF in bcc field does not inject a separate header', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
      bcc: 'secret@example.com\r\nX-Injected: malicious',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // CRLF stripped — injected text is concatenated into Bcc value
    expect(decoded).toContain('Bcc: secret@example.comX-Injected: malicious');
    expect(decoded).not.toMatch(/\r\nX-Injected: malicious/);
  });
});
