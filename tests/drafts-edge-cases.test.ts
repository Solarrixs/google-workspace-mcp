import { describe, it, expect, vi } from 'vitest';
import { buildRawEmail, handleCreateDraft } from '../src/gmail/drafts.js';

// ==================== buildRawEmail() BUGS ====================

describe('buildRawEmail - BUG-054: Header injection vulnerability', () => {
  it('BUG-054: CRLF injection in to field is blocked by sanitizeHeader', () => {
    const raw = buildRawEmail({
      to: 'victim@example.com\r\nBcc: attacker@evil.com',
      from: 'sender@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // CRLF stripped — injected text concatenated into To value, not a separate header
    expect(decoded).toContain('To: victim@example.comBcc: attacker@evil.com');
    expect(decoded).not.toMatch(/\r\nBcc: attacker@evil\.com/);
  });

  it('BUG-054: CRLF injection in subject field is blocked by sanitizeHeader', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test\r\nX-Spoof: malicious',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // CRLF stripped — no separate X-Spoof header line injected
    expect(decoded).toContain('Subject: TestX-Spoof: malicious');
    expect(decoded).not.toMatch(/\r\nX-Spoof: malicious/);
  });
});

describe('buildRawEmail - BUG-055: Date header now included', () => {
  it('BUG-055: RFC 5322 required Date header is present', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Date:');
  });
});

describe('buildRawEmail - BUG-056: Missing Message-ID header', () => {
  it('BUG-056: RFC 5322 recommended Message-ID header is missing', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).not.toContain('Message-ID:');
  });
});

describe('buildRawEmail - BUG-057: Unicode subject now MIME encoded', () => {
  it('BUG-057: Emoji in subject is MIME encoded', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Hello 👋 World',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?.*\?=/);
    expect(decoded).not.toContain('Subject: Hello 👋 World');
  });

  it('BUG-057: Non-ASCII characters in subject are encoded', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'こんにちは',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?.*\?=/);
    expect(decoded).not.toContain('Subject: こんにちは');
  });
});

describe('buildRawEmail - BUG-058: Display names not RFC 5322 encoded', () => {
  it('BUG-058: Display names with special characters not encoded', () => {
    const raw = buildRawEmail({
      to: 'John "The Boss" Doe <john@example.com>',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // Special characters should be quoted/escaped but are not
    expect(decoded).toContain('To: John "The Boss" Doe <john@example.com>');
  });

  it('BUG-058: Display names with spaces not encoded', () => {
    const raw = buildRawEmail({
      to: 'John Doe <john@example.com>',
      from: 'Jane Smith <jane@example.com>',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('To: John Doe <john@example.com>');
    expect(decoded).toContain('From: Jane Smith <jane@example.com>');
  });
});

describe('buildRawEmail - BUG-059: Empty string validation missing', () => {
  it('BUG-059: Empty to field produces malformed email', () => {
    const raw = buildRawEmail({
      to: '',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('To: ');
  });

  it('BUG-059: Empty subject produces malformed header line', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: '',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Subject: \r\n');
  });

  it('BUG-059: Empty body still produces valid-looking email', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: '',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // Empty body has no rich formatting, so it's sent as plain text
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
  });
});

// ==================== plainTextToHtml() BUGS ====================

describe('plainTextToHtml - BUG-060: XSS via unescaped quotes', () => {
  function getHtmlBody(text: string): string {
    // Append a list marker to force HTML path via hasRichFormatting
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: text + '\n\n- _marker',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const match = decoded.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    return match ? match[1] : '';
  }

  it('BUG-060: Single quotes not escaped (XSS risk)', () => {
    const html = getHtmlBody("Hello 'world'");
    // Should be &#39; but is not
    expect(html).toContain("Hello 'world'");
    expect(html).not.toContain('&#39;');
  });

  it('BUG-060: Double quotes not escaped (XSS risk)', () => {
    const html = getHtmlBody('Say "hello" to everyone');
    // Should be &quot; but is not
    expect(html).toContain('Say "hello" to everyone');
    expect(html).not.toContain('&quot;');
  });

  it('BUG-060: Quotes in malicious tags would be dangerous if HTML used in attribute context', () => {
    // Angle brackets ARE escaped, but quotes are NOT
    const html = getHtmlBody('<img src=x onerror="alert(1)">');
    // Note the quotes remain unescaped
    expect(html).toContain('&lt;img src=x onerror="alert(1)"&gt;');
  });
});

describe('plainTextToHtml - BUG-061: Malformed markdown links', () => {
  function getHtmlBody(text: string): string {
    // Append a list marker to force HTML path via hasRichFormatting
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: text + '\n\n- _marker',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const match = decoded.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    return match ? match[1] : '';
  }

  it('BUG-061: Unclosed parenthesis in link creates invalid HTML', () => {
    const html = getHtmlBody('See [docs](https://example.com/docs');
    // The regex won't match because paren not closed
    expect(html).not.toContain('<a href=');
    // But the brackets and URL remain as-is (escaped)
    expect(html).toContain('[docs](https://example.com/docs');
  });

  it('BUG-061: Unclosed bracket produces invalid HTML', () => {
    const html = getHtmlBody('See docs](https://example.com/docs)');
    // Won't match because opening bracket missing
    expect(html).not.toContain('<a href=');
  });

  it('BUG-061: URL with spaces in markdown link breaks HTML', () => {
    const html = getHtmlBody('See [docs](https://example.com/path with spaces)');
    // Space is not URL encoded, produces broken href
    expect(html).toContain('href="https://example.com/path with spaces"');
  });
});

// NOTE: BUG-062 removed - the regex patterns actually handle mixed formats correctly
// /[\.\)] matches both period and paren for numbered lists
// /[-*] matches both hyphen and asterisk for bullet lists

describe('plainTextToHtml - BUG-063: HTML entity handling', () => {
  function getHtmlBody(text: string): string {
    // Append a list marker to force HTML path via hasRichFormatting
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: text + '\n\n- _marker',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const match = decoded.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    return match ? match[1] : '';
  }

  it('BUG-063: Already-escaped HTML entities are double-escaped', () => {
    const text = 'This &amp; that';
    const html = getHtmlBody(text);
    // Should remain &amp; but becomes &amp;amp;
    expect(html).toContain('&amp;amp;');
  });

  it('BUG-063: Unicode in markdown link text breaks linkify', () => {
    const text = 'See &copy; docs](https://example.com)';
    const html = getHtmlBody(text);
    // &copy; becomes &amp;copy; which doesn\'t match regex
    expect(html).not.toContain('<a href=');
  });
});

describe('plainTextToHtml - BUG-062: Empty block handling', () => {
  function getHtmlBody(text: string): string {
    // Append a list marker to force HTML path via hasRichFormatting
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: text + '\n\n- _marker',
    });
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    const match = decoded.match(/<div[^>]*>([\s\S]*?)<\/div>/);
    return match ? match[1] : '';
  }

  it('BUG-062: Leading newlines produce empty paragraph with styling', () => {
    const text = '\n\nStart here';
    const html = getHtmlBody(text);
    // Empty string at start becomes a styled paragraph
    expect(html).toContain('<p style="margin:0"></p>');
  });

  it('BUG-062: Trailing newlines produce empty paragraph with styling', () => {
    // With the appended marker, the trailing \n\n merges with marker's \n\n
    // The key bug is that empty blocks become styled empty paragraphs
    const text = '\n\nMiddle\n\n';
    const html = getHtmlBody(text);
    // Leading empty block still produces an empty <p>
    expect(html).toContain('<p style="margin:0"></p>');
    expect(html).toContain('<p style="margin:0">Middle</p>');
  });
});

// ==================== Threading BUGS ====================

describe('Threading - BUG-065: Error handling for invalid thread_id', () => {
  it('BUG-065: Invalid thread_id is caught gracefully (fixed)', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'test@example.com' },
        }),
        threads: {
          get: vi.fn().mockRejectedValue(new Error('Thread not found')),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'msg1' } },
          }),
        },
      },
    } as any;

    // Should catch thread error and proceed without threading headers
    const result = await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      thread_id: 'invalid-thread-id',
    });
    expect(result.draft_id).toBe('draft1');
  });
});

describe('Threading - BUG-066: Empty messages array handling', () => {
  it('BUG-066: Empty thread messages array produces no threading headers', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'test@example.com' },
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: { messages: [] },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'msg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      thread_id: 'thread1',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(createCall.requestBody.message.raw, 'base64url').toString('utf-8');

    // No threading headers added - silent failure
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});

describe('Threading - BUG-067: Empty Message-ID value causes silent failure', () => {
  it('BUG-067: Empty string Message-ID produces no threading headers', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'test@example.com' },
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  payload: {
                    headers: [
                      { name: 'Message-ID', value: '' }, // Empty string is falsy
                    ],
                  },
                },
              ],
            },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'msg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      thread_id: 'thread1',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(createCall.requestBody.message.raw, 'base64url').toString('utf-8');

    // No threading headers added - silent failure
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});

describe('Threading - BUG-068: Missing headers array', () => {
  it('BUG-068: Missing headers array causes threading failure', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'test@example.com' },
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  payload: {}, // No headers array
                },
              ],
            },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'msg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      thread_id: 'thread1',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(createCall.requestBody.message.raw, 'base64url').toString('utf-8');

    // No threading headers - silent failure
    expect(decoded).not.toContain('In-Reply-To:');
    expect(decoded).not.toContain('References:');
  });
});

describe('Threading - BUG-069: Empty string in_reply_to triggers auto-resolution', () => {
  it('BUG-069: Explicit empty string in_reply_to still triggers auto-resolution', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'test@example.com' },
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  payload: {
                    headers: [
                      { name: 'Message-ID', value: '<msg1@gmail.com>' },
                    ],
                  },
                },
              ],
            },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'msg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      thread_id: 'thread1',
      in_reply_to: '', // Explicit empty string
    });

    // Should NOT fetch thread because user provided in_reply_to
    // But it DOES fetch because "" is falsy
    expect(gmail.users.threads.get).toHaveBeenCalled();
  });
});
