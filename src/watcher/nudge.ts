import type { gmail_v1 } from 'googleapis';
import { getHeader, extractEmailAddresses } from '../gmail/threads.js';
import type { WatcherState } from './state.js';
import { isNudged } from './state.js';
import type { WatcherConfig } from './config.js';

export interface NudgeCandidate {
  threadId: string;
  originalSubject: string;
  recipientEmail: string;
  recipientName: string;
  sentDate: string;
  daysSinceSent: number;
  snippet: string;
  accountAlias: string;
}

export async function checkForStaleThreads(
  gmail: gmail_v1.Gmail,
  state: WatcherState,
  config: WatcherConfig,
  accountAlias: string
): Promise<NudgeCandidate[]> {
  // Gate: skip if last check was too recent
  if (state.lastNudgeCheck) {
    const lastCheck = new Date(state.lastNudgeCheck);
    const hoursSince = (Date.now() - lastCheck.getTime()) / (1000 * 60 * 60);
    if (hoursSince < config.nudge.check_interval_hours) {
      return [];
    }
  }

  const staleDays = config.nudge.stale_days;
  const query = `in:sent older_than:${staleDays}d newer_than:12d`;

  const listRes = await gmail.users.threads.list({
    userId: 'me',
    q: query,
    maxResults: config.nudge.max_per_cycle * 3, // fetch extra to account for filtering
  });

  const threads = listRes.data.threads || [];
  const candidates: NudgeCandidate[] = [];

  for (const thread of threads) {
    if (candidates.length >= config.nudge.max_per_cycle) break;
    if (!thread.id) continue;
    if (isNudged(state, thread.id)) continue;

    try {
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: thread.id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Subject', 'Date'],
      });

      const messages = threadRes.data.messages || [];
      if (messages.length === 0) continue;

      // Check if the last message is from the user (sent by us, no inbound reply)
      const lastMsg = messages[messages.length - 1];
      const lastLabels = lastMsg.labelIds || [];
      if (!lastLabels.includes('SENT')) continue;

      // Get the sent message details
      const headers = lastMsg.payload?.headers || [];
      const toHeader = getHeader(headers, 'To');
      const recipientEmails = extractEmailAddresses(toHeader);
      if (recipientEmails.length === 0) continue;

      const subject = getHeader(headers, 'Subject');
      const dateStr = getHeader(headers, 'Date');
      const sentDate = dateStr ? new Date(dateStr) : new Date(parseInt(lastMsg.internalDate || '0', 10));
      const daysSinceSent = Math.floor((Date.now() - sentDate.getTime()) / (1000 * 60 * 60 * 24));

      // Extract recipient name from To header
      const toMatch = toHeader.match(/^([^<]+)</);
      const recipientName = toMatch ? toMatch[1].trim().replace(/"/g, '') : recipientEmails[0];

      candidates.push({
        threadId: thread.id,
        originalSubject: subject,
        recipientEmail: recipientEmails[0],
        recipientName,
        sentDate: sentDate.toISOString(),
        daysSinceSent,
        snippet: thread.snippet || '',
        accountAlias,
      });
    } catch {
      // Skip threads that fail to fetch
      continue;
    }
  }

  // Update last check time
  state.lastNudgeCheck = new Date().toISOString();

  return candidates;
}
