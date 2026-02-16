# Google Workspace MCP Server

An MCP (Model Context Protocol) server that gives AI assistants access to Gmail and Google Calendar through a standardized tool interface. Built with TypeScript.

## Features

### Gmail
- **Threads** — List and read email threads with full text processing (quote stripping, signature removal, HTML-to-text conversion)
- **Drafts** — Create, update, list, and delete email drafts with threaded reply support (draft-only, never sends)
- **Labels** — List all Gmail labels (system + user)

### Calendar
- **Events** — Create, list, update, and delete calendar events with support for all-day events, attendees, and locations

## Prerequisites

- Node.js 18+
- A Google Cloud project with the **Gmail API** and **Google Calendar API** enabled
- OAuth 2.0 client credentials (Desktop app type) from [Google Cloud Console](https://console.cloud.google.com/apis/credentials)

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Run the OAuth setup wizard

```bash
npm run setup
```

This will:
1. Prompt you for your OAuth Client ID and Client Secret
2. Open a browser window for Google authorization
3. Start a local callback server on `http://localhost:3000/oauth2callback`
4. Save tokens to `~/.config/google-workspace-mcp/tokens.json`
5. Verify Gmail and Calendar API access

> **Redirect URI**: Make sure `http://localhost:3000/oauth2callback` is listed as an authorized redirect URI in your Google Cloud Console OAuth credentials.

> **No refresh token?** If the setup fails because no refresh token was received, revoke app access at https://myaccount.google.com/permissions and run setup again.

### 3. Build and run

```bash
npm run build
npm start
```

## Usage with MCP Clients

Add to your MCP client config (Claude Desktop, Claude Code, etc.):

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/absolute/path/to/google-workspace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

The env vars are only needed if you haven't run `npm run setup` (which saves tokens to a file instead). If the token file exists, it takes precedence over env vars.

## Available Tools

### Gmail

| Tool | Description |
|------|-------------|
| `gmail_list_threads` | List threads with optional search query (`is:inbox`, `newer_than:14d`, `from:me`, etc.), pagination, and max results |
| `gmail_get_thread` | Read full thread content — all messages with bodies, or `minimal` format for metadata only |
| `gmail_create_draft` | Create a draft email with optional threading (`thread_id`, `in_reply_to`). Supports to/cc/bcc |
| `gmail_update_draft` | Update an existing draft — only provide fields you want to change |
| `gmail_delete_draft` | Permanently delete a draft |
| `gmail_list_drafts` | List all drafts with IDs, subjects, and recipients |
| `gmail_list_labels` | List all Gmail labels (system and user, including Superhuman auto-labels) |

### Calendar

| Tool | Description |
|------|-------------|
| `calendar_list_events` | List events in a time range (defaults: now to 7 days). Supports custom `calendar_id` |
| `calendar_create_event` | Create an event with summary, start/end, attendees, location, description |
| `calendar_update_event` | Update an event — only changed fields are sent (PATCH) |
| `calendar_delete_event` | Delete an event |

## OAuth Scopes

| Scope | Purpose |
|-------|---------|
| `gmail.readonly` | Read threads, messages, labels |
| `gmail.compose` | Create and manage drafts |
| `gmail.labels` | List labels |
| `calendar` | Full calendar read/write |

## Development

```bash
npm run build          # Compile TypeScript (tsc → dist/)
npm test               # Run all tests (vitest)
npx vitest run tests/drafts.test.ts   # Run a single test file
```

### Project Structure

```
src/
├── index.ts              # MCP server — tool registration and transport
├── auth.ts               # OAuth2 client factory, token management
├── utils.ts              # compact() utility
├── gmail/
│   ├── threads.ts        # Thread list/get with text processing pipeline
│   ├── drafts.ts         # Draft CRUD, RFC 2822 email building
│   └── labels.ts         # Label listing
└── calendar/
    └── events.ts         # Calendar event CRUD

tests/                    # Vitest — mock-based, no real API calls
scripts/
└── setup-oauth.ts        # Interactive OAuth setup wizard
```

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation and [INDEX.md](INDEX.md) for a file-by-file reference.

## License

MIT
