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
npm run watch-email    # Start email watcher daemon (tsx, polls all accounts)
npm run watch-email:install  # Install as macOS launchd service
```

Run a single test file:
```bash
npx vitest run tests/drafts.test.ts
```

No vitest config file — uses Vitest defaults. Build is required before `npm start`.

## Architecture

**Entry point**: `src/index.ts` — Creates `McpServer`, registers all 13 tools with Zod schemas, connects via `StdioServerTransport`. All tool handlers follow the same pattern:
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
src/gmail/threads.ts (getHeader, getMessageBody, stripQuotedText, stripSignature)
  ↑ imported by drafts.ts, watcher/poll.ts, watcher/nudge.ts
src/auth.ts (OAuth2 client factory + in-memory cache)
  ↑ imported by setup-oauth.ts, watcher/*.ts, templates/loader.ts
src/gmail/labels.ts (standalone)
src/watcher/ (email watcher daemon modules)
src/templates/ (reply template engine)
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

**Legacy migration**: Old flat `tokens.json` (no `version` field) is auto-migrated to v2 on first read, wrapped as account `"default"`. Legacy migration uses atomic write (tmp file + rename) to prevent corruption during the upgrade.

**Credential sources** (file takes precedence):
1. **Token file** (v2 multi-account or legacy auto-migrated)
2. **Env vars** (fallback): `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN` — creates in-memory `"env"` alias (not written to disk)

**Key functions**: `getAuthClient(account?)`, `getGmailClient(account?)`, `getCalendarClient(account?)`, `listAccounts()`, `getAccountEmail(account?)`, `clearAuthCaches()`.

**In-memory caching**: `loadAccountStore()` caches the parsed token file after first read (`cachedStore`). `getAuthClient()` caches `OAuth2Client` instances per alias (`clientCache`). `saveTokens()` updates the cache after disk write. `clearAuthCaches()` resets both caches (used in tests). Env-var path is not cached.

Auto-refresh: listens on `oauth2Client.on('tokens', ...)`, merges new access tokens into the correct account slot, persists to disk. Scopes: `gmail.readonly`, `gmail.compose`, `gmail.labels`, `calendar`.

### Email Text Pipeline (`src/gmail/threads.ts`)

`handleGetThread` processes each message body through a sequential, destructive pipeline:
1. **MIME extraction** (`getMessageBody`) — recursively traverses multipart; prefers `text/plain` over `text/html`
2. **HTML stripping** (`stripHtmlTags`) — removes tags, decodes entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`), collapses newlines
3. **Quote stripping** (`stripQuotedText`) — finds earliest match of: Gmail (`On ... wrote:`), Apple Mail (`On ..., at ... wrote:`), Outlook (`___\nFrom:`), or generic `> ` blocks. Returns `'[quoted reply only — no new content]'` if nothing remains
4. **Signature stripping** (`stripSignature`) — detects standard delimiters (`-- \n`, `—\n`, `__\n`), mobile boilerplate ("Sent from my iPhone"), legal disclaimers, and sign-off blocks (Best/Regards/Thanks + ≤5 short lines)
5. **Truncation** — caps at 2500 chars, appends `'\n\n[truncated]'`

Other: snippets truncated at 150 chars. Labels filtered to keep only `INBOX`, `UNREAD`, `SENT`, `IMPORTANT`, `STARRED`, `DRAFT` (plus non-CATEGORY user labels).

### Draft Building (`src/gmail/drafts.ts`)

`buildRawEmail()` constructs RFC 2822 messages with CRLF line endings. `hasRichFormatting()` checks if the body contains markdown links or list syntax — if so, the body goes through `plainTextToHtml()` and is sent as `text/html`; otherwise it's sent as `text/plain` without conversion. `plainTextToHtml()`: escapes HTML entities → splits on double newlines into blocks → detects numbered lists (`/^\d+[.)]\s/`) as `<ol>`, bullet lists (`/^[-*]\s/`) as `<ul>`, or wraps as `<p>` → converts `[text](url)` markdown links to `<a>` tags.

**Profile caching**: `getFromEmail(gmail)` caches the `getProfile` result per Gmail client instance, eliminating redundant API calls on subsequent draft create/update operations.

**Conditional fetch**: `handleUpdateDraft` uses `format: 'metadata'` when a new body is provided (skips body decoding), `format: 'full'` only when preserving the existing body.

**Threading auto-resolution**: when `thread_id` is provided without `in_reply_to`, automatically fetches the thread's last message `Message-ID` header and builds a `References` chain. Same logic in both `handleCreateDraft` and `handleUpdateDraft`. If the referenced thread has been deleted, threading resolution fails gracefully (try-catch) — the draft is created/updated without threading headers rather than crashing.

### Calendar (`src/calendar/events.ts`)

`parseDateTime()` distinguishes all-day events (`/^\d{4}-\d{2}-\d{2}$/` → `{ date }`) from timed events (`{ dateTime }`), and validates both via `new Date()` — rejects invalid dates, empty strings, and garbage input with descriptive errors. `handleListEvents` validates `time_min <= time_max`. `handleUpdateEvent` requires at least one field and uses `calendar.events.patch()` sending only changed fields. Defaults to `'primary'` calendar.

### Email Watcher (`src/watcher/`)

Daemon that polls Gmail every 15 minutes across all configured accounts, drafts replies using smart templates, and sends macOS notifications.

**Modules**:
- `state.ts` — Persists watcher state to `~/.config/google-workspace-mcp/watcher-state.json`. Tracks `lastHistoryId` per account, processed message IDs (ring buffer, cap 200), nudged thread IDs (cap 500). Atomic writes.
- `config.ts` — Loads config from `~/.config/google-workspace-mcp/watcher-config.json`, merges with defaults. Key settings: `poll_interval_ms` (900k), `skip_labels` (Superhuman labels + CATEGORY_*), `nudge` (stale_days: 5, check_interval_hours: 6), `templates`, `notify`.
- `poll.ts` — Uses `history.list` API with `historyTypes: ['messageAdded']` to find new INBOX+UNREAD messages. Handles 404 (stale historyId) by re-seeding. Processes messages through existing text pipeline. Filters by skip labels/senders.
- `nudge.ts` — Detects sent emails with no reply after N days (`in:sent older_than:Nd newer_than:12d`). Returns `NudgeCandidate` objects for follow-up drafting. Rate-limited by `check_interval_hours`.
- `prompt.ts` — Builds prompts for Claude: `buildEmailPrompt()` for new email triage, `buildNudgePrompt()` for follow-up nudges.
- `notify.ts` — macOS notifications via `osascript`. Platform-guarded (console.log on non-macOS). Fire-and-forget.

**Entry point**: `scripts/email-watcher.ts` — Multi-account orchestration loop. Spawns `claude -p` per message. Sequential processing to prevent runaway processes. Reloads templates each poll cycle.

### Reply Templates (`src/templates/`)

YAML-based reply template engine for cold recruiting workflows.

- `loader.ts` — Loads `~/.config/google-workspace-mcp/reply-templates.yaml`. Auto-copies `reply-templates.default.yaml` on first use.
- `matcher.ts` — Scores templates against email context (label match: 2 pts, subject keyword: 1 pt). Returns matched or all templates, capped at `max_in_prompt`.
- `serializer.ts` — Renders matched templates to markdown with variable substitution (`{key}` → value).

Default templates: interview-scheduling, candidate-followup, info-request, acknowledgment, follow-up-nudge.

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
- **Cross-platform** — setup script detects OS and uses `open` (macOS), `start` (Windows), or `xdg-open` (Linux) to launch browser
- **Dynamic port** — setup script tries port 3000, falls back to OS-assigned port if taken

## Skill Activation

- **superpowers:systematic-debugging** — when tests fail, API calls return unexpected results, or auth/token issues occur. Investigate root cause systematically before proposing fixes.
- **superpowers:verification-before-completion** — before claiming any task is done or committing. Run tests (`npm test`) and confirm output before asserting success.

## Related Docs

- [INDEX.md](INDEX.md) — File-by-file reference with exports for each module
- [CHANGELOG.md](CHANGELOG.md) — Development history and feature log
- [specs/email-watcher.md](specs/email-watcher.md) — Original spec for the email watcher daemon (now implemented)
