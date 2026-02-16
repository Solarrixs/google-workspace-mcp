# Google Workspace MCP Server

An MCP (Model Context Protocol) server that provides AI assistants with access to Google Gmail and Calendar APIs through a standardized interface.

## Features

### Gmail
- **Threads**: List, read, move, archive, trash, and delete email threads
- **Drafts**: Create and manage email drafts
- **Labels**: List and manage Gmail labels

### Calendar
- **Events**: Create, list, update, and delete calendar events
- Support for recurring events, attendees, and reminders

## Prerequisites

- Node.js 18+
- Google Cloud Console account with OAuth2 credentials

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Create Google OAuth2 Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
2. Create a new project or select an existing one
3. Enable the following APIs:
   - Gmail API
   - Google Calendar API
4. Create OAuth 2.0 client credentials (Desktop app)
5. Copy the Client ID and Client Secret

### 3. Configure Environment Variables

```bash
cp .env.example .env
```

Edit `.env` and add your Google OAuth credentials:

```env
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 4. OAuth Authorization Flow

Run the setup script to generate your refresh token:

```bash
npm run setup
```

This will:
- Open a browser window for Google OAuth authorization
- Store the refresh token in your `.env` file
- Allow the application to access your Gmail and Calendar

⚠️ **Note**: Never commit your `.env` file or OAuth credentials to a public repository.

### 5. Build the Project

```bash
npm run build
```

### 6. Run the MCP Server

```bash
npm start
```

## Usage with Claude

To use this MCP server with Claude Desktop or compatible MCP clients, add the server configuration to your MCP client's configuration file:

```json
{
  "mcpServers": {
    "google-workspace": {
      "command": "node",
      "args": ["/path/to/google-workspace-mcp/dist/index.js"],
      "env": {
        "GOOGLE_CLIENT_ID": "your-client-id.apps.googleusercontent.com",
        "GOOGLE_CLIENT_SECRET": "your-client-secret",
        "GOOGLE_REFRESH_TOKEN": "your-refresh-token"
      }
    }
  }
}
```

## Available Tools

### Gmail Tools

| Tool | Description |
|------|-------------|
| `gmail_list_threads` | List email threads |
| `gmail_get_thread` | Get a specific email thread |
| `gmail_send_reply` | Send a reply to an email thread |
| `gmail_create_draft` | Create an email draft |
| `gmail_update_draft` | Update an email draft |
| `gmail_delete_draft` | Delete an email draft |
| `gmail_list_labels` | List Gmail labels |
| `gmail_create_label` | Create a Gmail label |
| `gmail_delete_label` | Delete a Gmail label |
| `gmail_move_thread` | Move thread to a label/folder |
| `gmail_archive_thread` | Archive an email thread |
| `gmail_unarchive_thread` | Unarchive an email thread |
| `gmail_trash_thread` | Move thread to trash |
| `gmail_untrash_thread` | Restore thread from trash |
| `gmail_delete_thread` | Permanently delete a thread |

### Calendar Tools

| Tool | Description |
|------|-------------|
| `calendar_create_event` | Create a calendar event |
| `calendar_list_events` | List calendar events |
| `calendar_update_event` | Update an existing event |
| `calendar_delete_event` | Delete a calendar event |

## Development

### Build

```bash
npm run build
```

### Run Tests

```bash
npm test
```

### Project Structure

```
google-workspace-mcp/
├── src/
│   ├── auth.ts          # OAuth2 authentication setup
│   ├── index.ts         # Main MCP server entry point
│   ├── gmail/
│   │   ├── drafts.ts    # Draft management
│   │   ├── labels.ts    # Label management
│   │   └── threads.ts   # Thread management
│   ├── calendar/
│   │   └── events.ts    # Calendar event management
│   └── utils.ts         # Utility functions
├── scripts/
│   └── setup-oauth.ts   # OAuth setup script
└── tests/               # Test files
```

## Security Notes

- OAuth refresh tokens are sensitive — store them securely
- Never commit `.env` files or OAuth credentials
- This app requests `https://www.googleapis.com/auth/gmail.readonly`, `https://www.googleapis.com/auth/gmail.send`, and `https://www.googleapis.com/auth/calendar` scopes
- Consider using environment-specific credentials for development vs production

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
