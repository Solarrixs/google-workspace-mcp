# Changelog

All notable changes to this project are documented here.

## [1.0.0] - 2025-02-12

Initial release — Google Workspace MCP server with Gmail and Calendar support.

### Added

**MCP Server Core**
- MCP server using `@modelcontextprotocol/sdk` with `StdioServerTransport`
- 11 tools registered with Zod parameter validation
- All responses returned as JSON-stringified text content

**Authentication (`src/auth.ts`)**
- OAuth2 client with dual credential sources: token file (`~/.config/google-workspace-mcp/tokens.json`) or environment variables
- Automatic access token refresh with disk persistence via `oauth2Client.on('tokens', ...)`
- Factory functions: `getAuthClient()`, `getGmailClient()`, `getCalendarClient()`
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
- Interactive OAuth wizard: prompts for credentials, opens browser, starts local callback server on port 3000
- Token exchange and persistence to `~/.config/google-workspace-mcp/tokens.json`
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
