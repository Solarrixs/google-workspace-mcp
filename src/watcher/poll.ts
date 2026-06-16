import type { gmail_v1 } from 'googleapis';
import { getMessageBody, stripQuotedText, stripSignature, getHeader } from '../gmail/threads.js';
import type { WatcherConfig } from './config.js';

export interface EmailContext {
  messageId: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  body: string;
  labels: string[];
  accountAlias: string;
}

export async function seedHistoryId(gmail: gmail_v1.Gmail): Promise<string> {
  const profile = await gmail.users.getProfile({ userId: 'me' });
  return profile.data.historyId || '';
}

export async function pollForNewMessages(
  gmail: gmail_v1.Gmail,
  lastHistoryId: string,
  config: WatcherConfig
): Promise<{ messages: Array<{ id: string }>; newHistoryId: string }> {
  const messages: Array<{ id: string }> = [];
  let pageToken: string | undefined;
  let newHistoryId = lastHistoryId;

  try {
    do {
      const res = await gmail.users.history.list({
        userId: 'me',
        startHistoryId: lastHistoryId,
        historyTypes: ['messageAdded'],
        labelId: 'INBOX',
        pageToken,
      });

      newHistoryId = res.data.historyId || lastHistoryId;

      for (const history of res.data.history || []) {
        for (const added of history.messagesAdded || []) {
          const msg = added.message;
          if (!msg?.id || !msg.labelIds) continue;
          // Only process INBOX + UNREAD messages
          if (msg.labelIds.includes('INBOX') && msg.labelIds.includes('UNREAD')) {
            messages.push({ id: msg.id });
          }
        }
      }

      pageToken = res.data.nextPageToken || undefined;
    } while (pageToken);
  } catch (err: any) {
    // 404 means historyId is too old — need to re-seed
    if (err?.code === 404 || err?.status === 404) {
      const freshId = await seedHistoryId(gmail);
      return { messages: [], newHistoryId: freshId };
    }
    throw err;
  }

  return { messages, newHistoryId };
}

function matchesGlob(email: string, pattern: string): boolean {
  // Simple glob matching: * matches any sequence of chars
  const regex = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$',
    'i'
  );
  return regex.test(email);
}

export async function fetchAndProcessMessage(
  gmail: gmail_v1.Gmail,
  messageId: string,
  config: WatcherConfig,
  accountAlias: string
): Promise<EmailContext | null> {
  const res = await gmail.users.messages.get({
    userId: 'me',
    id: messageId,
    format: 'full',
  });

  const msg = res.data;
  if (!msg.payload) return null;

  const headers = msg.payload.headers || [];
  const labels = msg.labelIds || [];

  // Check skip labels
  const lowLabels = labels.map((l) => l.toLowerCase());
  for (const skipLabel of config.skip_labels) {
    if (lowLabels.includes(skipLabel.toLowerCase())) {
      return null;
    }
  }

  // Check skip senders
  const from = getHeader(headers, 'From');
  if (config.skip_senders.length > 0) {
    const fromEmail = from.match(/<([^>]+)>/)?.[1] || from;
    if (config.skip_senders.some((pattern) => matchesGlob(fromEmail, pattern))) {
      return null;
    }
  }

  // Process body through the text pipeline
  let body = getMessageBody(msg.payload);
  body = stripQuotedText(body);
  body = stripSignature(body);
  if (body.length > config.max_body_length) {
    body = body.substring(0, config.max_body_length) + '\n\n[truncated]';
  }

  return {
    messageId: msg.id || messageId,
    threadId: msg.threadId || '',
    from,
    to: getHeader(headers, 'To'),
    subject: getHeader(headers, 'Subject'),
    date: getHeader(headers, 'Date'),
    body,
    labels,
    accountAlias,
  };
}
