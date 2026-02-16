import { describe, it, expect, vi } from 'vitest';
import { buildRawEmail, handleCreateDraft, handleUpdateDraft } from '../src/gmail/drafts.js';

describe('BUG-001: Draft update silently deletes body content', () => {
  it('preserves body when updating only subject in handleUpdateDraft', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'maxx@engramcompute.com' },
        }),
        drafts: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'draft1',
              message: {
                id: 'draftmsg1',
                threadId: 'thread1',
                payload: {
                  mimeType: 'multipart/alternative',
                  parts: [
                    {
                      mimeType: 'text/html',
                      body: {
                        data: Buffer.from('<div><p>Original body content</p></div>').toString('base64url'),
                      },
                    },
                  ],
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'draftmsg1' } },
          }),
        },
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [],
            },
          }),
        },
      },
    } as any;

    const result = await handleUpdateDraft(gmail, {
      draft_id: 'draft1',
      subject: 'Updated Subject',
    });

    expect(gmail.users.drafts.update).toHaveBeenCalled();

    const updateCall = gmail.users.drafts.update.mock.calls[0][0];
    const raw = updateCall.requestBody.message.raw;
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

    expect(decoded).toContain('Original body content');
    expect(decoded).toContain('Updated Subject');
  });

  it('preserves body when updating only CC in handleUpdateDraft', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'maxx@engramcompute.com' },
        }),
        drafts: {
          get: vi.fn().mockResolvedValue({
            data: {
              id: 'draft1',
              message: {
                id: 'draftmsg1',
                payload: {
                  mimeType: 'text/html',
                  body: {
                    data: Buffer.from('<div><p>Important message body</p></div>').toString('base64url'),
                  },
                },
              },
            },
          }),
          update: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'draftmsg1' } },
          }),
        },
      },
    } as any;

    await handleUpdateDraft(gmail, {
      draft_id: 'draft1',
      cc: 'new@example.com',
    });

    const updateCall = gmail.users.drafts.update.mock.calls[0][0];
    const decoded = Buffer.from(updateCall.requestBody.message.raw, 'base64url').toString('utf-8');

    expect(decoded).toContain('Important message body');
    expect(decoded).toContain('Cc: new@example.com');
  });
});

describe('BUG-002: RFC 2822 header injection', () => {
  it('removes CRLF from header values to prevent injection', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Hello\r\nBcc: attacker@evil.com',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Subject: Hello');
    expect(decoded).not.toMatch(/Subject:.*Bcc:/);
    expect(decoded).not.toMatch(/\r\n.*:/);
  });

  it('removes LF from header values', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Important\nCc: victim@example.com',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Subject: Important');
    expect(decoded).not.toMatch(/Subject:.*Cc:/);
  });

  it('sanitizes headers in CC, BCC, and threading headers', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Body',
      cc: 'cc1@example.com\r\nBcc: attacker@evil.com',
      bcc: 'bcc@example.com\nCc: victim@example.com',
      inReplyTo: '<msg1@example.com>\r\nCc: attacker2@evil.com',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

    expect(decoded).not.toContain('cc1@example.com\r\nBcc: attacker@evil.com');
    expect(decoded).not.toContain('bcc@example.com\nCc: victim@example.com');
    expect(decoded).not.toContain('<msg1@example.com>\r\nCc: attacker2@evil.com');
  });
});

describe('BUG-008: Non-ASCII headers not RFC 2047 encoded', () => {
  it('encodes non-ASCII characters in Subject header', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Re: café meeting',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?.*\?=/);
    expect(decoded).not.toMatch(/Subject: Re: café/);
  });

  it('encodes CJK characters in Subject header', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: '日本語のメール',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?.*\?=/);
    expect(decoded).not.toMatch(/Subject: 日本語のメール/);
  });

  it('encodes emoji in Subject header', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Party invitation 🎉',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Subject: =\?utf-8\?B\?.*\?=/);
    expect(decoded).not.toMatch(/Subject: Party invitation 🎉/);
  });

  it('does NOT encode pure ASCII headers', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Regular ASCII Subject',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).not.toMatch(/Subject: =\?utf-8\?B\?/);
    expect(decoded).toContain('Subject: Regular ASCII Subject');
  });

  it('encodes non-ASCII display names in From/To headers', () => {
    const raw = buildRawEmail({
      from: ' François <francois@example.com>',
      to: 'recipient@example.com',
      subject: 'Subject',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/From: =\?utf-8\?B\?.*\?=/);
  });
});

describe('BUG-009: getProfile() fallback to \'me\' is invalid', () => {
  it('handles missing emailAddress from getProfile gracefully', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: {},
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  payload: {
                    headers: [{ name: 'Message-ID', value: '<msg1@gmail.com>' }],
                  },
                },
              ],
            },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'draftmsg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Body',
    });

    expect(gmail.users.drafts.create).toHaveBeenCalled();
  });

  it('uses valid email address when getProfile returns one', async () => {
    const gmail = {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'maxx@engramcompute.com' },
        }),
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: { id: 'draft1', message: { id: 'draftmsg1' } },
          }),
        },
      },
    } as any;

    await handleCreateDraft(gmail, {
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(createCall.requestBody.message.raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('From: maxx@engramcompute.com');
    expect(decoded).not.toMatch(/From: me/);
  });
});

describe('BUG-025: Missing Date header in RFC 2822 output', () => {
  it('includes Date header in RFC 2822 output', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Test Subject',
      body: 'Hello!',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toMatch(/Date: [A-Z][a-z]{2}, \d{1,2} [A-Z][a-z]{2} \d{4}/);
    expect(decoded).toContain('Date:');
  });

  it('includes Date header with all other required headers', () => {
    const raw = buildRawEmail({
      from: 'maxx@engramcompute.com',
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Body',
      cc: 'cc@example.com',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');

    const dateIndex = decoded.indexOf('Date:');
    const contentTypeIndex = decoded.indexOf('Content-Type:');
    const bodyStart = decoded.indexOf('<div');

    expect(dateIndex).toBeGreaterThan(-1);
    expect(contentTypeIndex).toBeGreaterThan(dateIndex);
    expect(bodyStart).toBeGreaterThan(contentTypeIndex);
  });
});
