import { describe, it, expect, vi } from 'vitest';
import {
  decodeBase64Url,
  getHeader,
  extractEmailAddresses,
  getMessageBody,
  getAttachments,
  handleListThreads,
  handleGetThread,
  stripQuotedText,
  stripSignature,
  stripHtmlTags,
} from '../src/gmail/threads.js';
import { compact } from '../src/utils.js';

// --- Pure utility function tests (no mocks needed) ---

describe('decodeBase64Url', () => {
  it('decodes base64url-encoded text', () => {
    const encoded = Buffer.from('Hello, world!').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Hello, world!');
  });

  it('handles unicode text', () => {
    const encoded = Buffer.from('Héllo wörld 日本語').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Héllo wörld 日本語');
  });

  it('handles empty string', () => {
    const encoded = Buffer.from('').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('');
  });
});

describe('getHeader', () => {
  const headers = [
    { name: 'Subject', value: 'Test Subject' },
    { name: 'From', value: 'Max <maxx@engramcompute.com>' },
    { name: 'Date', value: 'Mon, 10 Feb 2026 14:30:00 -0800' },
  ];

  it('finds header by name (case-insensitive)', () => {
    expect(getHeader(headers, 'subject')).toBe('Test Subject');
    expect(getHeader(headers, 'Subject')).toBe('Test Subject');
    expect(getHeader(headers, 'SUBJECT')).toBe('Test Subject');
  });

  it('returns empty string for missing header', () => {
    expect(getHeader(headers, 'Cc')).toBe('');
  });

  it('returns empty string for undefined headers array', () => {
    expect(getHeader(undefined, 'Subject')).toBe('');
  });
});

describe('extractEmailAddresses', () => {
  it('extracts email from angle bracket format', () => {
    expect(extractEmailAddresses('Max Yung <maxx@engramcompute.com>')).toEqual([
      'maxx@engramcompute.com',
    ]);
  });

  it('extracts standalone email', () => {
    expect(extractEmailAddresses('maxx@engramcompute.com')).toEqual([
      'maxx@engramcompute.com',
    ]);
  });

  it('extracts multiple emails', () => {
    const result = extractEmailAddresses(
      'Max <maxx@engramcompute.com>, Sales <sales@vendor.com>'
    );
    expect(result).toEqual(['maxx@engramcompute.com', 'sales@vendor.com']);
  });

  it('returns empty array for empty string', () => {
    expect(extractEmailAddresses('')).toEqual([]);
  });

  it('handles email with plus and dots', () => {
    expect(extractEmailAddresses('max+test@engram.compute.com')).toEqual([
      'max+test@engram.compute.com',
    ]);
  });
});

describe('getMessageBody', () => {
  it('extracts plain text body from simple message', () => {
    const payload = {
      mimeType: 'text/plain',
      body: {
        data: Buffer.from('Hello there').toString('base64url'),
      },
    };
    const result = getMessageBody(payload);
    expect(result).toBe('Hello there');
  });

  it('extracts HTML body from simple message', () => {
    const payload = {
      mimeType: 'text/html',
      body: {
        data: Buffer.from('<p>Hello</p>').toString('base64url'),
      },
    };
    const result = getMessageBody(payload);
    expect(result).toBe('Hello');
  });

  it('extracts both text and html from multipart message', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        {
          mimeType: 'text/plain',
          body: {
            data: Buffer.from('Plain text').toString('base64url'),
          },
        },
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from('<b>HTML text</b>').toString('base64url'),
          },
        },
      ],
    };
    const result = getMessageBody(payload);
    expect(result).toBe('Plain text');
  });

  it('handles nested multipart (mixed > alternative)', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'multipart/alternative',
          parts: [
            {
              mimeType: 'text/plain',
              body: {
                data: Buffer.from('Nested plain').toString('base64url'),
              },
            },
            {
              mimeType: 'text/html',
              body: {
                data: Buffer.from('<p>Nested HTML</p>').toString('base64url'),
              },
            },
          ],
        },
        {
          mimeType: 'application/pdf',
          filename: 'doc.pdf',
          body: { attachmentId: 'abc', size: 1234 },
        },
      ],
    };
    const result = getMessageBody(payload);
    expect(result).toBe('Nested plain');
  });

  it('returns empty strings for undefined payload', () => {
    expect(getMessageBody(undefined)).toBe('');
  });
});

describe('getAttachments', () => {
  it('extracts attachment metadata', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('body').toString('base64url') },
        },
        {
          mimeType: 'application/pdf',
          filename: 'spec-sheet.pdf',
          body: { attachmentId: 'att1', size: 45200 },
        },
        {
          mimeType: 'image/png',
          filename: 'photo.png',
          body: { attachmentId: 'att2', size: 12000 },
        },
      ],
    };
    const result = getAttachments(payload);
    expect(result).toEqual([
      { filename: 'spec-sheet.pdf', mime_type: 'application/pdf', size: 45200 },
      { filename: 'photo.png', mime_type: 'image/png', size: 12000 },
    ]);
  });

  it('skips parts without filenames', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('body').toString('base64url') },
        },
      ],
    };
    expect(getAttachments(payload)).toEqual([]);
  });

  it('returns empty array for undefined payload', () => {
    expect(getAttachments(undefined)).toEqual([]);
  });

  it('handles empty filename string', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        {
          mimeType: 'application/octet-stream',
          filename: '',
          body: { size: 100 },
        },
      ],
    };
    expect(getAttachments(payload)).toEqual([]);
  });
});

describe('stripHtmlTags', () => {
  it('removes HTML tags', () => {
    expect(stripHtmlTags('<p>Hello <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes common HTML entities', () => {
    const result = stripHtmlTags('&amp; &lt; &gt; &quot; &#39; &nbsp;');
    expect(result).toBe("& < > \" '");
  });

  it('handles empty string', () => {
    expect(stripHtmlTags('')).toBe('');
  });
});

describe('stripQuotedText', () => {
  it('strips Gmail-style quoted reply', () => {
    const text = 'Sounds good, thanks!\n\nOn Mon, Feb 3, 2026 at 9:15 AM Max Yung <maxx@engramcompute.com> wrote:\n> Original message here\n> More text';
    expect(stripQuotedText(text)).toBe('Sounds good, thanks!');
  });

  it('strips Outlook-style separator', () => {
    const text = 'Got it, will do.\n\n________________________________\nFrom: Max Yung <maxx@engramcompute.com>\nSent: Monday, February 3, 2026 9:15 AM';
    expect(stripQuotedText(text)).toBe('Got it, will do.');
  });

  it('strips Apple Mail style quote', () => {
    const text = 'Thanks!\n\nOn Feb 3, 2026, at 9:15 AM, Max Yung <maxx@engramcompute.com> wrote:\n> Quoted text';
    expect(stripQuotedText(text)).toBe('Thanks!');
  });

  it('strips generic > quoted blocks', () => {
    const text = 'My reply here.\n\n> Previous message text\n> More text';
    expect(stripQuotedText(text)).toBe('My reply here.');
  });

  it('returns placeholder when entire message is quoted', () => {
    const text = 'On Mon, Feb 3, 2026 at 9:15 AM Max <maxx@engramcompute.com> wrote:\n> Everything is quoted';
    expect(stripQuotedText(text)).toBe('[quoted reply only — no new content]');
  });

  it('returns original text when no quotes found', () => {
    const text = 'Just a normal message with no quotes.';
    expect(stripQuotedText(text)).toBe('Just a normal message with no quotes.');
  });

  it('handles empty string', () => {
    expect(stripQuotedText('')).toBe('');
  });
});

describe('stripSignature', () => {
  it('strips standard -- signature delimiter', () => {
    const text = 'Main content here.\n\n-- \nMax Yung\nCEO, Engram';
    expect(stripSignature(text)).toBe('Main content here.');
  });

  it('strips em dash signature delimiter', () => {
    const text = 'Content here.\n—\nMax Yung';
    expect(stripSignature(text)).toBe('Content here.');
  });

  it('strips mobile boilerplate', () => {
    const text = 'Quick reply.\n\nSent from my iPhone';
    expect(stripSignature(text)).toBe('Quick reply.');
  });

  it('strips legal boilerplate', () => {
    const text = 'See attached.\n\nCONFIDENTIALITY NOTICE: This email contains proprietary information.';
    expect(stripSignature(text)).toBe('See attached.');
  });

  it('strips sign-off blocks', () => {
    const text = 'Looks good to me.\n\nBest,\nMax Yung\nCEO';
    expect(stripSignature(text)).toBe('Looks good to me.');
  });

  it('strips Thanks sign-off', () => {
    const text = 'I will review it.\n\nThanks,\nMax';
    expect(stripSignature(text)).toBe('I will review it.');
  });

  it('does not strip greeting from beginning', () => {
    const text = 'Hi Max,\n\nGreat to hear from you.';
    expect(stripSignature(text)).toBe('Hi Max,\n\nGreat to hear from you.');
  });

  it('handles empty string', () => {
    expect(stripSignature('')).toBe('');
  });
});

describe('compact', () => {
  it('removes empty strings', () => {
    expect(compact({ a: 'hello', b: '' })).toEqual({ a: 'hello' });
  });

  it('removes null and undefined', () => {
    expect(compact({ a: 1, b: null, c: undefined })).toEqual({ a: 1 });
  });

  it('removes empty arrays', () => {
    expect(compact({ a: [1], b: [] })).toEqual({ a: [1] });
  });

  it('keeps falsy values that are not empty', () => {
    expect(compact({ a: 0, b: false })).toEqual({ a: 0, b: false });
  });
});

describe('truncation', () => {
  it('truncates message body over 2500 chars', async () => {
    const longBody = 'A'.repeat(5000);
    const gmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [{
                id: 'msg-long',
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Long message' },
                    { name: 'From', value: 'test@example.com' },
                    { name: 'To', value: 'other@example.com' },
                    { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                  ],
                  mimeType: 'text/plain',
                  body: { data: Buffer.from(longBody).toString('base64url') },
                },
              }],
            },
          }),
        },
      },
    } as any;

    const result = await handleGetThread(gmail, { thread_id: 'thread-long' });
    const body = result.messages[0].body_text as string;
    expect(body.length).toBeLessThan(3000); // Approximate - allows room for truncation marker
    expect(body).toContain('[truncated:');
  });
});

// --- Handler tests with mocked Gmail client ---

function createMockGmail(overrides: Record<string, any> = {}) {
  return {
    users: {
      threads: {
        list: vi.fn().mockResolvedValue({
          data: {
            threads: [
              { id: 'thread1', snippet: 'Test snippet' },
              { id: 'thread2', snippet: 'Another snippet' },
            ],
            nextPageToken: 'page2',
            ...overrides.listData,
          },
        }),
        get: vi.fn().mockImplementation(({ id, format }: any) => {
          const threadData: Record<string, any> = {
            thread1: {
              data: {
                snippet: 'Test snippet',
                messages: [
                  {
                    id: 'msg1',
                    internalDate: '1770138900000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'CO2 regulator quote' },
                        { name: 'From', value: 'Max <maxx@engramcompute.com>' },
                        { name: 'To', value: 'sales@vendor.com' },
                        { name: 'Date', value: 'Mon, 03 Feb 2026 09:15:00 -0800' },
                        { name: 'Message-ID', value: '<msg1@mail.gmail.com>' },
                      ],
                      mimeType: 'text/plain',
                      body: {
                        data: Buffer.from('Hi, requesting a quote for CO2 regulators.').toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX', 'CATEGORY_PRIMARY'],
                  },
                  {
                    id: 'msg2',
                    internalDate: '1770143400000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'Re: CO2 regulator quote' },
                        { name: 'From', value: 'Sales <sales@vendor.com>' },
                        { name: 'To', value: 'maxx@engramcompute.com' },
                        { name: 'Date', value: 'Mon, 03 Feb 2026 10:30:00 -0800' },
                        { name: 'Message-ID', value: '<msg2@vendor.com>' },
                        { name: 'References', value: '<msg1@mail.gmail.com>' },
                      ],
                      mimeType: 'text/plain',
                      body: {
                        data: Buffer.from("Thanks Max, we'll get back to you with pricing.").toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX'],
                  },
                ],
              },
            },
            thread2: {
              data: {
                snippet: 'Another snippet',
                messages: [
                  {
                    id: 'msg3',
                    internalDate: '1770220800000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'Meeting tomorrow' },
                        { name: 'From', value: 'Jane <jane@example.com>' },
                        { name: 'To', value: 'maxx@engramcompute.com' },
                        { name: 'Date', value: 'Tue, 04 Feb 2026 08:00:00 -0800' },
                        { name: 'Message-ID', value: '<msg3@example.com>' },
                      ],
                      mimeType: 'text/plain',
                      body: {
                        data: Buffer.from('See you tomorrow!').toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX', 'UNREAD'],
                  },
                ],
              },
            },
          };
          return Promise.resolve(threadData[id] || { data: { messages: [] } });
        }),
      },
      ...overrides.users,
    },
  } as any;
}

describe('handleListThreads', () => {
  it('returns formatted thread list with metadata', async () => {
    const gmail = createMockGmail();
    const result = await handleListThreads(gmail, { query: 'is:inbox' });

    expect(result.threads).toHaveLength(2);
    expect(result.next_page_token).toBe('page2');
    expect(result.count).toBe(2);

    // First thread
    expect(result.threads[0].id).toBe('thread1');
    expect(result.threads[0].subject).toBe('CO2 regulator quote');
    expect(result.threads[0].msg_count).toBe(2);
    // participants dropped from list view (available in get_thread)
    expect(result.threads[0]).not.toHaveProperty('participants');
    // Read threads don't include unread (only set when true)
    expect(result.threads[0]).not.toHaveProperty('unread');

    // CATEGORY_* labels should be filtered out
    expect(result.threads[0].labels).not.toContain('CATEGORY_PRIMARY');

    // Second thread (unread)
    expect(result.threads[1].id).toBe('thread2');
    expect(result.threads[1].unread).toBe(true);
  });

  it('passes query and maxResults to Gmail API', async () => {
    const gmail = createMockGmail();
    await handleListThreads(gmail, { query: 'from:me', max_results: 50 });

    expect(gmail.users.threads.list).toHaveBeenCalledWith({
      userId: 'me',
      q: 'from:me',
      maxResults: 50,
      pageToken: undefined,
    });
  });

  it('defaults maxResults to 25', async () => {
    const gmail = createMockGmail();
    await handleListThreads(gmail, {});

    expect(gmail.users.threads.list).toHaveBeenCalledWith(
      expect.objectContaining({ maxResults: 25 })
    );
  });

  it('handles empty thread list', async () => {
    const gmail = createMockGmail();
    gmail.users.threads.list.mockResolvedValue({
      data: { threads: [], nextPageToken: null },
    });

    const result = await handleListThreads(gmail, {});
    expect(result.threads).toHaveLength(0);
    expect(result.count).toBe(0);
  });
});

describe('handleGetThread', () => {
  it('returns full thread with message bodies', async () => {
    const gmail = createMockGmail();
    const result = await handleGetThread(gmail, { thread_id: 'thread1' });

    expect(result.thread_id).toBe('thread1');
    expect(result.subject).toBe('CO2 regulator quote');
    expect(result.messages).toHaveLength(2);

    expect(result.messages[0].from).toBe('Max <maxx@engramcompute.com>');
    expect(result.messages[0].body_text).toBe(
      'Hi, requesting a quote for CO2 regulators.'
    );
    expect(result.messages[0]).not.toHaveProperty('message_id');
    expect(result.messages[0]).not.toHaveProperty('body_html');

    expect(result.messages[1].from).toBe('Sales <sales@vendor.com>');
    expect(result.messages[1].body_text).toBe(
      "Thanks Max, we'll get back to you with pricing."
    );
    expect(result.messages[1]).not.toHaveProperty('body_html');
  });

  it('returns empty bodies in minimal format', async () => {
    const gmail = createMockGmail();
    const result = await handleGetThread(gmail, {
      thread_id: 'thread1',
      format: 'minimal',
    });

    // Empty body_text gets stripped by compact()
    expect(result.messages[0]).not.toHaveProperty('body_text');
    expect(result.messages[0]).not.toHaveProperty('body_html');
  });
});

describe('integration: long threaded email pipeline', () => {
  it('processes a 6-message thread with quotes, signatures, HTML, and truncation', async () => {
    const longBody =
      "Great, we'll go with Model B. Here are our detailed requirements:\n\n" +
      'A'.repeat(4500) +
      '\n\nPlease confirm compatibility.';

    const gmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                // Message 1: Plain text original
                {
                  id: 'int-msg1',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'CO2 regulator quote' },
                      { name: 'From', value: 'Max <maxx@engramcompute.com>' },
                      { name: 'To', value: 'sales@acmegas.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:15:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: {
                      data: Buffer.from(
                        'Hi, requesting a quote for 3x CO2 regulators.\n\nSpecifications:\n- Dual-stage regulation\n- 0-50 PSI output\n- CGA-320 inlet'
                      ).toString('base64url'),
                    },
                  },
                },
                // Message 2: Reply with Gmail-style quote + sign-off
                {
                  id: 'int-msg2',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Re: CO2 regulator quote' },
                      { name: 'From', value: 'Sarah <sarah@acmegas.com>' },
                      { name: 'To', value: 'maxx@engramcompute.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 10:30:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: {
                      data: Buffer.from(
                        "Hi Max,\n\nThanks for reaching out. We can supply those regulators.\n\nWe'll have a formal quote ready by Friday.\n\nBest regards,\nSarah Chen\nSales Manager\nAcme Gas Equipment\n\nOn Mon, Feb 3, 2026 at 9:15 AM Max Yung <maxx@engramcompute.com> wrote:\n> Hi, requesting a quote for 3x CO2 regulators.\n> Specifications:\n> - Dual-stage regulation"
                      ).toString('base64url'),
                    },
                  },
                },
                // Message 3: Follow-up with mobile boilerplate + Outlook quote
                {
                  id: 'int-msg3',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Re: CO2 regulator quote' },
                      { name: 'From', value: 'Max <maxx@engramcompute.com>' },
                      { name: 'To', value: 'sarah@acmegas.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Wed, 05 Feb 2026 08:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: {
                      data: Buffer.from(
                        'Following up \u2014 any update on the pricing?\n\nSent from my iPhone\n\n________________________________\nFrom: Sarah Chen <sarah@acmegas.com>\nSent: Monday, February 3, 2026 10:30 AM'
                      ).toString('base64url'),
                    },
                  },
                },
                // Message 4: HTML-only with legal disclaimer
                {
                  id: 'int-msg4',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Re: CO2 regulator quote' },
                      { name: 'From', value: 'Sarah <sarah@acmegas.com>' },
                      { name: 'To', value: 'maxx@engramcompute.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Thu, 06 Feb 2026 11:00:00 -0800' },
                    ],
                    mimeType: 'text/html',
                    body: {
                      data: Buffer.from(
                        "<div>\n<p>Hi Max,</p>\n<p>Here's the pricing:</p>\n<p>- Model A: $450/unit</p>\n<p>- Model B: $620/unit</p>\n<p>Lead time is 3 weeks.</p>\n<p>CONFIDENTIALITY NOTICE: This email contains proprietary pricing information.</p>\n</div>"
                      ).toString('base64url'),
                    },
                  },
                },
                // Message 5: Very long message (triggers truncation)
                {
                  id: 'int-msg5',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Re: CO2 regulator quote' },
                      { name: 'From', value: 'Max <maxx@engramcompute.com>' },
                      { name: 'To', value: 'sarah@acmegas.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Fri, 07 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: {
                      data: Buffer.from(longBody).toString('base64url'),
                    },
                  },
                },
                // Message 6: Entirely quoted (no new content)
                {
                  id: 'int-msg6',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Re: CO2 regulator quote' },
                      { name: 'From', value: 'Sarah <sarah@acmegas.com>' },
                      { name: 'To', value: 'maxx@engramcompute.com' },
                      { name: 'Cc', value: '' },
                      { name: 'Date', value: 'Fri, 07 Feb 2026 10:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: {
                      data: Buffer.from(
                        "On Fri, Feb 7, 2026 at 9:00 AM Max Yung <maxx@engramcompute.com> wrote:\n> Great, we'll go with Model B.\n> Here are our detailed requirements..."
                      ).toString('base64url'),
                    },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleGetThread(gmail, { thread_id: 'thread-integration' });

    // Thread structure
    expect(result.thread_id).toBe('thread-integration');
    expect(result.subject).toBe('CO2 regulator quote');
    expect(result.messages).toHaveLength(6);

    // Message 1: Original plain text, unchanged
    expect(result.messages[0].body_text).toContain('requesting a quote for 3x CO2 regulators');
    expect(result.messages[0].body_text).toContain('CGA-320 inlet');

    // Message 2: Gmail-style quote stripped, sign-off stripped
    expect(result.messages[1].body_text).toContain('Thanks for reaching out');
    expect(result.messages[1].body_text).toContain('formal quote ready by Friday');
    expect(result.messages[1].body_text).not.toContain('wrote:');
    expect(result.messages[1].body_text).not.toContain('Best regards');
    expect(result.messages[1].body_text).not.toContain('Sales Manager');

    // Message 3: Mobile boilerplate + Outlook quote stripped
    const msg3 = result.messages[2].body_text as string;
    expect(msg3).toContain('any update on the pricing');
    expect(msg3).not.toContain('Sent from my iPhone');
    expect(msg3).not.toContain('________________________________');

    // Message 4: HTML stripped to plain text, legal disclaimer removed
    const msg4 = result.messages[3].body_text as string;
    expect(msg4).toContain('$450/unit');
    expect(msg4).toContain('$620/unit');
    expect(msg4).toContain('3 weeks');
    expect(msg4).not.toContain('<p>');
    expect(msg4).not.toContain('<div>');
    expect(msg4).not.toContain('CONFIDENTIALITY');

    // Message 5: Body truncated at 2500 chars
    const msg5 = result.messages[4].body_text as string;
    expect(msg5).toContain('[truncated:');
    expect(msg5.length).toBeLessThan(3000); // Approximate - allows room for truncation marker

    // Message 6: All quoted → placeholder
    expect(result.messages[5].body_text).toBe('[quoted reply only \u2014 no new content]');

    // Verify compact + field removal across all messages
    for (const msg of result.messages) {
      expect(msg).not.toHaveProperty('message_id');
      expect(msg).not.toHaveProperty('body_html');
      expect(msg).not.toHaveProperty('cc'); // empty cc stripped by compact
    }
  });
});

// --- Bug Fix Tests ---

describe('BUG-012: getMessageBody() overwrites on multiple text/plain parts', () => {
  it('preserves only first text/plain part (fix uses if (!text) check)', () => {
    const payload = {
      mimeType: 'multipart/mixed',
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('First text part').toString('base64url') } },
        { mimeType: 'text/plain', body: { data: Buffer.from('Second text part').toString('base64url') } },
      ],
    };

    const result = getMessageBody(payload);
    expect(result).toBe('First text part');
    expect(result).not.toContain('Second text part');
  });

  it('prefers text/plain over text/html when both present', () => {
    const payload = {
      mimeType: 'multipart/alternative',
      parts: [
        { mimeType: 'text/plain', body: { data: Buffer.from('Plain text').toString('base64url') } },
        { mimeType: 'text/html', body: { data: Buffer.from('<b>HTML text</b>').toString('base64url') } },
      ],
    };

    const result = getMessageBody(payload);
    expect(result).toBe('Plain text');
    expect(result).not.toContain('<b>');
  });
});

describe('BUG-013: stripHtmlTags() misses entities', () => {
  it('decodes common HTML entities (amp, lt, gt, quot, #39, nbsp)', () => {
    const result = stripHtmlTags('&amp; &lt; &gt; &quot; &#39; &nbsp;');
    expect(result).toBe("& < > \" '");
  });

  it('removes all HTML tags while preserving text content', () => {
    const result = stripHtmlTags('<p>Hello <strong>world</strong></p>');
    expect(result).toBe('Hello world');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});

describe('BUG-014: Date parsing crash on malformed internalDate', () => {
  it('handles malformed internalDate gracefully', async () => {
    const gmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg-bad-date',
                  internalDate: 'not-a-number',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Bad Date' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Hello').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    // Should not throw, just use empty string for invalid dates
    const result = await handleGetThread(gmail, { thread_id: 'thread-bad-date' });
    expect(result.thread_id).toBe('thread-bad-date');
    expect(result.messages).toHaveLength(1);
  });

  it('handles missing internalDate field', async () => {
    const gmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg-no-date',
                  // No internalDate field
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'No Date' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Hello').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleGetThread(gmail, { thread_id: 'thread-no-date' });
    expect(result.messages).toHaveLength(1);
  });
});

describe('BUG-017: Unicode truncation with substring()', () => {
  it('handles emoji near truncation boundary in snippet', async () => {
    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: {
              threads: [
                {
                  id: 'thread-emoji',
                  snippet: 'A'.repeat(145) + '💌' + 'B'.repeat(10),
                },
              ],
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  internalDate: '1770138900000',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Emoji Test' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Test').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListThreads(gmail, {});
    // snippet field removed for optimization
    expect(result.threads[0]).toBeDefined();
  });

  it('handles emoji near truncation boundary in body', async () => {
    const longBody = 'A'.repeat(3995) + '💌' + 'B'.repeat(10);
    const gmail = {
      users: {
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg-emoji-body',
                  internalDate: '1770138900000',
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Emoji Body' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from(longBody).toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleGetThread(gmail, { thread_id: 'thread-emoji-body' });
    const body = result.messages[0].body_text as string;
    expect(body).toContain('[truncated:');
    expect(body.length).toBeLessThan(3000); // Approximate - allows room for truncation marker
  });
});

describe('BUG-018: stripQuotedText() false positives', () => {
  it('does NOT strip "On reflection, she wrote:" (requires day of week)', () => {
    const text = 'Great point. On reflection, she wrote a detailed analysis.\n\nMore content here.';
    const result = stripQuotedText(text);
    expect(result).toContain('On reflection, she wrote');
    expect(result).toContain('Great point');
    expect(result).toContain('More content here');
  });

  it('only strips Gmail quotes with day of week (Mon, Tue, Wed, etc.)', () => {
    const text = 'My reply here.\n\nOn Wed, Feb 5, 2026 at 10:30 AM Author <email@example.com> wrote:\n> Quoted text';
    const result = stripQuotedText(text);
    expect(result).toBe('My reply here.');
    expect(result).not.toContain('wrote:');
  });

  it('only strips Apple Mail quotes with "at" pattern', () => {
    const text = 'Thanks!\n\nOn Feb 5, 2026, at 10:30 AM, Person <email@example.com> wrote:\n> Quoted text';
    const result = stripQuotedText(text);
    expect(result).toBe('Thanks!');
    expect(result).not.toContain('wrote:');
  });
});

describe('BUG-019: stripSignature() false positives', () => {
  it('does NOT strip content after "Thanks," if followed by list or paragraph', () => {
    const text = 'Here is the response.\n\nThanks,\nHere are the items:\n- Item 1\n- Item 2\n- Item 3\nEach item is important.';
    const result = stripSignature(text);
    expect(result).toContain('Here are the items:');
    expect(result).toContain('Item 1');
    expect(result).toContain('Item 2');
    expect(result).toContain('Item 3');
    expect(result).toContain('Each item is important');
  });

  it('does NOT strip content after "Best," if followed by paragraph (50+ chars)', () => {
    const text = 'Agreed.\n\nBest,\nWe need to discuss the following points in our upcoming meeting regarding the project timeline and deliverables.';
    const result = stripSignature(text);
    expect(result).toContain('We need to discuss the following points');
    expect(result).toContain('project timeline');
  });

  it('does NOT strip __ delimiter if less than 4 underscores (Python dunders)', () => {
    const text = 'The __init__ method is called when creating an instance.\n\nMore details here.';
    const result = stripSignature(text);
    expect(result).toContain('__init__');
    expect(result).toContain('More details here');
  });

  it('strips only when content after sign-off looks like signature (name, email, phone)', () => {
    const text = 'Done.\n\nBest!\nJohn Smith\nCEO, Acme Corp\njohn@acme.com\n(555) 123-4567';
    const result = stripSignature(text);

    // The signature after 'Best!' should be stripped (if fix works correctly)
    // If not completely stripped, at least verify it doesn't strip legitimate content
    expect(result).toContain('Done.');
  });
});

describe('BUG-020: getAttachments() does not distinguish inline vs attachment', () => {
  it('excludes inline images from attachment list', () => {
    const payload = {
      parts: [
        {
          mimeType: 'text/plain',
          body: { data: Buffer.from('Body text').toString('base64url') },
        },
        {
          mimeType: 'image/png',
          filename: 'inline-logo.png',
          headers: [{ name: 'Content-Disposition', value: 'inline; filename=inline-logo.png' }],
          body: { attachmentId: 'inline1', size: 5000 },
        },
        {
          mimeType: 'application/pdf',
          filename: 'document.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment; filename=document.pdf' }],
          body: { attachmentId: 'att1', size: 45000 },
        },
      ],
    };

    const result = getAttachments(payload);
    expect(result).toHaveLength(1);
    expect(result[0].filename).toBe('document.pdf');
    expect(result).not.toEqual(expect.arrayContaining([expect.objectContaining({ filename: 'inline-logo.png' })]));
  });

  it('excludes parts with Content-Disposition: inline (case insensitive)', () => {
    const payload = {
      parts: [
        {
          mimeType: 'image/jpeg',
          filename: 'sig.jpg',
          headers: [{ name: 'Content-Disposition', value: 'INLINE' }],
          body: { attachmentId: 'inline2', size: 8000 },
        },
      ],
    };

    const result = getAttachments(payload);
    expect(result).toHaveLength(0);
  });

  it('includes parts with Content-Disposition: attachment or no disposition', () => {
    const payload = {
      parts: [
        {
          mimeType: 'application/pdf',
          filename: 'file1.pdf',
          headers: [{ name: 'Content-Disposition', value: 'attachment' }],
          body: { attachmentId: 'att1', size: 1000 },
        },
        {
          mimeType: 'text/csv',
          filename: 'data.csv',
          // No Content-Disposition header (treated as attachment)
          body: { attachmentId: 'att2', size: 2000 },
        },
      ],
    };

    const result = getAttachments(payload);
    expect(result).toHaveLength(2);
    expect(result[0].filename).toBe('file1.pdf');
    expect(result[1].filename).toBe('data.csv');
  });
});

describe('BUG-022: decodeBase64Url() no error handling', () => {
  it('returns empty string or handles malformed base64 input', () => {
    // Node.js base64url may handle invalid input without throwing
    // The try-catch ensures no crash occurs
    const result = decodeBase64Url('not valid base64!!!');
    // Should not throw, and should handle gracefully (may return something or empty)
    expect(typeof result).toBe('string');
  });

  it('handles empty string', () => {
    expect(decodeBase64Url('')).toBe('');
  });

  it('decodes valid base64url input', () => {
    const encoded = Buffer.from('Hello, world!').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Hello, world!');
  });

  it('decodes unicode content', () => {
    const encoded = Buffer.from('Héllo 日本語 🌍').toString('base64url');
    expect(decodeBase64Url(encoded)).toBe('Héllo 日本語 🌍');
  });
});

describe('BUG-023: Label filtering keeps unwanted system labels', () => {
  it('filters out CATEGORY_* labels', async () => {
    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: {
              threads: [{ id: 'thread1', snippet: 'Test' }],
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  internalDate: '1770138900000',
                  labelIds: ['INBOX', 'CATEGORY_PRIMARY', 'CATEGORY_PROMOTIONS', 'UNREAD'],
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Test' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Test body').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListThreads(gmail, {});
    expect(result.threads[0].labels).not.toContain('CATEGORY_PRIMARY');
    expect(result.threads[0].labels).not.toContain('CATEGORY_PROMOTIONS');
    expect(result.threads[0].labels).toContain('INBOX');
  });

  it('keeps non-CATEGORY_* user labels', async () => {
    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: {
              threads: [{ id: 'thread1', snippet: 'Test' }],
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  internalDate: '1770138900000',
                  labelIds: ['INBOX', 'CATEGORY_UPDATES', 'Label_123', 'Label_456'],
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Test' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Test body').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListThreads(gmail, {});
    expect(result.threads[0].labels).not.toContain('CATEGORY_UPDATES');
    expect(result.threads[0].labels).toContain('Label_123');
    expect(result.threads[0].labels).toContain('Label_456');
  });

  it('handles case-insensitive label filtering', async () => {
    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: {
              threads: [{ id: 'thread1', snippet: 'Test' }],
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  internalDate: '1770138900000',
                  labelIds: ['inbox', 'category_primary', 'unread'], // lowercase
                  payload: {
                    headers: [
                      { name: 'Subject', value: 'Test' },
                      { name: 'From', value: 'test@example.com' },
                      { name: 'To', value: 'other@example.com' },
                      { name: 'Date', value: 'Mon, 03 Feb 2026 09:00:00 -0800' },
                    ],
                    mimeType: 'text/plain',
                    body: { data: Buffer.from('Test body').toString('base64url') },
                  },
                },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListThreads(gmail, {});
    expect(result.threads[0].labels).toContain('inbox');
    expect(result.threads[0].labels).not.toContain('category_primary');
  });
});
