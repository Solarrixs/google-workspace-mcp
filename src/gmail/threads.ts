import type { gmail_v1 } from 'googleapis';
import { compact } from '../utils.js';

interface ListThreadsParams {
  query?: string;
  max_results?: number;
  page_token?: string;
}

export function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}

export function getHeader(
  headers: gmail_v1.Schema$MessagePartHeader[] | undefined,
  name: string
): string {
  if (!headers) return '';
  const header = headers.find(
    (h) => h.name?.toLowerCase() === name.toLowerCase()
  );
  return header?.value || '';
}

export function extractEmailAddresses(headerValue: string): string[] {
  if (!headerValue) return [];
  // Match email addresses in angle brackets or standalone
  const matches = headerValue.match(
    /<?([a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,})>?/g
  );
  if (!matches) return [];
  return matches.map((m) => m.replace(/[<>]/g, ''));
}

export function stripHtmlTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function getMessageBody(
  payload: gmail_v1.Schema$MessagePart | undefined
): string {
  if (!payload) return '';

  let text = '';
  let html = '';

  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    text = decodeBase64Url(payload.body.data);
  } else if (payload.mimeType === 'text/html' && payload.body?.data) {
    html = decodeBase64Url(payload.body.data);
  }

  // Check parts recursively
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text = decodeBase64Url(part.body.data);
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html = decodeBase64Url(part.body.data);
      } else if (part.parts) {
        // Nested multipart
        const nested = getMessageBody(part);
        if (nested) {
          // We can't distinguish text vs html from the recursive call,
          // but since we prefer text, only use nested if we don't have text yet
          if (!text) text = nested;
        }
      }
    }
  }

  if (text) return text;
  if (html) return stripHtmlTags(html);
  return '';
}

export function stripQuotedText(text: string): string {
  if (!text) return text;

  // Find the first occurrence of any quote header pattern and truncate from there
  const patterns = [
    // Gmail-style: "On Mon, Feb 3, 2026 at 9:15 AM Name <email> wrote:"
    /^On .+wrote:\s*$/m,
    // Apple Mail: "On Feb 3, 2026, at 9:15 AM, Name <email> wrote:"
    /^On .+, at .+wrote:\s*$/m,
    // Outlook-style separator (line of underscores followed by From:)
    /^_{10,}\s*\n\s*From:/m,
    // Generic consecutive > quoted lines preceded by blank line
    /\n\n>+ /,
  ];

  let earliestIndex = text.length;

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match.index !== undefined && match.index < earliestIndex) {
      earliestIndex = match.index;
    }
  }

  if (earliestIndex < text.length) {
    const result = text.substring(0, earliestIndex).trimEnd();
    return result || '[quoted reply only — no new content]';
  }

  return text;
}

export function stripSignature(text: string): string {
  if (!text) return text;

  let result = text;

  // Standard signature delimiters - find earliest and truncate
  const sigDelimiters = [
    /^-- \n/m,   // standard (note trailing space)
    /^—\n/m,     // em dash
    /^__\n/m,    // underscores
  ];

  let earliestSig = result.length;
  for (const pattern of sigDelimiters) {
    const match = result.match(pattern);
    if (match && match.index !== undefined && match.index < earliestSig) {
      earliestSig = match.index;
    }
  }
  if (earliestSig < result.length) {
    result = result.substring(0, earliestSig).trimEnd();
  }

  // Mobile boilerplate - remove line and everything after
  const mobilePatterns = [
    /^Sent from my iPhone.*$/m,
    /^Sent from my iPad.*$/m,
    /^Sent from my Galaxy.*$/m,
    /^Sent from my Samsung.*$/m,
    /^Sent from Mail for.*$/m,
    /^Get Outlook for.*$/m,
    /^Sent from Yahoo Mail.*$/m,
  ];

  for (const pattern of mobilePatterns) {
    const match = result.match(pattern);
    if (match && match.index !== undefined) {
      result = result.substring(0, match.index).trimEnd();
    }
  }

  // Legal/confidentiality boilerplate
  const legalPatterns = [
    /^CONFIDENTIALITY NOTICE.*$/m,
    /^DISCLAIMER.*$/m,
    /^This email and any attachments.*$/m,
    /^This message is intended only for.*$/m,
    /^If you are not the intended recipient.*$/m,
  ];

  for (const pattern of legalPatterns) {
    const match = result.match(pattern);
    if (match && match.index !== undefined) {
      result = result.substring(0, match.index).trimEnd();
    }
  }

  // Sign-off blocks: Best, Regards, Thanks, etc. followed only by name/title/whitespace
  const signOffPattern = /^(Best,?|Best regards,?|Regards,?|Kind regards,?|Warm regards,?|Thanks,?|Thank you,?|Many thanks,?|Cheers,?|Sincerely,?|All the best,?|Talk soon,?)\s*\n[\s\S]*$/mi;
  const signOffMatch = result.match(signOffPattern);
  if (signOffMatch && signOffMatch.index !== undefined) {
    // Only strip if what follows is just name/title/whitespace (no substantive content)
    const afterSignOff = result.substring(signOffMatch.index + signOffMatch[1].length).trim();
    const lines = afterSignOff.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    // If remaining lines are short (name, title, phone, etc.) - max 5 short lines
    const isJustSignature = lines.length <= 5 && lines.every(l => l.length < 80);
    if (isJustSignature) {
      result = result.substring(0, signOffMatch.index).trimEnd();
    }
  }

  return result;
}

export function getAttachments(
  payload: gmail_v1.Schema$MessagePart | undefined
): Array<{ filename: string; mime_type: string; size: number }> {
  const attachments: Array<{
    filename: string;
    mime_type: string;
    size: number;
  }> = [];

  if (!payload?.parts) return attachments;

  for (const part of payload.parts) {
    if (part.filename && part.filename.length > 0) {
      attachments.push({
        filename: part.filename,
        mime_type: part.mimeType || 'application/octet-stream',
        size: part.body?.size || 0,
      });
    }
    // Check nested parts
    if (part.parts) {
      attachments.push(...getAttachments(part));
    }
  }

  return attachments;
}

export async function handleListThreads(
  gmail: gmail_v1.Gmail,
  params: ListThreadsParams
) {
  const maxResults = params.max_results || 25;

  const listRes = await gmail.users.threads.list({
    userId: 'me',
    q: params.query,
    maxResults,
    pageToken: params.page_token,
  });

  const threadIds = listRes.data.threads || [];

  const threads = await Promise.all(
    threadIds.map(async (t) => {
      const threadRes = await gmail.users.threads.get({
        userId: 'me',
        id: t.id!,
        format: 'metadata',
        metadataHeaders: ['Subject'],
      });

      const messages = threadRes.data.messages || [];
      const firstMsg = messages[0];
      const lastMsg = messages[messages.length - 1];

      const subject = getHeader(firstMsg?.payload?.headers, 'Subject');
      const lastDate = lastMsg?.internalDate
        ? new Date(parseInt(lastMsg.internalDate, 10)).toISOString()
        : '';

      // Check labels for unread
      const labels = lastMsg?.labelIds || [];
      const isUnread = labels.includes('UNREAD');

      // Cap snippet at 150 chars
      let snippet = t.snippet || threadRes.data.snippet || '';
      if (snippet.length > 150) {
        snippet = snippet.substring(0, 150) + '...';
      }

      // Filter labels to actionable ones only
      const KEEP_LABELS = new Set(['INBOX', 'UNREAD', 'SENT', 'IMPORTANT', 'STARRED', 'DRAFT']);
      const filteredLabels = labels.filter(
        (l) => KEEP_LABELS.has(l) || !l.startsWith('CATEGORY_')
      );

      return compact({
        id: t.id,
        snippet,
        subject,
        last_message_date: lastDate,
        message_count: messages.length,
        labels: filteredLabels,
        ...(isUnread ? { is_unread: true } : {}),
      });
    })
  );

  return {
    threads,
    next_page_token: listRes.data.nextPageToken || null,
    count: threads.length,
  };
}

export async function handleGetThread(
  gmail: gmail_v1.Gmail,
  params: { thread_id: string; format?: string }
) {
  const format = params.format === 'minimal' ? 'minimal' : 'full';

  const threadRes = await gmail.users.threads.get({
    userId: 'me',
    id: params.thread_id,
    format: format as 'full' | 'minimal',
  });

  const messages = threadRes.data.messages || [];
  const firstMsg = messages[0];
  const subject = getHeader(firstMsg?.payload?.headers, 'Subject');

  const parsedMessages = messages.map((msg) => {
    const headers = msg.payload?.headers;
    let bodyText = format === 'full' ? getMessageBody(msg.payload) : '';
    const attachments = format === 'full' ? getAttachments(msg.payload) : [];

    if (bodyText) {
      bodyText = stripQuotedText(bodyText);
      bodyText = stripSignature(bodyText);
      if (bodyText.length > 2500) {
        bodyText = bodyText.substring(0, 2500) + '\n\n[truncated: ' + bodyText.length + ' chars]';
      }
    }

    return compact({
      id: msg.id,
      from: getHeader(headers, 'From'),
      to: getHeader(headers, 'To'),
      cc: getHeader(headers, 'Cc'),
      date: getHeader(headers, 'Date'),
      body_text: bodyText,
      attachments,
    });
  });

  return {
    thread_id: params.thread_id,
    subject,
    messages: parsedMessages,
  };
}

