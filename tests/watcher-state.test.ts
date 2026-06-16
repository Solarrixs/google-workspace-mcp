import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import { loadState, saveState, addProcessedMessageId, isProcessed, addNudgedThreadId, isNudged } from '../src/watcher/state.js';
import type { WatcherState } from '../src/watcher/state.js';

// Mock fs
vi.mock('fs');

describe('watcher state', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe('loadState', () => {
    it('returns default state when file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      const state = loadState();
      expect(state.processedMessageIds).toEqual([]);
      expect(state.nudgedThreadIds).toEqual([]);
      expect(state.lastNudgeCheck).toBeNull();
      expect(state.lastPollTime).toBeNull();
      expect(state.lastHistoryId).toEqual({});
    });

    it('loads state from file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({
        lastHistoryId: { work: '12345' },
        processedMessageIds: ['msg1'],
        nudgedThreadIds: ['thread1'],
        lastNudgeCheck: '2026-01-01T00:00:00Z',
        lastPollTime: '2026-01-01T00:00:00Z',
      }));
      const state = loadState();
      expect(state.lastHistoryId.work).toBe('12345');
      expect(state.processedMessageIds).toEqual(['msg1']);
    });

    it('returns default state on corrupted file', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('not json{{{');
      const state = loadState();
      expect(state.processedMessageIds).toEqual([]);
    });
  });

  describe('saveState', () => {
    it('writes state atomically', () => {
      const state: WatcherState = {
        lastHistoryId: { work: '999' },
        processedMessageIds: ['a'],
        nudgedThreadIds: [],
        lastNudgeCheck: null,
        lastPollTime: null,
      };
      saveState(state);
      expect(fs.mkdirSync).toHaveBeenCalled();
      expect(fs.writeFileSync).toHaveBeenCalled();
      expect(fs.renameSync).toHaveBeenCalled();
    });
  });

  describe('ring buffers', () => {
    it('caps processedMessageIds at 200', () => {
      const state = loadState();
      vi.mocked(fs.existsSync).mockReturnValue(false);
      for (let i = 0; i < 210; i++) {
        addProcessedMessageId(state, `msg-${i}`);
      }
      expect(state.processedMessageIds.length).toBe(200);
      expect(isProcessed(state, 'msg-209')).toBe(true);
      expect(isProcessed(state, 'msg-0')).toBe(false);
    });

    it('caps nudgedThreadIds at 500', () => {
      const state: WatcherState = {
        lastHistoryId: {},
        processedMessageIds: [],
        nudgedThreadIds: [],
        lastNudgeCheck: null,
        lastPollTime: null,
      };
      for (let i = 0; i < 510; i++) {
        addNudgedThreadId(state, `thread-${i}`);
      }
      expect(state.nudgedThreadIds.length).toBe(500);
      expect(isNudged(state, 'thread-509')).toBe(true);
      expect(isNudged(state, 'thread-0')).toBe(false);
    });
  });
});
