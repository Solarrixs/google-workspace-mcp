# INDEX.md

Directory and file reference for agents navigating this codebase.

## Root Files

| File | Purpose |
|------|---------|
| `package.json` | Dependencies, scripts (`build`, `test`, `start`, `setup`) |
| `tsconfig.json` | TypeScript config — strict, ES2022, Node16 modules, `src/` → `dist/` |
| `.gitignore` | Ignores `.env`, `dist/`, `credentials.json`, `token.json` |
| `run-tests.mjs` | Custom test runner — invokes `vitest run --reporter=verbose` with 60s timeout |
| `LICENSE` | MIT |
| `CLAUDE.md` | Architecture guide for Claude Code agents |
| `CHANGELOG.md` | Development history and feature log |
| `README.md` | User-facing documentation and setup instructions |
| `reply-templates.default.yaml` | Default reply templates for cold recruiting (copied to config dir on first watcher run) |

## `src/` — Source Code

| File | What it does | Exports |
|------|--------------|---------|
| `index.ts` | MCP server entry point. Registers all 13 tools (12 workspace + `list_accounts`) with Zod schemas, connects via `StdioServerTransport`. Every tool accepts optional `account` param. | — (main) |
| `auth.ts` | Multi-account OAuth2 client factory with in-memory caching. Loads tokens from v2 multi-account file or env vars, auto-migrates legacy format, auto-refreshes per-account. Caches parsed token store and OAuth2Client instances. | `getAuthClient(account?)`, `getGmailClient(account?)`, `getCalendarClient(account?)`, `listAccounts()`, `getAccountEmail(account?)`, `clearAuthCaches()`, `SCOPES`, `TOKEN_DIR`, `TOKEN_PATH` |
| `utils.ts` | Shared utility. | `compact()` — strips empty/null/undefined values and empty arrays from objects |
| `gmail/threads.ts` | Thread listing and reading. Full email text pipeline: MIME extraction → HTML stripping → quote stripping → signature stripping → truncation. | `handleListThreads()`, `handleGetThread()`, `decodeBase64Url()`, `getHeader()`, `extractEmailAddresses()`, `getMessageBody()`, `stripHtmlTags()`, `stripQuotedText()`, `stripSignature()`, `getAttachments()` |
| `gmail/drafts.ts` | Draft CRUD. Builds RFC 2822 emails — sends plain text by default, converts to styled HTML only when body contains markdown links or list syntax (`hasRichFormatting()`). Auto-resolves threading headers (gracefully handles deleted threads). Imports `getHeader` from `threads.ts`. | `handleCreateDraft()`, `handleUpdateDraft()`, `handleListDrafts()`, `handleDeleteDraft()`, `buildRawEmail()` |
| `gmail/labels.ts` | Label listing. | `handleListLabels()` |
| `gmail/attachments.ts` | Attachment download. Fetches bytes via `users.messages.attachments.get`, decodes base64url, writes to a path-traversal-safe destination (default `~/Downloads`). | `handleDownloadAttachment()`, `sanitizeFilename()`, `resolveSavePath()` |
| `calendar/events.ts` | Calendar event CRUD. Validates dates via `parseDateTime()`, enforces `time_min <= time_max`, requires at least one field for updates. Handles all-day vs timed events, PATCH-based partial updates. | `handleListEvents()`, `handleCreateEvent()`, `handleUpdateEvent()`, `handleDeleteEvent()` |
| `watcher/state.ts` | Watcher state persistence. Ring buffers for processed messages (200) and nudged threads (500). Atomic writes. | `loadState()`, `saveState()`, `addProcessedMessageId()`, `isProcessed()`, `addNudgedThreadId()`, `isNudged()` |
| `watcher/config.ts` | Watcher configuration with defaults. Loads from `watcher-config.json`, deep-merges user overrides. | `loadConfig()`, `WatcherConfig`, `NudgeConfig`, `TemplateConfig` |
| `watcher/poll.ts` | Gmail polling via `history.list` API. Processes new INBOX+UNREAD messages through text pipeline. Filters by skip labels/senders. | `seedHistoryId()`, `pollForNewMessages()`, `fetchAndProcessMessage()`, `EmailContext` |
| `watcher/nudge.ts` | Stale sent-email detection for follow-up nudges. Bounded query window (stale_days to 12d). | `checkForStaleThreads()`, `NudgeCandidate` |
| `watcher/prompt.ts` | Prompt assembly for Claude spawning. | `buildEmailPrompt()`, `buildNudgePrompt()` |
| `watcher/notify.ts` | macOS notifications via osascript. Platform-guarded. | `notify()`, `notifyDraftCreated()`, `notifyNudgeDrafted()`, `notifyError()` |
| `templates/loader.ts` | YAML template loading. Auto-copies defaults on first use. | `loadTemplates()`, `TemplateFile`, `ReplyTemplate`, `TemplateVariant` |
| `templates/matcher.ts` | Template matching by labels and subject keywords. Scored ranking. | `filterTemplates()` |
| `templates/serializer.ts` | Template serialization with variable substitution. | `serializeTemplates()` |

## `tests/` — Test Suite (Vitest)

| File | What it tests |
|------|---------------|
| `threads.test.ts` | Thread handlers + all pure text processing functions (`stripQuotedText`, `stripSignature`, `getMessageBody`, etc.). Most comprehensive file — includes a 6-message integration test. |
| `drafts.test.ts` | `buildRawEmail()` RFC 2822 output, `handleCreateDraft()` with threading auto-resolution. |
| `calendar.test.ts` | All four calendar handlers (list, create, update, delete). Tests date-only vs datetime, compact field removal. |
| `labels.test.ts` | `handleListLabels()` with system/user labels, empty results, type lowercasing. |
| `auth.test.ts` | Multi-account auth: v2 format parsing, legacy auto-migration, account resolution, env var fallback, token refresh per-account, `listAccounts()`, error messages. |
| `watcher-state.test.ts` | State loading/saving, ring buffer capping (200 processed, 500 nudged), corrupted file handling. |
| `watcher-poll.test.ts` | History seeding, polling (empty/INBOX+UNREAD/404 re-seed), message processing (valid/skip-label/skip-sender). |
| `watcher-nudge.test.ts` | Nudge detection: rate limiting, stale thread finding, already-nudged filtering. |
| `template-loader.test.ts` | Template matching (label/subject/fallback/cap/ranking), serialization with variable substitution. |

All tests call handler functions directly (not through MCP server layer). Each file defines its own mock factory function.

## `scripts/` — Setup Tooling

| File | Purpose |
|------|---------|
| `setup-oauth.ts` | Interactive OAuth wizard. Imports `TOKEN_DIR`, `TOKEN_PATH`, `SCOPES` from `src/auth.ts` instead of redefining them. Prompts for credentials and account alias, opens browser, starts callback server (prefers port 3000, falls back to OS-assigned port if taken), exchanges auth code for tokens, captures email, saves in multi-account v2 format to `~/.config/google-workspace-mcp/tokens.json`. Supports adding multiple accounts. |
| `email-watcher.ts` | Email watcher daemon entry point. Multi-account polling loop, spawns `claude -p` per message, template matching, nudge detection. Run via `npm run watch-email`. |
| `install-launchd.ts` | Installs email watcher as macOS launchd service. Substitutes working directory into plist template, copies to `~/Library/LaunchAgents/`, loads via `launchctl`. |

## `dist/` — Build Output (gitignored)

Compiled JavaScript from `tsc`. Entry point: `dist/index.js`. Must run `npm run build` before `npm start`.

## `specs/` — Design Specs

| File | What it describes |
|------|-------------------|
| `email-watcher.md` | Gmail watcher daemon. Polls `history.list` every 60s for new emails, processes them through the existing text pipeline (`getMessageBody` → `stripQuotedText` → `stripSignature`), spawns `claude -p` (one-shot Sonnet) to triage and draft replies. Integrates with Superhuman AI labels for skip/respond signals. Runs via macOS launchd. State persisted to `~/.config/google-workspace-mcp/watcher-state.json`. Status: future plan. |

## Key Paths (Outside Repo)

| Path | Purpose |
|------|---------|
| `~/.config/google-workspace-mcp/tokens.json` | Multi-account token store (v2 format: `version`, `default_account`, `accounts` map with per-alias `client_id`, `client_secret`, `refresh_token`, `access_token`, `expiry_date`, `email`) |
| `~/.config/google-workspace-mcp/watcher-state.json` | Email watcher state (history IDs, processed message ring buffer, nudged threads) |
| `~/.config/google-workspace-mcp/watcher-config.json` | Email watcher config overrides (optional — defaults used if absent) |
| `~/.config/google-workspace-mcp/reply-templates.yaml` | User-customizable reply templates (auto-copied from `reply-templates.default.yaml`) |
