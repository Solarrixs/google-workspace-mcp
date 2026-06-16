import { describe, it, expect, vi } from 'vitest';
import { checkForStaleThreads } from '../src/watcher/nudge.js';
import type { WatcherState } from '../src/watcher/state.js';
import type { WatcherConfig } from '../src/watcher/config.js';

const mockConfig: WatcherConfig = {
  poll_interval_ms: 900_000,
  model: 'sonnet',
  max_body_length: 3000,
  timeout_ms: 120_000,
  skip_labels: [],
  skip_senders: [],
  nudge: { enabled: true, stale_days: 5, check_interval_hours: 6, max_per_cycle: 5 },
  templates: { enabled: true, max_in_prompt: 8 },
  notify: true,
};

function freshState(): WatcherState {
  return {
    lastHistoryId: {},
    processedMessageIds: [],
    nudgedThreadIds: [],
    lastNudgeCheck: null,
    lastPollTime: null,
  };
}

describe('nudge detection', () => {
  it('skips check if last check was too recent', async () => {
    const state = freshState();
    state.lastNudgeCheck = new Date().toISOString(); // just checked

    const gmail = { users: { threads: { list: vi.fn() } } } as any;
    const result = await checkForStaleThreads(gmail, state, mockConfig, 'work');
    expect(result).toEqual([]);
    expect(gmail.users.threads.list).not.toHaveBeenCalled();
  });

  it('finds stale threads with no reply', async () => {
    const state = freshState();
    const sentDate = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000).toUTCString(); // 6 days ago

    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: {
              threads: [{ id: 'thread-stale', snippet: 'Hey, interested?' }],
            },
          }),
          get: vi.fn().mockResolvedValue({
            data: {
              messages: [{
                labelIds: ['SENT'],
                internalDate: String(Date.now() - 6 * 24 * 60 * 60 * 1000),
                payload: {
                  headers: [
                    { name: 'To', value: 'Jane Doe <jane@example.com>' },
                    { name: 'Subject', value: 'Exciting opportunity' },
                    { name: 'Date', value: sentDate },
                  ],
                },
              }],
            },
          }),
        },
      },
    } as any;

    const result = await checkForStaleThreads(gmail, state, mockConfig, 'work');
    expect(result.length).toBe(1);
    expect(result[0].threadId).toBe('thread-stale');
    expect(result[0].recipientEmail).toBe('jane@example.com');
    expect(result[0].daysSinceSent).toBeGreaterThanOrEqual(5);
  });

  it('skips already nudged threads', async () => {
    const state = freshState();
    state.nudgedThreadIds = ['thread-stale'];

    const gmail = {
      users: {
        threads: {
          list: vi.fn().mockResolvedValue({
            data: { threads: [{ id: 'thread-stale', snippet: 'old' }] },
          }),
          get: vi.fn(),
        },
      },
    } as any;

    const result = await checkForStaleThreads(gmail, state, mockConfig, 'work');
    expect(result).toEqual([]);
    expect(gmail.users.threads.get).not.toHaveBeenCalled();
  });
});
