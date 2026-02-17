# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

MCP (Model Context Protocol) server providing AI assistants access to Gmail and Google Calendar APIs. Built with TypeScript using `@modelcontextprotocol/sdk` and `googleapis`.

## Commands

```bash
npm run build          # Compile TypeScript (tsc → dist/)
npm test               # Run tests (vitest run)
npm start              # Start MCP server (node dist/index.js)
npm run setup          # OAuth setup wizard (interactive, opens browser)
```

Run a single test file:
```bash
npx vitest run tests/drafts.test.ts
```

No vitest config file — uses Vitest defaults. Build is required before `npm start`.

## Architecture

**Entry point**: `src/index.ts` — Creates `McpServer`, registers all 12 tools with Zod schemas, connects via `StdioServerTransport`. All tool handlers follow the same pattern:
```
server.tool(name, description, zodSchema, async (params) => {
  const { account, ...handlerParams } = params;
  const client = getGmailClient(account) | getCalendarClient(account);
  const result = await handler(client, handlerParams);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
})
```
Every tool accepts an optional `account` parameter (alias like "work", "personal") to select which Google account to use. Defaults to the primary account. The `list_accounts` tool returns configured accounts and the default.

**Module dependency graph**:
```
src/utils.ts (compact)
  ↑ imported by threads.ts, drafts.ts, events.ts
src/auth.ts (standalone — OAuth2 client factory)
src/gmail/labels.ts (standalone)
```

### Auth (`src/auth.ts`) — Multi-Account

Supports multiple Google accounts identified by short aliases (e.g., "work", "personal"). Each tool accepts an optional `account` param; omitting it uses the default.

**Token file format** (v2): `~/.config/google-workspace-mcp/tokens.json`
```json
{
  "version": 2,
  "default_account": "work",
  "accounts": {
    "work": { "client_id": "...", "client_secret": "...", "refresh_token": "...", "email": "..." },
    "personal": { ... }
  }
}
```

**Legacy migration**: Old flat `tokens.json` (no `version` field) is auto-migrated to v2 on first read, wrapped as account `"default"`.

**Credential sources** (file takes precedence):
1. **Token file** (v2 multi-account or legacy auto-migrated)
2. **Env vars** (fallback): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — creates in-memory `"env"` alias (not written to disk)

**Key functions**: `getAuthClient(account?)`, `getGmailClient(account?)`, `getCalendarClient(account?)`, `listAccounts()`.

Auto-refresh: listens on `oauth2Client.on('tokens', ...)`, merges new access tokens into the correct account slot, persists to disk. Scopes: `gmail.readonly`, `gmail.compose`, `gmail.labels`, `calendar`.

### Email Text Pipeline (`src/gmail/threads.ts`)

`handleGetThread` processes each message body through a sequential, destructive pipeline:
1. **MIME extraction** (`getMessageBody`) — recursively traverses multipart; prefers `text/plain` over `text/html`
2. **HTML stripping** (`stripHtmlTags`) — removes tags, decodes entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`), collapses newlines
3. **Quote stripping** (`stripQuotedText`) — finds earliest match of: Gmail (`On ... wrote:`), Apple Mail (`On ..., at ... wrote:`), Outlook (`___\nFrom:`), or generic `> ` blocks. Returns `'[quoted reply only — no new content]'` if nothing remains
4. **Signature stripping** (`stripSignature`) — detects standard delimiters (`-- \n`, `—\n`, `__\n`), mobile boilerplate ("Sent from my iPhone"), legal disclaimers, and sign-off blocks (Best/Regards/Thanks + ≤5 short lines)
5. **Truncation** — caps at 4000 chars, appends `'\n\n[truncated]'`

Other: snippets truncated at 150 chars. Labels filtered to keep only `INBOX`, `UNREAD`, `SENT`, `IMPORTANT`, `STARRED`, `DRAFT` (plus non-CATEGORY user labels).

### Draft Building (`src/gmail/drafts.ts`)

`buildRawEmail()` constructs RFC 2822 messages with CRLF line endings. Body goes through `plainTextToHtml()` which: escapes HTML entities → splits on double newlines into blocks → detects numbered lists (`/^\d+[.)]\s/`) as `<ol>`, bullet lists (`/^[-*]\s/`) as `<ul>`, or wraps as `<p>` → converts `[text](url)` markdown links to `<a>` tags.

**Threading auto-resolution**: when `thread_id` is provided without `in_reply_to`, automatically fetches the thread's last message `Message-ID` header and builds a `References` chain. Same logic in both `handleCreateDraft` and `handleUpdateDraft`.

### Calendar (`src/calendar/events.ts`)

`parseDateTime()` distinguishes all-day events (`/^\d{4}-\d{2}-\d{2}$/` → `{ date }`) from timed events (`{ dateTime }`). Updates use `calendar.events.patch()` sending only changed fields. Defaults to `'primary'` calendar.

### Utilities (`src/utils.ts`)

Single export: `compact()` — strips `''`, `null`, `undefined`, and empty arrays from objects. Used in all response formatting.

## Testing Patterns

Tests in `tests/` call **handler functions directly** — not through the MCP server layer. Each test file defines its own mock factory:

```typescript
// Gmail mock shape
{ users: { getProfile: vi.fn(), threads: { list, get }, drafts: { create, update, delete }, labels: { list } } } as any

// Calendar mock shape
{ events: { list, insert, get, patch, delete } } as any
```

Key patterns for writing new tests:
- Mock with `vi.fn().mockResolvedValue({ data: {...} })`, cast `as any`
- Import handlers directly: `import { handleX } from '../src/module.js'`
- Inspect mock calls via `mock.calls[0][0]` for API arguments
- Pure functions (`stripQuotedText`, `buildRawEmail`, etc.) are tested without mocks
- Tests cover happy path + edge cases (empty data, null responses); no error-throwing tests yet

## Key Design Decisions

- **Draft-only** — no send email tool; `gmail.compose` scope allows drafts but code intentionally never sends
- **No attachment content** — only metadata (filename, mime_type, size) returned
- **ES Modules** — `"type": "module"` in package.json; all imports use `.js` extensions
- **Strict TypeScript** — `strict: true`, target ES2022, Node16 module resolution
- **Token storage** — `~/.config/google-workspace-mcp/tokens.json`, not in project directory
- **macOS-specific** — setup script uses `open` command to launch browser

## Related Docs

- [INDEX.md](INDEX.md) — File-by-file reference with exports for each module
- [CHANGELOG.md](CHANGELOG.md) — Development history and feature log
- [BUGS.md](BUGS.md) — 32 known bugs with exact locations, root causes, and severity ratings
