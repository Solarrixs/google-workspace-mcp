import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { sanitizeFilename, resolveSavePath, uniquePath, pruneOldFiles } from '../src/gmail/attachments.js';

describe('sanitizeFilename', () => {
  it('keeps a normal filename', () => {
    expect(sanitizeFilename('References for Engram re Mammoth.pdf', 'fb')).toBe(
      'References for Engram re Mammoth.pdf'
    );
  });

  it('strips directory components (path traversal)', () => {
    expect(sanitizeFilename('../../etc/passwd', 'fb')).toBe('passwd');
    expect(sanitizeFilename('/abs/path/evil.pdf', 'fb')).toBe('evil.pdf');
    expect(sanitizeFilename('a\\b\\c.pdf', 'fb')).toBe('c.pdf');
  });

  it('strips leading dots that could hide/traverse', () => {
    expect(sanitizeFilename('...', 'fb')).toBe('fb');
    expect(sanitizeFilename('.hidden', 'fb')).toBe('hidden');
  });

  it('strips control characters', () => {
    expect(sanitizeFilename('na\x00me\x1f.pdf', 'fb')).toBe('name.pdf');
  });

  it('falls back when empty or undefined', () => {
    expect(sanitizeFilename(undefined, 'fallback')).toBe('fallback');
    expect(sanitizeFilename('', 'fallback')).toBe('fallback');
    expect(sanitizeFilename('   ', 'fallback')).toBe('fallback');
  });

  it('does not let dot-only names survive trim ordering (regression)', () => {
    // "  .." must collapse to the fallback, not return ".." (which would then
    // make resolveSavePath throw instead of using the fallback).
    expect(sanitizeFilename('  ..', 'fb')).toBe('fb');
    expect(sanitizeFilename('.', 'fb')).toBe('fb');
    expect(sanitizeFilename(' . ', 'fb')).toBe('fb');
  });

  it('sanitizes the fallback too (caller may derive it from untrusted input)', () => {
    // Mimics a hostile attachment_id-derived fallback.
    expect(sanitizeFilename(undefined, '../../etc/passwd')).toBe('passwd');
    expect(sanitizeFilename('', 'attachment-../../x')).toBe('x');
  });

  it('returns the constant ultimate fallback when both inputs sanitize to empty', () => {
    expect(sanitizeFilename('/', '..')).toBe('attachment');
    expect(sanitizeFilename('...', '   ')).toBe('attachment');
  });
});

describe('resolveSavePath', () => {
  it('resolves a safe path inside the save dir', () => {
    const dir = '/tmp/dl';
    expect(resolveSavePath(dir, 'file.pdf')).toBe(path.resolve(dir, 'file.pdf'));
  });

  it('throws when the filename escapes the save dir', () => {
    // sanitizeFilename normally prevents this, but resolveSavePath is the backstop.
    expect(() => resolveSavePath('/tmp/dl', '../escape.pdf')).toThrow(/escapes/);
    expect(() => resolveSavePath('/tmp/dl', '../../etc/passwd')).toThrow(/escapes/);
  });

  it('throws when the resolved path equals the dir itself', () => {
    expect(() => resolveSavePath('/tmp/dl', '.')).toThrow(/escapes/);
  });
});

describe('uniquePath', () => {
  it('returns the path unchanged when it does not exist', () => {
    const p = path.join(os.tmpdir(), 'mcp-attach-test-nonexistent.pdf');
    if (fs.existsSync(p)) fs.unlinkSync(p);
    expect(uniquePath(p)).toBe(p);
  });

  it('appends " (N)" before the extension when the file exists', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-attach-'));
    try {
      const p = path.join(dir, 'report.pdf');
      fs.writeFileSync(p, 'a');
      expect(uniquePath(p)).toBe(path.join(dir, 'report (1).pdf'));
      fs.writeFileSync(path.join(dir, 'report (1).pdf'), 'b');
      expect(uniquePath(p)).toBe(path.join(dir, 'report (2).pdf'));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('pruneOldFiles', () => {
  it('deletes files older than maxAge but keeps recent ones', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-prune-'));
    try {
      const old = path.join(dir, 'old.pdf');
      const fresh = path.join(dir, 'fresh.pdf');
      fs.writeFileSync(old, 'a');
      fs.writeFileSync(fresh, 'b');
      // Backdate `old` 48h via utimes.
      const longAgo = (Date.now() - 48 * 3600 * 1000) / 1000;
      fs.utimesSync(old, longAgo, longAgo);

      pruneOldFiles(dir, 24 * 3600 * 1000);

      expect(fs.existsSync(old)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('does not throw when the directory does not exist', () => {
    expect(() => pruneOldFiles(path.join(os.tmpdir(), 'mcp-prune-nonexistent-xyz'), 1000)).not.toThrow();
  });
});
