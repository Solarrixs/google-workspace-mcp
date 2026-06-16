import type { gmail_v1 } from 'googleapis';
import { compact } from '../utils.js';
import { getHeader as getHeaderValue, stripHtmlTags } from './threads.js';

const profileCache = new Map<gmail_v1.Gmail, string>();

async function getFromEmail(gmail: gmail_v1.Gmail): Promise<string> {
  const cached = profileCache.get(gmail);
  if (cached) return cached;
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const email = profile.data.emailAddress || 'me';
  profileCache.set(gmail, email);
  return email;
}

interface CreateDraftParams {
  to: string;
  subject: string;
  body: string;
  thread_id?: string;
  in_reply_to?: string;
  cc?: string;
  bcc?: string;
}

const NUMBERED_LIST_RE = /^\d+[\.\)]\s/;
const BULLET_LIST_RE = /^[-*]\s/;
const MARKDOWN_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/;
const MARKDOWN_LINK_RE_GLOBAL = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

function isNumberedListBlock(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => NUMBERED_LIST_RE.test(l));
}

function isBulletListBlock(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => BULLET_LIST_RE.test(l));
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function linkify(html: string): string {
  // Convert markdown-style [text](url) to <a> tags
  // Runs AFTER escapeHtml so the brackets/parens are still literal (not HTML entities)
  return html.replace(
    MARKDOWN_LINK_RE_GLOBAL,
    '<a href="$2" style="color:#1a73e8;text-decoration:none">$1</a>'
  );
}

function hasRichFormatting(text: string): boolean {
  if (MARKDOWN_LINK_RE.test(text)) return true;
  const lines = text.split('\n');
  for (const line of lines) {
    if (NUMBERED_LIST_RE.test(line) || BULLET_LIST_RE.test(line)) return true;
  }
  return false;
}

function plainTextToHtml(text: string): string {
  const escaped = escapeHtml(text);

  // Split into blocks on double newlines
  const blocks = escaped.split(/\n\n+/);

  return blocks
    .map((block) => {
      const lines = block.split('\n');

      // Detect numbered list (all lines start with "1." or "1)")
      if (isNumberedListBlock(lines)) {
        const items = lines
          .map((l) => `<li>${linkify(l.replace(/^\d+[\.\)]\s/, ''))}</li>`)
          .join('\n');
        return `<ol style="margin:0;padding-left:24px">\n${items}\n</ol>`;
      }

      // Detect bullet list (all lines start with "- " or "* ")
      if (isBulletListBlock(lines)) {
        const items = lines
          .map((l) => `<li>${linkify(l.replace(/^[-*]\s/, ''))}</li>`)
          .join('\n');
        return `<ul style="margin:0;padding-left:24px">\n${items}\n</ul>`;
      }

      // Regular paragraph — single newlines become <br>
      const inner = block.replace(/\n/g, '<br>');
      return `<p style="margin:0">${linkify(inner)}</p>`;
    })
    .join('<br>');
}

export function buildRawEmail(params: {
  to: string;
  from: string;
  subject: string;
  body: string;
  cc?: string;
  bcc?: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const encodeNonAscii = (s: string) =>
    `=?utf-8?B?${Buffer.from(s, 'utf-8').toString('base64')}?=`;

  const sanitizeHeader = (v: string) => {
    const cleaned = v.replace(/[\r\n]/g, '');
    if (!/[^\x00-\x7F]/.test(cleaned)) return cleaned;
    // Handle comma-separated addresses: encode each display name individually
    return cleaned
      .split(/,\s*/)
      .map((addr) => {
        const m = addr.match(/^(.*?)\s*(<[^>]+>)$/);
        if (m) return `${encodeNonAscii(m[1].trim())} ${m[2]}`;
        return encodeNonAscii(addr);
      })
      .join(', ');
  };

  const useHtml = hasRichFormatting(params.body);
  const emailBody = useHtml
    ? `<div style="font-family:sans-serif;font-size:14px;color:#222">${plainTextToHtml(params.body)}</div>`
    : params.body;

  const lines: string[] = [
    `From: ${sanitizeHeader(params.from)}`,
    `To: ${sanitizeHeader(params.to)}`,
    `Subject: ${sanitizeHeader(params.subject)}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    useHtml ? 'Content-Type: text/html; charset=utf-8' : 'Content-Type: text/plain; charset=utf-8',
  ];

  if (params.cc) {
    lines.push(`Cc: ${sanitizeHeader(params.cc)}`);
  }
  if (params.bcc) {
    lines.push(`Bcc: ${sanitizeHeader(params.bcc)}`);
  }
  if (params.inReplyTo) {
    lines.push(`In-Reply-To: ${sanitizeHeader(params.inReplyTo)}`);
    lines.push(`References: ${sanitizeHeader(params.references || params.inReplyTo)}`);
  }

  // Empty line separates headers from body
  lines.push('', emailBody);

  return Buffer.from(lines.join('\r\n')).toString('base64url');
}

async function resolveThreadingHeaders(
  gmail: gmail_v1.Gmail,
  threadId: string,
  inReplyTo?: string
): Promise<{ inReplyTo?: string; references?: string }> {
  if (inReplyTo) return { inReplyTo, references: inReplyTo };

  const threadRes = await gmail.users.threads.get({
    userId: 'me',
    id: threadId,
    format: 'metadata',
    metadataHeaders: ['Message-ID', 'References'],
  });

  const messages = threadRes.data.messages || [];
  const lastMsg = messages[messages.length - 1];
  if (!lastMsg?.payload?.headers) return {};

  const msgIdHeader = lastMsg.payload.headers.find(
    (h) => h.name?.toLowerCase() === 'message-id'
  );
  const resolvedInReplyTo = msgIdHeader?.value;
  if (!resolvedInReplyTo) return {};

  const refHeader = lastMsg.payload.headers.find(
    (h) => h.name?.toLowerCase() === 'references'
  );
  const references = refHeader?.value
    ? `${refHeader.value} ${resolvedInReplyTo}`
    : resolvedInReplyTo;

  return { inReplyTo: resolvedInReplyTo, references };
}

export async function handleCreateDraft(
  gmail: gmail_v1.Gmail,
  params: CreateDraftParams
) {
  // Get the user's email address for the From header
  const fromEmail = await getFromEmail(gmail);

  // Resolve threading headers (auto-fetches last message's Message-ID if needed)
  let inReplyTo = params.in_reply_to;
  let references = params.in_reply_to;

  if (params.thread_id) {
    try {
      const threading = await resolveThreadingHeaders(gmail, params.thread_id, params.in_reply_to);
      inReplyTo = threading.inReplyTo;
      references = threading.references;
    } catch {
      // Thread may have been deleted — proceed without threading headers
    }
  }

  const raw = buildRawEmail({
    to: params.to,
    from: fromEmail,
    subject: params.subject,
    body: params.body,
    cc: params.cc,
    bcc: params.bcc,
    inReplyTo,
    references,
  });

  const draftRes = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: {
      message: {
        raw,
        threadId: params.thread_id,
      },
    },
  });

  return compact({
    draft_id: draftRes.data.id,
    message_id: draftRes.data.message?.id,
    thread_id: draftRes.data.message?.threadId,
    status: 'Draft created.',
  });
}

interface UpdateDraftParams {
  draft_id: string;
  to?: string;
  subject?: string;
  body?: string;
  thread_id?: string;
  in_reply_to?: string;
  cc?: string;
  bcc?: string;
}

export async function handleUpdateDraft(
  gmail: gmail_v1.Gmail,
  params: UpdateDraftParams
) {
  // Fetch existing draft to get current values
  const needsBody = !params.body;
  const existing = await gmail.users.drafts.get({
    userId: 'me',
    id: params.draft_id,
    format: needsBody ? 'full' : 'metadata',
  });

  const existingHeaders = existing.data.message?.payload?.headers || [];
  const getHeader = (name: string) => getHeaderValue(existingHeaders, name);

  // Decode existing body (our drafts use text/html, so handle both formats)
  let existingBody = '';
  if (needsBody) {
    const payload = existing.data.message?.payload;
    if (payload?.body?.data) {
      const rawBody = Buffer.from(payload.body.data, 'base64url').toString('utf-8');
      if (payload.mimeType === 'text/html') {
        existingBody = stripHtmlTags(rawBody);
      } else {
        existingBody = rawBody;
      }
    } else if (payload?.parts) {
      const textPart = payload.parts.find((p: any) => p.mimeType === 'text/plain');
      const htmlPart = payload.parts.find((p: any) => p.mimeType === 'text/html');
      const part = textPart || htmlPart;
      if (part?.body?.data) {
        const rawBody = Buffer.from(part.body.data, 'base64url').toString('utf-8');
        if (part.mimeType === 'text/html') {
          existingBody = stripHtmlTags(rawBody);
        } else {
          existingBody = rawBody;
        }
      }
    }
  }

  const fromEmail = await getFromEmail(gmail);

  const threadId = params.thread_id || existing.data.message?.threadId;

  // Resolve threading headers
  let inReplyTo = params.in_reply_to || getHeader('In-Reply-To') || undefined;
  let references = getHeader('References') || inReplyTo;

  if (threadId && !inReplyTo) {
    try {
      const threading = await resolveThreadingHeaders(gmail, threadId);
      inReplyTo = threading.inReplyTo || inReplyTo;
      references = threading.references || references;
    } catch {
      // Thread may have been deleted — keep existing headers
    }
  }

  const raw = buildRawEmail({
    to: params.to || getHeader('To'),
    from: fromEmail,
    subject: params.subject || getHeader('Subject'),
    body: params.body || existingBody,
    cc: params.cc || getHeader('Cc') || undefined,
    bcc: params.bcc || getHeader('Bcc') || undefined,
    inReplyTo,
    references,
  });

  const draftRes = await gmail.users.drafts.update({
    userId: 'me',
    id: params.draft_id,
    requestBody: {
      message: {
        raw,
        threadId,
      },
    },
  });

  return compact({
    draft_id: draftRes.data.id,
    message_id: draftRes.data.message?.id,
    thread_id: draftRes.data.message?.threadId,
    status: 'Draft updated.',
  });
}

interface ListDraftsParams {
  max_results?: number;
}

export async function handleListDrafts(
  gmail: gmail_v1.Gmail,
  params: ListDraftsParams
) {
  const res = await gmail.users.drafts.list({
    userId: 'me',
    maxResults: params.max_results || 25,
  });

  const drafts = res.data.drafts || [];

  const results = await Promise.all(
    drafts.map(async (draft) => {
      const detail = await gmail.users.drafts.get({
        userId: 'me',
        id: draft.id!,
        format: 'metadata',
      });

      const headers = detail.data.message?.payload?.headers || [];
      const getHeader = (name: string) => getHeaderValue(headers, name);

      return compact({
        draft_id: draft.id,
        message_id: detail.data.message?.id,
        thread_id: detail.data.message?.threadId,
        subject: getHeader('Subject'),
        to: getHeader('To'),
      });
    })
  );

  return { drafts: results, count: results.length };
}

interface DeleteDraftParams {
  draft_id: string;
}

export async function handleDeleteDraft(
  gmail: gmail_v1.Gmail,
  params: DeleteDraftParams
) {
  await gmail.users.drafts.delete({
    userId: 'me',
    id: params.draft_id,
  });

  return {
    draft_id: params.draft_id,
    status: 'Draft deleted.',
  };
}
