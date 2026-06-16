import type { gmail_v1 } from 'googleapis';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { compact } from '../utils.js';

interface DownloadAttachmentParams {
  message_id: string;
  attachment_id: string;
  filename?: string;
  save_dir?: string;
}

// Default landing spot for downloaded attachments. Discoverable and matches the
// "download then /ocr" workflow (see google-workspace-mcp CLAUDE.md).
const DEFAULT_SAVE_DIR = path.join(os.homedir(), 'Downloads');

/**
 * Reduce one candidate string to a safe basename, or '' if nothing usable
 * remains. Drops directory components, control chars, surrounding whitespace,
 * and leading dots (hidden files / traversal). Order matters: trim BEFORE the
 * leading-dot strip so "  .." collapses to "" rather than surviving as "..".
 */
function cleanCandidate(s: string): string {
  let base = path.basename(s.replace(/[\\/]+/g, '/'));
  base = base.replace(/[\x00-\x1F\x7F]/g, '').trim();
  base = base.replace(/^\.+/, '').trim();
  return base;
}

/**
 * Sanitize a user/Gmail-supplied filename so it cannot escape the save dir.
 * The fallback is sanitized too — a caller may derive it from untrusted input
 * (e.g. attachment_id) — and an ultimate constant guarantees a non-empty,
 * traversal-free result.
 */
export function sanitizeFilename(name: string | undefined, fallback: string): string {
  return cleanCandidate(name || '') || cleanCandidate(fallback) || 'attachment';
}

/**
 * Resolve the destination path and guarantee it stays inside save_dir.
 * Throws on any attempt to traverse outside the directory.
 */
export function resolveSavePath(saveDir: string, filename: string): string {
  const dir = path.resolve(saveDir);
  const target = path.resolve(dir, filename);
  const rel = path.relative(dir, target);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Resolved attachment path escapes the save directory');
  }
  return target;
}

/**
 * If `p` already exists, return `p` with a " (N)" suffix before the extension
 * (browser-style), so a second download of a same-named attachment doesn't
 * silently clobber the first. The candidates stay inside the same directory.
 */
export function uniquePath(p: string): string {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p);
  const ext = path.extname(p);
  const stem = path.basename(p, ext);
  for (let i = 1; i < 1000; i++) {
    const candidate = path.join(dir, `${stem} (${i})${ext}`);
    if (!fs.existsSync(candidate)) return candidate;
  }
  return p; // 1000 collisions — give up and overwrite
}

export async function handleDownloadAttachment(
  gmail: gmail_v1.Gmail,
  params: DownloadAttachmentParams
) {
  const saveDir = params.save_dir ? path.resolve(params.save_dir) : DEFAULT_SAVE_DIR;
  const filename = sanitizeFilename(params.filename, `attachment-${params.attachment_id.slice(0, 12)}`);
  const savePath = resolveSavePath(saveDir, filename);

  const res = await gmail.users.messages.attachments.get({
    userId: 'me',
    messageId: params.message_id,
    id: params.attachment_id,
  });

  const data = res.data.data;
  if (!data) {
    throw new Error('Attachment returned no data (it may be empty or inline-only)');
  }

  const buffer = Buffer.from(data, 'base64url');

  fs.mkdirSync(saveDir, { recursive: true });
  const finalPath = uniquePath(savePath);
  fs.writeFileSync(finalPath, buffer);

  return compact({
    saved_to: finalPath,
    filename: path.basename(finalPath),
    bytes: buffer.length,
    reported_size: res.data.size || buffer.length,
  });
}
