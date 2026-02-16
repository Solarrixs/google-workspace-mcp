import { describe, it, expect, vi } from 'vitest';
import { handleListLabels } from '../src/gmail/labels.js';

describe('handleListLabels', () => {
  it('returns formatted label list', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({
            data: {
              labels: [
                { id: 'INBOX', name: 'INBOX', type: 'system' },
                { id: 'SENT', name: 'SENT', type: 'system' },
                { id: 'Label_123', name: 'Superhuman/Reminded', type: 'user' },
                { id: 'Label_456', name: 'marketing', type: 'user' },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);

    expect(result.labels).toHaveLength(4);
    expect(result.labels[0]).toEqual({
      id: 'INBOX',
      name: 'INBOX',
      type: 'system',
    });
    expect(result.labels[2]).toEqual({
      id: 'Label_123',
      name: 'Superhuman/Reminded',
      type: 'user',
    });
  });

  it('handles empty labels list', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({ data: { labels: [] } }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels).toHaveLength(0);
  });

  it('handles null labels response', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels).toHaveLength(0);
  });

  it('lowercases label type', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({
            data: {
              labels: [{ id: 'x', name: 'Test', type: 'USER' }],
            },
          }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels[0].type).toBe('user');
  });
});
