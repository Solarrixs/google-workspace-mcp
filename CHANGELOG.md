# Changelog

All notable changes to this project are documented here.

## [Unreleased] - 2026-02-20

### Calendar Validation
- `parseDateTime()` now validates date values — rejects invalid dates (e.g., "2024-13-99"), empty strings, and non-date strings (e.g., "tomorrow") with clear error messages
- `calendar_list_events`: `max_results` now uses `??` instead of `||`, so explicit `0` is respected
- `calendar_list_events`: validates `time_min <= time_max`, throws if inverted
- `calendar_update_event`: rejects empty updates (at least one field required)
- `formatEvent()`: safe attendee mapping with optional chaining (`a?.email`)

### Draft Resilience
- `handleCreateDraft` and `handleUpdateDraft`: threading header resolution (`resolveThreadingHeaders`) now wrapped in try-catch — drafts referencing deleted threads no longer crash
- `buildRawEmail()`: `In-Reply-To` and `References` headers now sanitized via `sanitizeHeader()` to prevent CRLF injection

### Auth
- Legacy token migration now uses atomic write (tmp file + rename) to prevent corruption

### Refactoring
- `drafts.ts`: imports shared `getHeader` from `threads.ts` instead of defining local duplicates (RF-002)
- `threads.ts`: `KEEP_LABELS` Set hoisted to module scope (RF-008)
- `setup-oauth.ts`: imports `TOKEN_DIR`, `TOKEN_PATH`, `SCOPES` from `auth.ts` instead of redefining (RF-004)

### Documentation
- Consolidated bug docs: deleted 7 stale files, merged `INTEGRATION_BUGS.md` into `BUGS.md`
- Updated `BUGS.md`: added BUG-066, marked BUG-039 as FIXED
- Updated `CALENDAR_BUGS.md`: marked BUG-054/055/056/057/061/063 as FIXED

## [Unreleased] - 2026-02-17

### Specs
- **New `specs/` directory:** Created directory for planned feature specifications.
- **Email watcher daemon (`specs/email-watcher.md`):** First spec added — design document for a background daemon that watches for new emails.

## [Unreleased] - 2026-02-16

### Multi-Account Support
- **Auth (`src/auth.ts`):** Added multi-account support with short aliases (e.g., "work", "personal"). New v2 token file format stores multiple accounts with a configurable default. Legacy single-account `tokens.json` auto-migrates to v2 on first read. Env var fallback creates in-memory `"env"` alias.
- **All 12 tools (`src/index.ts`):** Every tool now accepts optional `account` parameter to select which Google account to use. Omitting it uses the default account.
- **New tool: `list_accounts`** — Returns configured accounts with aliases, emails, and which is default.
- **Setup (`scripts/setup-oauth.ts`):** Now prompts for account alias, validates format, detects existing aliases, captures email during verification, saves in v2 multi-account format. Run again to add more accounts.
- **Tests (`tests/auth.test.ts`):** 24 tests covering v2 format, legacy migration, account resolution, env var fallback, per-account token refresh, `listAccounts()`, and error messages. Fixed vi.mock hoisting bug.

### Bug Fixes (32 bugs fixed across all modules)

#### Auth (src/auth.ts)
- **BUG-004:** Added try-catch for JSON.parse to handle corrupted token files
- **BUG-005:** Implemented singleton pattern for OAuth2Client to prevent race conditions
- **BUG-011:** Improved error messages for missing environment variables
- **BUG-026:** Fixed HOME/USERPROFILE fallback to use process.cwd()

#### Error Handling (src/index.ts)
- **BUG-003:** Added try-catch to all 11 tool handlers

#### Gmail Drafts (src/gmail/drafts.ts)
- **BUG-001:** Fixed draft update body extraction to use text/html
- **BUG-002:** Added sanitizeHeaderValue() for RFC 2822 header injection prevention
- **BUG-006:** Fixed N+1 query with Promise.all() parallel fetching
- **BUG-007:** XSS vulnerability fix - escaped URLs in linkify()
- **BUG-008:** Added RFC 2047 encoding for non-ASCII headers
- **BUG-009:** Added validation and error handling for getProfile()
- **BUG-021:** Fixed list paragraph merging for consecutive lists
- **BUG-024:** Added quote escaping to escapeHtml()
- **BUG-025:** Added Date header to RFC 2822 output
- **BUG-028:** Added type guards for non-null assertions

#### Gmail Threads (src/gmail/threads.ts)
- **BUG-012:** Fixed getMessageBody to handle simple string payloads
- **BUG-013:** Added comprehensive HTML entity decoding
- **BUG-017:** Fixed UTF-8 character truncation
- **BUG-018:** Improved quote pattern to prevent false positives
- **BUG-019:** Enhanced signature stripping with list detection
- **BUG-020:** Added inline attachment filtering
- **BUG-022:** Added try-catch for base64 decode errors
- **BUG-030:** Improved email extraction with RFC 5322 compliance

#### Calendar Events (src/calendar/events.ts)
- **BUG-010:** Added start<end validation for event updates
- **BUG-014:** Added date/time validation with error handling
- **BUG-023:** Applied compact() to filter null attendee fields
- **BUG-031:** Added pagination support with page_token

#### Labels (src/gmail/labels.ts)
- **BUG-015:** Added label.name fallback to label.id
- **BUG-016:** Case-insensitive label matching for system labels
- **BUG-029:** Fixed label type default with nullish coalescing

#### Setup Script (scripts/setup-oauth.ts)
- **BUG-027:** Cross-platform browser opening (macOS/Windows/Linux)
- **BUG-032:** Fixed timeout cleanup on server close

### Security
- Fixed XSS vulnerability in linkify function
- Added header injection prevention
- Added comprehensive HTML escaping
- Improved error message security

### Tests
- All 72 passing tests still passing after fixes
- 2 pre-existing failures in tests/drafts.test.ts (text/plain vs text/html)

## [1.0.0] - 2025-02-12

Initial release — Google Workspace MCP server with Gmail and Calendar support.

### Added

**MCP Server Core**
- MCP server using `@modelcontextprotocol/sdk` with `StdioServerTransport`
- 12 tools registered with Zod parameter validation (11 workspace + `list_accounts`)
- All responses returned as JSON-stringified text content

**Authentication (`src/auth.ts`)**
- Multi-account OAuth2 client with v2 token file format supporting multiple accounts by alias
- Credential sources: v2 multi-account token file (`~/.config/google-workspace-mcp/tokens.json`) or env vars (fallback)
- Automatic access token refresh with per-account disk persistence
- Factory functions: `getAuthClient(account?)`, `getGmailClient(account?)`, `getCalendarClient(account?)`, `listAccounts()`
- Auto-migration from legacy single-account format to v2
- Scopes: `gmail.readonly`, `gmail.compose`, `gmail.labels`, `calendar`

**Gmail — Threads (`src/gmail/threads.ts`)**
- `gmail_list_threads` — list with search query, pagination, max results
- `gmail_get_thread` — full thread content with `full` or `minimal` format
- Multi-stage text processing pipeline: MIME body extraction → HTML stripping → quoted text removal (Gmail, Apple Mail, Outlook, generic `>` patterns) → signature removal (delimiters, mobile boilerplate, legal disclaimers, sign-off blocks) → truncation at 4000 chars
- Label filtering (keeps INBOX, UNREAD, SENT, IMPORTANT, STARRED, DRAFT; strips CATEGORY_*)
- Attachment metadata extraction (filename, mime_type, size — content not returned)

**Gmail — Drafts (`src/gmail/drafts.ts`)**
- `gmail_create_draft` — draft creation with threading support (In-Reply-To, References headers)
- `gmail_update_draft` — partial updates preserving unchanged fields
- `gmail_list_drafts` — list drafts with metadata
- `gmail_delete_draft` — permanent deletion
- RFC 2822 email construction via `buildRawEmail()`
- Plain text to styled HTML conversion: markdown links `[text](url)`, numbered lists, bullet lists, paragraph wrapping
- Threading auto-resolution: when `thread_id` provided without `in_reply_to`, fetches last message's Message-ID and builds References chain

**Gmail — Labels (`src/gmail/labels.ts`)**
- `gmail_list_labels` — lists all system and user labels

**Calendar — Events (`src/calendar/events.ts`)**
- `calendar_list_events` — time range queries, defaults to now → 7 days
- `calendar_create_event` — with attendees, location, description
- `calendar_update_event` — PATCH-based partial updates (only changed fields sent)
- `calendar_delete_event` — permanent deletion
- Smart date parsing: `YYYY-MM-DD` → all-day event, ISO 8601 datetime → timed event

**Setup (`scripts/setup-oauth.ts`)**
- Interactive OAuth wizard: prompts for credentials and account alias, opens browser, starts local callback server on port 3000
- Token exchange and persistence to `~/.config/google-workspace-mcp/tokens.json` in v2 multi-account format
- Captures email address during verification for account identification
- Post-setup verification of Gmail and Calendar API access

**Testing**
- Vitest test suite with 4 test files covering all handlers
- Mock-based tests — no real API calls
- Pure function tests for text processing utilities
- Integration test for full 6-message thread pipeline

**Utilities (`src/utils.ts`)**
- `compact()` — removes empty strings, null, undefined, and empty arrays from response objects

### Design Decisions
- **Draft-only**: no send email tool — `gmail.compose` scope allows it but code intentionally never sends
- **No attachment content**: only metadata returned to keep responses lightweight
- **ES Modules**: `"type": "module"` with `.js` import extensions throughout
- **Strict TypeScript**: ES2022 target, Node16 module resolution
