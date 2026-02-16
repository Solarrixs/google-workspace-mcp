import { describe, it, expect, vi } from 'vitest';
import { buildRawEmail, handleCreateDraft } from '../src/gmail/drafts.js';

describe('buildRawEmail', () => {
  it('builds basic email with required fields', () => {
    const raw = buildRawEmail({
      to: 'recipient@example.com',
      from: 'maxx@engramcompute.com',
      subject: 'Test Subject',
      body: 'Hello there!',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('From: maxx@engramcompute.com');
    expect(decoded).toContain('To: recipient@example.com');
    expect(decoded).toContain('Subject: Test Subject');
    expect(decoded).toContain('Content-Type: text/plain; charset=utf-8');
    expect(decoded).toContain('MIME-Version: 1.0');
    expect(decoded).toContain('Hello there!');
  });

  it('includes CC and BCC headers when provided', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
      cc: 'cc@example.com',
      bcc: 'bcc@example.com',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('Cc: cc@example.com');
    expect(decoded).toContain('Bcc: bcc@example.com');
  });

  it('omits CC and BCC when not provided', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).not.toContain('Cc:');
    expect(decoded).not.toContain('Bcc:');
  });

  it('includes In-Reply-To and References for threaded replies', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Re: Original Subject',
      body: 'Reply body',
      inReplyTo: '<original-msg-id@gmail.com>',
      references: '<older-msg@gmail.com> <original-msg-id@gmail.com>',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('In-Reply-To: <original-msg-id@gmail.com>');
    expect(decoded).toContain(
      'References: <older-msg@gmail.com> <original-msg-id@gmail.com>'
    );
  });

  it('uses inReplyTo as References fallback when references not provided', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Re: Test',
      body: 'Body',
      inReplyTo: '<msg-id@gmail.com>',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('In-Reply-To: <msg-id@gmail.com>');
    expect(decoded).toContain('References: <msg-id@gmail.com>');
  });

  it('separates headers from body with blank line (CRLF)', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body text here',
    });

    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    // RFC 2822: headers and body separated by \r\n\r\n
    expect(decoded).toContain('\r\n\r\nBody text here');
  });

  it('produces valid base64url output', () => {
    const raw = buildRawEmail({
      to: 'to@example.com',
      from: 'from@example.com',
      subject: 'Test',
      body: 'Body',
    });

    // base64url should not contain +, /, or =
    expect(raw).not.toMatch(/[+/=]/);
    // Should be decodable
    expect(() => Buffer.from(raw, 'base64url')).not.toThrow();
  });
});

describe('handleCreateDraft', () => {
  function createMockGmail() {
    return {
      users: {
        getProfile: vi.fn().mockResolvedValue({
          data: { emailAddress: 'maxx@engramcompute.com' },
        }),
        threads: {
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [
                {
                  id: 'msg1',
                  payload: {
                    headers: [
                      { name: 'Message-ID', value: '<msg1@mail.gmail.com>' },
                      { name: 'References', value: '<msg0@mail.gmail.com>' },
                    ],
                  },
                },
                {
                  id: 'msg2',
                  payload: {
                    headers: [
                      { name: 'Message-ID', value: '<msg2@vendor.com>' },
                      {
                        name: 'References',
                        value: '<msg0@mail.gmail.com> <msg1@mail.gmail.com>',
                      },
                    ],
                  },
                },
              ],
            },
          }),
        },
        drafts: {
          create: vi.fn().mockResolvedValue({
            data: {
              id: 'draft1',
              message: { id: 'draftmsg1', threadId: 'thread1' },
            },
          }),
        },
      },
    } as any;
  }

  it('creates a simple draft (no threading)', async () => {
    const gmail = createMockGmail();
    const result = await handleCreateDraft(gmail, {
      to: 'recipient@example.com',
      subject: 'Test',
      body: 'Hello!',
    });

    expect(result.draft_id).toBe('draft1');
    expect(result.status).toContain('Draft created successfully');

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    expect(createCall.userId).toBe('me');

    // Decode the raw message
    const raw = createCall.requestBody.message.raw;
    const decoded = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(decoded).toContain('To: recipient@example.com');
    expect(decoded).toContain('From: maxx@engramcompute.com');
    expect(decoded).toContain('Subject: Test');
    expect(decoded).toContain('Hello!');
    // No threading headers
    expect(decoded).not.toContain('In-Reply-To');
    expect(decoded).not.toContain('References');
  });

  it('creates threaded reply with explicit in_reply_to', async () => {
    const gmail = createMockGmail();
    await handleCreateDraft(gmail, {
      to: 'vendor@example.com',
      subject: 'Re: Quote',
      body: 'Following up',
      thread_id: 'thread1',
      in_reply_to: '<explicit-msg-id@gmail.com>',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    expect(createCall.requestBody.message.threadId).toBe('thread1');

    const decoded = Buffer.from(
      createCall.requestBody.message.raw,
      'base64url'
    ).toString('utf-8');
    expect(decoded).toContain('In-Reply-To: <explicit-msg-id@gmail.com>');
    expect(decoded).toContain('References: <explicit-msg-id@gmail.com>');
  });

  it('auto-fetches Message-ID when thread_id provided without in_reply_to', async () => {
    const gmail = createMockGmail();
    await handleCreateDraft(gmail, {
      to: 'vendor@example.com',
      subject: 'Re: Quote',
      body: 'Following up',
      thread_id: 'thread1',
    });

    // Should have called threads.get to fetch Message-ID
    expect(gmail.users.threads.get).toHaveBeenCalledWith({
      userId: 'me',
      id: 'thread1',
      format: 'metadata',
      metadataHeaders: ['Message-ID', 'References'],
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(
      createCall.requestBody.message.raw,
      'base64url'
    ).toString('utf-8');

    // Should use last message's Message-ID
    expect(decoded).toContain('In-Reply-To: <msg2@vendor.com>');
    // Should build references chain from last message's References + its Message-ID
    expect(decoded).toContain(
      'References: <msg0@mail.gmail.com> <msg1@mail.gmail.com> <msg2@vendor.com>'
    );
  });

  it('includes CC in the draft when provided', async () => {
    const gmail = createMockGmail();
    await handleCreateDraft(gmail, {
      to: 'to@example.com',
      subject: 'Test',
      body: 'Body',
      cc: 'cc1@example.com, cc2@example.com',
    });

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    const decoded = Buffer.from(
      createCall.requestBody.message.raw,
      'base64url'
    ).toString('utf-8');
    expect(decoded).toContain('Cc: cc1@example.com, cc2@example.com');
  });
});
