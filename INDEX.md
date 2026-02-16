# INDEX.md

Directory and file reference for agents navigating this codebase.

## Root Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts (`build`, `test`, `start`, `setup`) |
| `tsconfig.json` | TypeScript config — strict, ES2022, Node16 modules, `src/` → `dist/` |
| `.env.example` | Template for OAuth env vars (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REFRESH_TOKEN`) |
| `.gitignore` | Ignores `.env`, `dist/`, `credentials.json`, `token.json` |
| `run-tests.mjs` | Custom test runner — invokes `vitest run --reporter=verbose` with 60s timeout |
| `LICENSE` | MIT |
| `CLAUDE.md` | Architecture guide for Claude Code agents |
| `CHANGELOG.md` | Development history and feature log |
| `BUGS.md` | Known bugs with exact file/line locations, root causes, and triggers — prioritized for fixing |
| `FIX-BUGS-PROMPT.md` | Copy-pasteable prompt for a new Claude Code agent to systematically fix all bugs |
| `README.md` | User-facing documentation and setup instructions |

## `src/` — Source Code

| File | What it does | Exports |
|------|--------------|---------|
| `index.ts` | MCP server entry point. Registers all 11 tools with Zod schemas, connects via `StdioServerTransport`. | — (main) |
| `auth.ts` | OAuth2 client factory. Loads tokens from file or env vars, auto-refreshes. | `getAuthClient()`, `getGmailClient()`, `getCalendarClient()` |
| `utils.ts` | Shared utility. | `compact()` — strips empty/null/undefined values and empty arrays from objects |
| `gmail/threads.ts` | Thread listing and reading. Full email text pipeline: MIME extraction → HTML stripping → quote stripping → signature stripping → truncation. | `handleListThreads()`, `handleGetThread()`, `decodeBase64Url()`, `getHeader()`, `extractEmailAddresses()`, `getMessageBody()`, `stripHtmlTags()`, `stripQuotedText()`, `stripSignature()`, `getAttachments()` |
| `gmail/drafts.ts` | Draft CRUD. Builds RFC 2822 emails, converts plain text to styled HTML, auto-resolves threading headers. | `handleCreateDraft()`, `handleUpdateDraft()`, `handleListDrafts()`, `handleDeleteDraft()`, `buildRawEmail()` |
| `gmail/labels.ts` | Label listing. | `handleListLabels()` |
| `calendar/events.ts` | Calendar event CRUD. Handles all-day vs timed events, PATCH-based partial updates. | `handleListEvents()`, `handleCreateEvent()`, `handleUpdateEvent()`, `handleDeleteEvent()` |

## `tests/` — Test Suite (Vitest)

| File | What it tests |
|------|---------------|
| `threads.test.ts` | Thread handlers + all pure text processing functions (`stripQuotedText`, `stripSignature`, `getMessageBody`, etc.). Most comprehensive file — includes a 6-message integration test. |
| `drafts.test.ts` | `buildRawEmail()` RFC 2822 output, `handleCreateDraft()` with threading auto-resolution. |
| `calendar.test.ts` | All four calendar handlers (list, create, update, delete). Tests date-only vs datetime, compact field removal. |
| `labels.test.ts` | `handleListLabels()` with system/user labels, empty results, type lowercasing. |

All tests call handler functions directly (not through MCP server layer). Each file defines its own mock factory function.

## `scripts/` — Setup Tooling

| File | Purpose |
|------|---------|
| `setup-oauth.ts` | Interactive OAuth wizard. Prompts for credentials, opens browser, starts callback server on `:3000`, exchanges auth code for tokens, saves to `~/.config/google-workspace-mcp/tokens.json`. |

## `dist/` — Build Output (gitignored)

Compiled JavaScript from `tsc`. Entry point: `dist/index.js`. Must run `npm run build` before `npm start`.

## Key Paths (Outside Repo)

| Path | Purpose |
|------|---------|
| `~/.config/google-workspace-mcp/tokens.json` | Persisted OAuth tokens (client_id, client_secret, refresh_token, access_token, expiry_date) |
