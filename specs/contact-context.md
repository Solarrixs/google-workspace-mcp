# Spec: Contact Context Tool

**Status**: Planned
**Priority**: P1
**Depends on**: Existing auth, Gmail threads, Calendar events modules

## Summary

A new MCP tool (`gmail_contact_context`) that builds a comprehensive relationship profile for a given email address by aggregating data from Gmail threads and Google Calendar events. Returns communication patterns, recent interactions, upcoming shared events, and relationship signals — everything an AI assistant needs to prepare for a meeting or draft an informed reply.

## Motivation

AI assistants drafting replies or preparing meeting briefs need relational context: How often do I talk to this person? When did we last interact? What topics do we discuss? Are they a close collaborator or a distant acquaintance? Do I owe them a reply?

Today, answering "tell me about my relationship with john@company.com" requires the AI to orchestrate multiple tool calls — `gmail_list_threads` with a `from:` query, then again with a `to:` query, then `calendar_list_events`, then manually compute frequency and patterns. This is slow (multiple round trips), token-expensive, and error-prone (the AI has to get the aggregation logic right every time).

`gmail_contact_context` collapses this into a single tool call that returns a pre-computed relationship summary. The AI gets structured data it can immediately reason over.

**Use cases:**
- "Brief me on my relationship with sarah@acme.com before our 1:1"
- "I got an email from david@vendor.io — should I prioritize this?"
- "Who have I been most in touch with this month?"
- Email watcher daemon (specs/email-watcher.md) could call this to add sender context to Claude's triage prompt

## MCP Tool Definition

### Name

`gmail_contact_context`

### Description

"Get relationship context for an email address: recent threads, upcoming calendar events together, communication frequency, and interaction patterns. Useful for preparing meeting briefs or contextualizing incoming emails."

### Parameters

```typescript
{
  email: z.string().email().describe(
    'Email address to look up (e.g., "john@company.com")'
  ),
  lookback_days: z.number().min(1).max(365).optional().describe(
    'How far back to scan email history (default: 90)'
  ),
  lookahead_days: z.number().min(0).max(90).optional().describe(
    'How far ahead to scan calendar events (default: 14)'
  ),
  max_threads: z.number().min(1).max(50).optional().describe(
    'Max threads to return in recent_threads (default: 10)'
  ),
  account: accountParam,
}
```

### Response Shape

```typescript
interface ContactContextResponse {
  email: string;
  display_name: string | null;           // Extracted from "Name <email>" in headers

  // --- Communication Stats ---
  stats: {
    total_threads: number;               // Total threads involving this person in lookback window
    threads_they_started: number;        // Threads where their message is first
    threads_you_started: number;         // Threads where your message is first
    total_messages_from_them: number;    // Individual messages received
    total_messages_from_you: number;     // Individual messages sent (to/cc)
    first_interaction: string;           // ISO date of earliest message in window
    last_interaction: string;            // ISO date of most recent message
    days_since_last_interaction: number;
  };

  // --- Communication Patterns ---
  patterns: {
    avg_messages_per_week: number;                // Across the lookback window
    communication_direction: 'mostly_inbound' | 'mostly_outbound' | 'balanced';
    they_cc_you: boolean;                         // true if they CC you on threads with others
    you_cc_them: boolean;                         // true if you CC them on threads with others
    avg_reply_time_hours: number | null;          // Your avg reply time to their messages (null if insufficient data)
    their_avg_reply_time_hours: number | null;    // Their avg reply time to your messages
    has_unanswered_thread: boolean;               // You have an unreplied message from them
    common_labels: string[];                      // Labels frequently on threads with this person
  };

  // --- Recent Threads (compact) ---
  recent_threads: Array<{
    thread_id: string;
    subject: string;
    last_message_date: string;
    message_count: number;
    last_message_from: 'them' | 'you' | 'other';
    is_unread: boolean;
    labels: string[];
    snippet: string;
  }>;

  // --- Upcoming Calendar Events ---
  upcoming_events: Array<{
    event_id: string;
    summary: string;
    start: string;
    end: string;
    attendee_count: number;            // Total attendees including you and them
    is_one_on_one: boolean;            // Only you and them (2 attendees)
  }>;

  // --- Derived Signals ---
  signals: {
    relationship_strength: 'strong' | 'moderate' | 'weak' | 'new';
    pending_action: boolean;           // true if has_unanswered_thread or upcoming event soon
    summary: string;                   // Human-readable 1-2 sentence summary
  };
}
```

## Data Sources

### 1. Gmail Threads

Two queries executed in parallel via `gmail.users.threads.list`:

| Query | Purpose |
|---|---|
| `from:{email} newer_than:{lookback_days}d` | Messages they sent |
| `to:{email} newer_than:{lookback_days}d` | Messages you sent to them |

Results are merged and deduplicated by `thread_id` (a thread often appears in both queries). Each deduplicated thread is fetched with `format: 'metadata'` and `metadataHeaders: ['From', 'To', 'Cc', 'Date', 'Subject', 'Message-ID']` to extract participants and timestamps without downloading full bodies.

**Pagination**: The tool fetches up to 100 threads per query (200 total before dedup). This covers the vast majority of contacts. If `nextPageToken` exists, it is discarded — the tool is a summary, not an exhaustive audit.

**Display name extraction**: Scanned from `From` headers on messages from the target email. Takes the first non-empty display name found (e.g., `"John Smith" <john@company.com>` yields `"John Smith"`).

### 2. Google Calendar Events

Single query via `calendar.events.list`:

```typescript
{
  calendarId: 'primary',
  timeMin: now.toISOString(),
  timeMax: lookahead.toISOString(),
  maxResults: 25,
  singleEvents: true,
  orderBy: 'startTime',
  q: email,   // Calendar API supports free-text search across attendees
}
```

Post-filter: only include events where the target `email` appears in the `attendees` array. The `q` param is a hint for the API but is not guaranteed to filter by attendee email, so client-side filtering is required.

### 3. User's Own Email

Fetched once via `gmail.users.getProfile({ userId: 'me' })` to determine the authenticated user's email address. Needed to distinguish "your messages" from "their messages" in shared threads.

## Aggregation Logic

### Thread Processing

For each deduplicated thread (fetched with metadata format):

1. **Iterate messages** and classify each by sender:
   - `from_them`: sender matches target email
   - `from_you`: sender matches user's own email
   - `from_other`: neither (group thread)

2. **Thread initiator**: Check the first message's `From` header to determine `threads_they_started` vs `threads_you_started`.

3. **Last message author**: Check the last message's `From` header for `last_message_from` field.

4. **Unanswered detection**: A thread has `has_unanswered_thread = true` if the most recent message is `from_them` AND the thread has `UNREAD` label or the thread has `INBOX` label and no subsequent message from you.

5. **CC detection**: Scan `Cc` headers — `they_cc_you` is true if any message from them has the user's email in CC. `you_cc_them` is true if any message from you has their email in CC.

6. **Labels**: Collect all labels across threads, count frequencies, return top 5 most common (excluding system labels like `INBOX`, `UNREAD`, `SENT`).

### Reply Time Estimation

For consecutive message pairs in a thread where one party replies to the other:

1. Find pairs where message N is from party A and message N+1 is from party B.
2. Compute `date(N+1) - date(N)` in hours.
3. Discard outliers > 168 hours (7 days) — these are likely separate conversation bursts, not replies.
4. Average the remaining values.
5. Return `null` if fewer than 2 valid pairs (insufficient data).

### Communication Direction

```
ratio = total_messages_from_them / (total_messages_from_them + total_messages_from_you)
```

- `ratio > 0.65` => `'mostly_inbound'`
- `ratio < 0.35` => `'mostly_outbound'`
- else => `'balanced'`

### Relationship Strength

Heuristic based on multiple signals:

```
strong:   avg_messages_per_week >= 3 OR (total_threads >= 15 AND days_since_last < 7)
moderate: avg_messages_per_week >= 0.5 OR total_threads >= 5
weak:     total_threads >= 1 AND total_threads < 5
new:      total_threads == 0 (only calendar events, no email history)
```

### Summary Generation

Template-driven, not LLM-generated. Examples:

- "You and John Smith exchange about 5 messages/week. Last interaction was 2 days ago. You have an unanswered email from them and a 1:1 meeting on Tuesday."
- "Occasional contact — 3 threads in the last 90 days, mostly initiated by them. No upcoming events."
- "No email history. You have 2 upcoming calendar events together."

## Privacy Considerations

### Data Minimization

- **No message bodies are returned.** Only metadata: subjects, dates, participants, labels, snippets. This limits exposure if the MCP response is logged or cached.
- **Snippets are capped at 150 characters**, matching existing `handleListThreads` behavior.
- **Reply time is averaged**, not per-message. Individual timestamps of specific messages are not exposed in the response (only the aggregate stat and the `last_message_date` per thread).

### Scope Boundaries

- Uses only `gmail.readonly` and `calendar` scopes — no new OAuth scopes required.
- Read-only operation. Cannot modify emails or calendar events.
- Cannot access contacts that the user has never interacted with via email or calendar. This is a feature: the tool only surfaces information the user already has.

### Multi-Account

- Respects the `account` parameter. Context is scoped to a single Google account. The tool does not cross-reference accounts (e.g., work email threads are not mixed with personal calendar events).

### Rate Limiting

- The tool makes 3-4 API calls minimum (profile, 2 thread list queries, calendar events) plus 1 call per unique thread for metadata (up to ~100). Total: ~104 API calls worst case.
- Gmail API quota is 250 quota units/second. Thread metadata fetches use 1 unit each. The tool stays well within limits.
- Thread metadata fetches are parallelized via `Promise.all` (matching existing `handleListThreads` pattern).

## Module Location

### New File: `src/gmail/contacts.ts`

Even though the tool spans Gmail and Calendar, the primary data source is Gmail and the entry point is an email address. Placing it in `src/gmail/` keeps the module hierarchy flat and consistent.

```
src/gmail/contacts.ts
  ├── imports: getHeader, extractEmailAddresses from './threads.js'
  ├── imports: compact from '../utils.js'
  ├── exports: handleContactContext(gmail, calendar, params)
```

Note: This is the first handler that receives **both** a Gmail and Calendar client. The tool registration in `src/index.ts` will call both `getGmailClient(account)` and `getCalendarClient(account)`.

### Dependency Graph Update

```
src/utils.ts (compact)
  ↑ imported by threads.ts, drafts.ts, events.ts, contacts.ts
src/gmail/threads.ts (getHeader, extractEmailAddresses)
  ↑ imported by drafts.ts, contacts.ts
src/auth.ts
  ↑ imported by index.ts
src/gmail/contacts.ts (handleContactContext)   ← NEW
  ↑ imported by index.ts
```

## Tool Registration in `src/index.ts`

```typescript
import { handleContactContext } from './gmail/contacts.js';

server.tool(
  'gmail_contact_context',
  'Get relationship context for an email address: recent threads, upcoming calendar events together, communication frequency, and interaction patterns.',
  {
    email: z.string().email().describe('Email address to look up'),
    lookback_days: z.number().min(1).max(365).optional()
      .describe('How far back to scan email history (default: 90)'),
    lookahead_days: z.number().min(0).max(90).optional()
      .describe('How far ahead to scan calendar events (default: 14)'),
    max_threads: z.number().min(1).max(50).optional()
      .describe('Max threads to return in recent_threads (default: 10)'),
    account: accountParam,
  },
  async (params) => {
    try {
      const { account, ...handlerParams } = params;
      const gmail = getGmailClient(account);
      const calendar = getCalendarClient(account);
      const result = await handleContactContext(gmail, calendar, handlerParams);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error occurred' })
        }]
      };
    }
  }
);
```

## Handler Skeleton: `src/gmail/contacts.ts`

```typescript
import type { gmail_v1 } from 'googleapis';
import type { calendar_v3 } from 'googleapis';
import { getHeader, extractEmailAddresses } from './threads.js';
import { compact } from '../utils.js';

interface ContactContextParams {
  email: string;
  lookback_days?: number;
  lookahead_days?: number;
  max_threads?: number;
}

export async function handleContactContext(
  gmail: gmail_v1.Gmail,
  calendar: calendar_v3.Calendar,
  params: ContactContextParams
) {
  const lookbackDays = params.lookback_days ?? 90;
  const lookaheadDays = params.lookahead_days ?? 14;
  const maxThreads = params.max_threads ?? 10;
  const email = params.email.toLowerCase();

  // 1. Get user's own email
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const myEmail = profile.data.emailAddress?.toLowerCase() || '';

  // 2. Fetch threads (from them + to them) and calendar events in parallel
  const [fromThemRes, toThemRes, calendarRes] = await Promise.all([
    gmail.users.threads.list({
      userId: 'me',
      q: `from:${email} newer_than:${lookbackDays}d`,
      maxResults: 100,
    }),
    gmail.users.threads.list({
      userId: 'me',
      q: `to:${email} newer_than:${lookbackDays}d`,
      maxResults: 100,
    }),
    calendar.events.list({
      calendarId: 'primary',
      timeMin: new Date().toISOString(),
      timeMax: new Date(Date.now() + lookaheadDays * 86400000).toISOString(),
      maxResults: 25,
      singleEvents: true,
      orderBy: 'startTime',
      q: email,
    }),
  ]);

  // 3. Deduplicate threads by ID
  const threadMap = new Map<string, true>();
  const allThreadIds: string[] = [];
  for (const t of [...(fromThemRes.data.threads || []), ...(toThemRes.data.threads || [])]) {
    if (t.id && !threadMap.has(t.id)) {
      threadMap.set(t.id, true);
      allThreadIds.push(t.id);
    }
  }

  // 4. Fetch metadata for each thread (parallelized)
  const threads = await Promise.all(
    allThreadIds.map(id =>
      gmail.users.threads.get({
        userId: 'me',
        id,
        format: 'metadata',
        metadataHeaders: ['From', 'To', 'Cc', 'Date', 'Subject', 'Message-ID'],
      })
    )
  );

  // 5. Aggregate stats, patterns, recent_threads from thread metadata
  // 6. Filter calendar events by attendee email
  // 7. Compute derived signals
  // 8. Build and return response

  // ... (full implementation)
}
```

## Implementation Plan

### Phase 1: Core handler (2-3 hours)

1. Create `src/gmail/contacts.ts` with `handleContactContext`
2. Implement thread fetching, deduplication, and metadata extraction
3. Implement stats aggregation (counts, dates, direction)
4. Implement calendar event filtering
5. Build response object

### Phase 2: Relationship signals (1-2 hours)

1. Implement reply time estimation with outlier filtering
2. Implement CC detection logic
3. Implement unanswered thread detection
4. Implement relationship strength heuristic
5. Implement template-driven summary generation

### Phase 3: Tool registration and integration (30 min)

1. Add import and `server.tool()` registration in `src/index.ts`
2. Update CLAUDE.md with new tool description and module in dependency graph
3. Build and smoke test

### Phase 4: Tests (1-2 hours)

1. Create `tests/contacts.test.ts`
2. Mock both Gmail and Calendar clients
3. Test cases:
   - Single thread, one message each direction
   - No email history but calendar events exist (relationship_strength: 'new')
   - Heavy communicator (20+ threads, balanced direction)
   - CC detection across multiple threads
   - Reply time calculation with outlier filtering
   - Unanswered thread detection
   - Empty results (unknown contact)
   - Display name extraction from various `From` header formats

### Phase 5: Documentation

1. Update INDEX.md with new module exports
2. Update CHANGELOG.md

## Edge Cases

| Case | Behavior |
|---|---|
| Email not found in any thread or event | Return zeroed stats, empty arrays, `relationship_strength: 'new'`, summary: "No interaction history found." |
| User looks up their own email | Works but stats will be skewed (every sent message matches). No special handling — the data is still accurate, just self-referential. |
| Email appears only in CC (never in From/To) | Won't appear in `from:{email}` or `to:{email}` queries. This is a known limitation. A `cc:{email}` query could be added in v2. |
| Very high thread count (100+ in window) | Capped at 100 threads per query (200 pre-dedup). Sufficient for a summary. Stats note the cap if hit: `total_threads` is approximate. |
| Calendar event with no attendees list | Filtered out (q param matches but no attendee email to verify). |
| Rate limiting (429 from Gmail API) | Propagates as error to the MCP caller. No internal retry — matches existing tool behavior. |

## Out of Scope for v1

- **Google Contacts API integration**: Would provide phone numbers, job titles, profile photos. Requires additional OAuth scope (`contacts.readonly`). Planned for v2.
- **Cross-account context**: Merging data across work and personal accounts. Complex and privacy-sensitive.
- **Sentiment analysis on thread subjects/snippets**: Useful but better left to the AI assistant consuming the data.
- **Caching**: Each call is fresh. A cache layer (keyed by email + account + date) could be added later for the email watcher use case where the same contact appears repeatedly.
- **CC-only contacts**: Threads where the target email only appears in CC are not captured by `from:`/`to:` queries. Could add a third `cc:{email}` query in v2.
- **Batch lookups**: Looking up multiple emails in one call. The AI can call the tool multiple times; batch optimization can come later.
