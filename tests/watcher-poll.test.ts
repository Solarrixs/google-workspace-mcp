import { describe, it, expect, vi } from 'vitest';
import { seedHistoryId, pollForNewMessages, fetchAndProcessMessage } from '../src/watcher/poll.js';
import type { WatcherConfig } from '../src/watcher/config.js';

const mockConfig: WatcherConfig = {
  poll_interval_ms: 900_000,
  model: 'sonnet',
  max_body_length: 3000,
  timeout_ms: 120_000,
  skip_labels: ['AI/Marketing', 'CATEGORY_PROMOTIONS'],
  skip_senders: ['*@noreply.github.com'],
  nudge: { enabled: true, stale_days: 5, check_interval_hours: 6, max_per_cycle: 5 },
  templates: { enabled: true, max_in_prompt: 8 },
  notify: true,
};

function createMockGmail(overrides: any = {}) {
  return {
    users: {
      getProfile: vi.fn().mockResolvedValue({ data: { historyId: '99999', emailAddress: 'test@example.com' } }),
      history: {
        list: vi.fn().mockResolvedValue({ data: { historyId: '100000', history: [], nextPageToken: null } }),
      },
      messages: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'msg1',
            threadId: 'thread1',
            labelIds: ['INBOX', 'UNREAD'],
            payload: {
              headers: [
                { name: 'From', value: 'sender@example.com' },
                { name: 'To', value: 'me@example.com' },
                { name: 'Subject', value: 'Test Email' },
                { name: 'Date', value: 'Mon, 1 Jan 2026 00:00:00 +0000' },
              ],
              mimeType: 'text/plain',
              body: { data: Buffer.from('Hello world').toString('base64url') },
            },
          },
        }),
      },
      ...overrides,
    },
  } as any;
}

describe('poll', () => {
  describe('seedHistoryId', () => {
    it('returns historyId from profile', async () => {
      const gmail = createMockGmail();
      const id = await seedHistoryId(gmail);
      expect(id).toBe('99999');
    });
  });

  describe('pollForNewMessages', () => {
    it('returns empty on no new messages', async () => {
      const gmail = createMockGmail();
      const result = await pollForNewMessages(gmail, '99999', mockConfig);
      expect(result.messages).toEqual([]);
      expect(result.newHistoryId).toBe('100000');
    });

    it('returns INBOX+UNREAD messages', async () => {
      const gmail = createMockGmail();
      gmail.users.history.list.mockResolvedValue({
        data: {
          historyId: '100001',
          history: [{
            messagesAdded: [{
              message: { id: 'msg1', labelIds: ['INBOX', 'UNREAD'] },
            }],
          }],
        },
      });
      const result = await pollForNewMessages(gmail, '99999', mockConfig);
      expect(result.messages).toEqual([{ id: 'msg1' }]);
    });

    it('re-seeds on 404 error', async () => {
      const gmail = createMockGmail();
      gmail.users.history.list.mockRejectedValue({ code: 404 });
      const result = await pollForNewMessages(gmail, 'stale-id', mockConfig);
      expect(result.messages).toEqual([]);
      expect(result.newHistoryId).toBe('99999');
    });
  });

  describe('fetchAndProcessMessage', () => {
    it('returns EmailContext for valid message', async () => {
      const gmail = createMockGmail();
      const result = await fetchAndProcessMessage(gmail, 'msg1', mockConfig, 'work');
      expect(result).not.toBeNull();
      expect(result!.from).toBe('sender@example.com');
      expect(result!.subject).toBe('Test Email');
      expect(result!.accountAlias).toBe('work');
    });

    it('returns null when skip label matches', async () => {
      const gmail = createMockGmail();
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX', 'UNREAD', 'AI/Marketing'],
          payload: {
            headers: [{ name: 'From', value: 'spam@example.com' }],
            mimeType: 'text/plain',
            body: { data: Buffer.from('promo').toString('base64url') },
          },
        },
      });
      const result = await fetchAndProcessMessage(gmail, 'msg1', mockConfig, 'work');
      expect(result).toBeNull();
    });

    it('returns null when skip sender matches', async () => {
      const gmail = createMockGmail();
      gmail.users.messages.get.mockResolvedValue({
        data: {
          id: 'msg1',
          threadId: 'thread1',
          labelIds: ['INBOX', 'UNREAD'],
          payload: {
            headers: [{ name: 'From', value: 'bot <notifications@noreply.github.com>' }],
            mimeType: 'text/plain',
            body: { data: Buffer.from('gh notification').toString('base64url') },
          },
        },
      });
      const result = await fetchAndProcessMessage(gmail, 'msg1', mockConfig, 'work');
      expect(result).toBeNull();
    });
  });
});
