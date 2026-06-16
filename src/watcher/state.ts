import * as fs from 'fs';
import * as path from 'path';
import { TOKEN_DIR } from '../auth.js';

const STATE_PATH = path.join(TOKEN_DIR, 'watcher-state.json');
const MAX_PROCESSED = 200;
const MAX_NUDGED = 500;

export interface WatcherState {
  lastHistoryId: Record<string, string | null>;
  processedMessageIds: string[];
  nudgedThreadIds: string[];
  lastNudgeCheck: string | null;
  lastPollTime: string | null;
}

function defaultState(): WatcherState {
  return {
    lastHistoryId: {},
    processedMessageIds: [],
    nudgedThreadIds: [],
    lastNudgeCheck: null,
    lastPollTime: null,
  };
}

export function loadState(): WatcherState {
  try {
    if (fs.existsSync(STATE_PATH)) {
      const raw = fs.readFileSync(STATE_PATH, 'utf-8');
      if (!raw.trim()) return defaultState();
      return { ...defaultState(), ...JSON.parse(raw) };
    }
  } catch {
    // Corrupted state file — start fresh
  }
  return defaultState();
}

export function saveState(state: WatcherState): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  const tmpPath = STATE_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(state, null, 2));
  fs.renameSync(tmpPath, STATE_PATH);
}

export function addProcessedMessageId(state: WatcherState, messageId: string): void {
  state.processedMessageIds.push(messageId);
  if (state.processedMessageIds.length > MAX_PROCESSED) {
    state.processedMessageIds = state.processedMessageIds.slice(-MAX_PROCESSED);
  }
}

export function isProcessed(state: WatcherState, messageId: string): boolean {
  return state.processedMessageIds.includes(messageId);
}

export function addNudgedThreadId(state: WatcherState, threadId: string): void {
  state.nudgedThreadIds.push(threadId);
  if (state.nudgedThreadIds.length > MAX_NUDGED) {
    state.nudgedThreadIds = state.nudgedThreadIds.slice(-MAX_NUDGED);
  }
}

export function isNudged(state: WatcherState, threadId: string): boolean {
  return state.nudgedThreadIds.includes(threadId);
}
