# Spec: Email Watcher Daemon

**Status**: Future plan
**Priority**: P2
**Depends on**: Existing auth + Gmail modules

## Summary

A background daemon that polls Gmail for new emails and spawns Claude CLI to triage and draft replies. Runs on a Mac Mini 24/7 via macOS launchd.

## Motivation

Currently the MCP server is request-only — Claude can read and draft emails, but only when the user initiates. This feature flips the model: Gmail pushes context to Claude automatically, enabling always-on email triage without the user in the loop.

## Architecture

```
launchd (KeepAlive)
  └─► scripts/email-watcher.ts
        ├── reuses src/auth.ts (getGmailClient)
        ├── reuses src/gmail/threads.ts (getMessageBody, strip*)
        ├── polls via gmail.users.history.list every 60s
        ├── persists state to ~/.config/google-workspace-mcp/watcher-state.json
        └── on new email:
              └─► child_process.execFile('claude', ['-p', prompt, '--model', 'sonnet'])
                    └── Claude has MCP server configured → can call create_draft, etc.
```

### Why polling over Pub/Sub

| | Polling | Gmail Pub/Sub |
|---|---|---|
| Latency | ~60s worst case | ~5s |
| External deps | None | GCP project, Pub/Sub topic, public endpoint or pull subscription |
| Network | Works behind NAT | Needs ngrok/tunnel for push, or GCP pull client |
| Complexity | ~150 lines | ~400 lines + GCP setup |
| Reliability | Simple retry | Ack/nack, lease management, expiry renewal (watch expires every 7 days) |

60s email latency is acceptable. Polling wins on simplicity.

## New files

```
scripts/email-watcher.ts           # Main daemon script
launchd/com.google-workspace-mcp.email-watcher.plist  # macOS service definition
```

No changes to existing `src/` modules — watcher imports them directly.

## State management

File: `~/.config/google-workspace-mcp/watcher-state.json`

```json
{
  "lastHistoryId": "123456",
  "processedMessageIds": ["msg_abc", "msg_def"]
}
```

- `lastHistoryId`: Gmail history cursor. Passed to `history.list` so we only get changes since last poll.
- `processedMessageIds`: Ring buffer (cap 200). Prevents double-processing on restart or if history returns duplicates.

### First run behavior

Seeds `lastHistoryId` from `users.getProfile()`. Does **not** process existing emails — only watches for new arrivals after daemon start.

### History expiry

Gmail invalidates `historyId` after ~7 days of no use. If `history.list` returns 404, the daemon re-seeds by fetching current `historyId` and resumes watching from that point. No emails are lost in the gap — they just won't be auto-triaged.

## Email processing pipeline

1. `history.list` returns new `messageAdded` events with `INBOX` + `UNREAD` labels
2. Skip if `messageId` already in `processedMessageIds`
3. Fetch full message via `messages.get(format: 'full')`
4. Extract headers: `From`, `To`, `Subject`, `Date`
5. Extract body via existing `getMessageBody()` → `stripQuotedText()` → `stripSignature()`
6. Truncate body at 3000 chars
7. Build prompt string with email content + `thread_id`
8. Spawn `claude -p <prompt> --model sonnet`
9. Push `messageId` to `processedMessageIds`, save state

## Claude invocation

```bash
claude -p "<prompt>" --model sonnet
```

- **One-shot mode** (`-p`): No interactive session. Claude processes the email and exits.
- **Model**: Sonnet for cost/speed. Email triage is a simple task.
- **Timeout**: 120s per email. Kill if exceeded.
- **Isolation**: Each email gets its own Claude process. No shared context between emails.
- **MCP access**: Claude's existing MCP server config gives it access to `create_draft`, `get_thread`, etc.

### Prompt template

```
You just received a new email. Here are the details:

From: {from}
To: {to}
Date: {date}
Subject: {subject}
Thread ID: {thread_id}

Body:
{body}

---
You have access to Gmail tools via MCP. Based on this email:
1. Determine if it needs a response
2. If yes, draft a reply using the create_draft tool with thread_id: "{thread_id}"
3. If it's FYI/notification/marketing, just note it and move on

Be concise. Only draft replies for emails that genuinely need a human response.
```

This is the default. Users should customize this with their own tone, rules, and sender-specific instructions.

## launchd service

```xml
<!-- ~/Library/LaunchAgents/com.google-workspace-mcp.email-watcher.plist -->
Label: com.google-workspace-mcp.email-watcher
ProgramArguments: npx tsx scripts/email-watcher.ts
WorkingDirectory: /path/to/google-workspace-mcp
RunAtLoad: true
KeepAlive: true
Logs: /tmp/email-watcher.{log,err}
```

Commands:
```bash
# Install
launchctl load ~/Library/LaunchAgents/com.google-workspace-mcp.email-watcher.plist

# Check status
launchctl list | grep email-watcher

# View logs
tail -f /tmp/email-watcher.log

# Stop
launchctl unload ~/Library/LaunchAgents/com.google-workspace-mcp.email-watcher.plist
```

## npm script

Add to `package.json`:
```json
{
  "scripts": {
    "watch-email": "tsx scripts/email-watcher.ts",
    "watch-email:install": "cp launchd/*.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.google-workspace-mcp.email-watcher.plist"
  }
}
```

## Configuration (future)

Not in v1, but worth planning for:

```json
// ~/.config/google-workspace-mcp/watcher-config.json
{
  "poll_interval_ms": 60000,
  "account": null,
  "model": "sonnet",
  "max_body_length": 3000,
  "timeout_ms": 120000,
  "skip_labels": ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES"],
  "skip_senders": ["noreply@*", "notifications@github.com"],
  "rules": [
    {
      "match": { "from": "*@company.com" },
      "prompt_append": "This is from a coworker. Always draft a reply. Keep it professional."
    },
    {
      "match": { "label": "CATEGORY_PROMOTIONS" },
      "action": "skip"
    }
  ],
  "notify": true
}
```

## Scopes

No new OAuth scopes required. The existing `gmail.readonly` scope covers `history.list` and `messages.get`. The existing `gmail.compose` scope covers draft creation.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Claude drafts bad reply | Embarrassment (draft only, never sends) | Draft-only by design. User reviews before sending. |
| Rate limits (Gmail API) | 429 errors, temporary block | Gmail API quota is 250 units/s. Polling once/min uses ~5 calls. Not a concern. |
| Rate limits (Claude API) | Blocked, cost spike | Sonnet is cheap. 50 emails/day = ~$0.50. Add queue if volume is high. |
| Runaway spawning | 100 Claude instances | Process new emails sequentially, not in parallel. One at a time. |
| Token refresh fails | Daemon stops working | Existing `oauth2Client.on('tokens')` handler in auth.ts auto-refreshes. Log and alert on auth errors. |
| Mac Mini sleeps | Daemon pauses | Disable sleep: `sudo pmset -a disablesleep 1`, or use caffeinate. |
| historyId expires | Gap in coverage | Auto-detects 404, re-seeds. Acceptable for email triage. |

## Out of scope for v1

- Gmail Pub/Sub (real-time push) — overkill for this use case
- Web UI / dashboard for reviewing what Claude drafted
- Multi-account watching (watch only default account)
- Attachment processing (body text only)
- Calendar integration (e.g., auto-RSVP)
- Sending emails (draft-only is a safety invariant)

## Future enhancements (v2+)

- **macOS notifications**: `osascript -e 'display notification "Claude drafted a reply to {from}" with title "Email Watcher"'`
- **Filter rules config file**: Skip senders, skip label categories, custom prompts per sender
- **Digest mode**: Batch emails every 15min, give Claude a summary prompt instead of one-by-one
- **Webhook mode**: Optional HTTP server + ngrok for Pub/Sub push (sub-5s latency)
- **Metrics**: Track emails processed, drafts created, errors, cost per day
- **Multi-account**: Watch all configured accounts, not just default

## Implementation order

1. `scripts/email-watcher.ts` — core polling loop + Claude spawning
2. Manual testing: `npm run watch-email`, send yourself test emails
3. `launchd/` plist + install script
4. Add to CLAUDE.md and README
