# Spec: Email Digest Tool

**Status**: Proposed
**Priority**: P1
**Depends on**: Existing auth, threads, labels modules

## Summary

A new MCP tool (`gmail_digest`) that generates a structured, pre-classified summary of recent email activity. Unlike `gmail_list_threads` (which returns raw thread metadata) or the email watcher (which processes emails one-at-a-time as they arrive), the digest tool reads, classifies, and groups threads into actionable categories so the AI assistant receives an organized briefing in a single call.

## Motivation

Today, an AI assistant that wants to brief the user on their inbox must:

1. Call `gmail_list_threads` with a time-based query
2. Call `gmail_get_thread` on each thread individually
3. Manually classify and group results
4. Summarize everything itself

This is slow (N+1 API calls), burns context window tokens on raw data, and pushes classification logic into the prompt rather than the tool layer. The digest tool collapses this into one call that returns a pre-organized summary — the assistant can immediately present it or act on it.

## Use Cases

- **Morning briefing**: "Give me a digest of everything since yesterday 6pm"
- **Catch-up after meetings**: "What came in during the last 2 hours?"
- **End-of-day review**: "Summarize my inbox from today — what still needs a response?"
- **Cross-account overview**: "Digest my work inbox from the last 24 hours"
- **Filtered digest**: "Show me only threads that need a response from the last week"

## MCP Tool Definition

### `gmail_digest`

**Description**: Generate a structured digest of recent email activity, grouped by urgency and category. Returns pre-classified threads with summaries, not raw message data.

### Parameters

```typescript
{
  // Time range — at least one required
  since: z.string().optional()
    .describe('ISO 8601 timestamp or relative string. Threads with activity after this time are included. Examples: "2026-03-13T18:00:00Z", "24h", "2d", "1w"'),

  until: z.string().optional()
    .describe('ISO 8601 timestamp. Upper bound for thread activity. Defaults to now.'),

  // Filtering
  categories: z.array(z.enum([
    'needs_response',
    'waiting',
    'fyi',
    'newsletter',
    'notification',
    'meeting',
    'commerce',
  ])).optional()
    .describe('Only include these categories. Omit to include all.'),

  max_threads: z.number().min(1).max(200).optional()
    .describe('Max threads to process (default: 50). Higher values = more complete but larger output.'),

  include_body_preview: z.boolean().optional()
    .describe('Include a truncated body preview for each thread (default: true). Set false for a more compact digest.'),

  // Standard
  account: accountParam,
}
```

### Relative Time Parsing

The `since` parameter accepts relative shorthand that the handler converts to a Gmail search query:

| Input | Gmail query equivalent |
|---|---|
| `"24h"` | `newer_than:1d` |
| `"2d"` | `newer_than:2d` |
| `"1w"` | `newer_than:7d` |
| ISO 8601 string | `after:{epoch_seconds}` |

If `since` is omitted, defaults to 24 hours ago. If `until` is provided, adds `before:{epoch_seconds}`.

## Output Structure

```typescript
interface DigestOutput {
  // Metadata
  account: string;            // Account alias used
  time_range: {
    since: string;            // ISO 8601
    until: string;            // ISO 8601
  };
  thread_count: number;       // Total threads processed
  digest_truncated: boolean;  // True if output was trimmed to fit budget

  // Grouped results — only categories with threads are included
  categories: {
    needs_response?: DigestCategory;
    waiting?: DigestCategory;
    fyi?: DigestCategory;
    newsletter?: DigestCategory;
    notification?: DigestCategory;
    meeting?: DigestCategory;
    commerce?: DigestCategory;
  };

  // Threads that couldn't be confidently classified
  uncategorized?: DigestCategory;
}

interface DigestCategory {
  count: number;
  threads: DigestThread[];
}

interface DigestThread {
  thread_id: string;
  subject: string;
  from: string;               // Most recent sender (display name + email)
  participants: string[];     // All unique senders in thread
  last_message_date: string;  // ISO 8601
  message_count: number;
  is_unread: boolean;
  labels: string[];           // Filtered labels (same logic as handleListThreads)
  body_preview?: string;      // Truncated latest message body (when include_body_preview=true)
  classification_signal: string; // Why this thread was put in this category
}
```

### Example Output

```json
{
  "account": "work",
  "time_range": { "since": "2026-03-13T18:00:00Z", "until": "2026-03-14T10:00:00Z" },
  "thread_count": 23,
  "digest_truncated": false,
  "categories": {
    "needs_response": {
      "count": 3,
      "threads": [
        {
          "thread_id": "18e1abc...",
          "subject": "Q2 planning — need your input by Friday",
          "from": "Alice Chen <alice@company.com>",
          "participants": ["alice@company.com", "bob@company.com"],
          "last_message_date": "2026-03-14T08:30:00Z",
          "message_count": 4,
          "is_unread": true,
          "labels": ["INBOX", "UNREAD"],
          "body_preview": "Hey, circling back on this — can you review the doc and add your section before EOD Friday?",
          "classification_signal": "label:AI/Respond"
        }
      ]
    },
    "waiting": {
      "count": 2,
      "threads": [...]
    },
    "fyi": {
      "count": 8,
      "threads": [...]
    },
    "newsletter": {
      "count": 10,
      "threads": [...]
    }
  }
}
```

## Classification Strategy

Classification uses a two-pass approach: Superhuman labels first (high confidence), then heuristics for unlabeled threads.

### Pass 1: Superhuman Labels (Authoritative)

Superhuman's AI labels are the primary classification signal. When present, they override heuristics.

| Superhuman Label | Digest Category | Notes |
|---|---|---|
| `[Superhuman]/AI/Respond` | `needs_response` | Someone is waiting on the user |
| `[Superhuman]/AI/Waiting` | `waiting` | User is waiting on someone else |
| `[Superhuman]/AI/Marketing` | `newsletter` | Marketing emails |
| `[Superhuman]/AI/News` | `newsletter` | Newsletters |
| `[Superhuman]/AI/Social` | `notification` | Social notifications |
| `[Superhuman]/AI/Meeting` | `meeting` | Calendar invites, scheduling |
| `[Superhuman]/AI/Order` | `commerce` | Order confirmations (work account) |
| `[Superhuman]/AI/Shipping` | `commerce` | Shipping updates (work account) |
| `[Superhuman]/AI/Travel` | `commerce` | Travel confirmations (personal account) |
| `[Superhuman]/AI/Pitch` | `notification` | Sales pitches |
| `[Superhuman]/AI/Signature` | `notification` | Signature requests |

Skipped entirely (not included in digest unless user explicitly filters):

| Label | Reason |
|---|---|
| `[Superhuman]/AI/AutoArchived` | Already triaged by Superhuman |
| `[Superhuman]/Is Snoozed` | Deferred intentionally |
| `[Superhuman]/Muted` | Muted thread |

### Pass 2: Heuristics (Fallback)

For threads without Superhuman labels (or accounts that don't use Superhuman), apply rule-based heuristics in priority order:

1. **`needs_response`** — Thread is UNREAD + INBOX, user is in `To:` (not just CC), last message is not from the user, and the thread is a direct conversation (not a bulk sender). Excludes noreply addresses.

2. **`waiting`** — Last message in thread is from the user (user sent most recently and is likely waiting for a reply).

3. **`meeting`** — Subject or headers contain calendar invite indicators: `text/calendar` MIME part, subject matches `/(?:invite|rsvp|calendar|meeting|scheduled)/i`, or has `CATEGORY_UPDATES` label with scheduling keywords.

4. **`commerce`** — From address matches known commerce senders (e.g., `*@amazon.com`, `*@shopify.com`, `*@ups.com`, `*@fedex.com`), or subject matches `/(?:order|shipping|delivered|tracking|receipt|invoice)/i`.

5. **`newsletter`** — Has `List-Unsubscribe` header, `CATEGORY_PROMOTIONS` label, `CATEGORY_FORUMS` label, or from address matches newsletter patterns (`*@substack.com`, `*@medium.com`, `news@*`, `newsletter@*`).

6. **`notification`** — From a noreply/no-reply address, has `CATEGORY_UPDATES` label, or sender domain is a known notification source (`github.com`, `linear.app`, `slack.com`, `notion.so`, etc.).

7. **`fyi`** — User is in CC but not TO, or thread matches none of the above patterns but is in INBOX.

8. **`uncategorized`** — Anything that doesn't match. Should be rare.

The `classification_signal` field on each thread records which rule matched (e.g., `"label:AI/Respond"`, `"heuristic:user_in_to+unread"`, `"heuristic:list_unsubscribe_header"`) for transparency and debugging.

### Determining "User's Email"

To distinguish "from the user" vs "from others," the handler calls `users.getProfile` to get the authenticated user's email address. This is cached for the lifetime of the handler call.

## Text Pipeline Integration

The digest reuses the existing text processing pipeline from `src/gmail/threads.ts`:

### Per-Thread Processing

For each thread included in the digest, the handler:

1. Fetches the thread via `gmail.users.threads.get({ format: 'full' })` — same as `handleGetThread`
2. Extracts headers from all messages: `From`, `To`, `Cc`, `Subject`, `Date`, `List-Unsubscribe`, `Message-ID`
3. For `body_preview` (latest message only):
   - `getMessageBody(payload)` — MIME extraction, prefers text/plain
   - `stripQuotedText(body)` — removes quoted replies
   - `stripSignature(body)` — removes signatures
   - Truncate to `PREVIEW_MAX_CHARS` (200 chars) — shorter than `handleGetThread`'s 2500 limit since previews are meant to be glanceable
4. For classification:
   - Reads `labelIds` from all messages in the thread
   - Checks headers for `List-Unsubscribe`, `Content-Type: text/calendar`
   - Extracts sender addresses via `extractEmailAddresses(getHeader(headers, 'From'))`

### Parallelism

Thread fetching is parallelized with `Promise.all`, same as `handleListThreads`. To avoid hammering the Gmail API on large digests, fetches are batched in groups of 10 with a concurrency limiter.

## Truncation and Token Budget Strategy

The digest must stay within a reasonable size for the AI assistant's context window. Target: **~8,000 characters** for the full JSON output (roughly 2,000-2,500 tokens).

### Budget Allocation

| Component | Budget | Notes |
|---|---|---|
| Metadata + structure | ~200 chars | Fixed overhead |
| `needs_response` threads | 40% of remaining | Highest priority — more detail |
| `waiting` threads | 15% of remaining | Medium priority |
| `fyi` threads | 15% of remaining | Medium priority |
| All other categories | 30% of remaining | Lower priority — compressed |

### Truncation Rules (applied in order)

1. **Body preview truncation**: Each `body_preview` is capped at 200 characters. If the digest is still over budget after processing all threads, previews are progressively shortened to 100, then 50 chars, starting from the lowest-priority categories.

2. **Thread count limits per category**: If a category has more threads than its budget allows:
   - Keep all threads in `needs_response` (up to 20)
   - Keep up to 10 threads in `waiting`, `fyi`
   - Keep up to 5 threads in other categories
   - Append `"... and N more"` to the category when threads are trimmed

3. **Body preview removal**: If still over budget, strip `body_preview` from all categories except `needs_response`.

4. **Category collapsing**: As a last resort, collapse low-priority categories into a single count: `"newsletter": { "count": 15, "threads": [] }` — just the count, no thread details.

5. **Hard cap**: The final JSON output is measured. If it exceeds 12,000 characters, the handler trims from the bottom (lowest-priority categories first) until it fits.

### The `digest_truncated` Flag

Set to `true` whenever any truncation rule fires beyond the standard 200-char preview limit. Tells the assistant that the digest is incomplete and it can call `gmail_list_threads` or `gmail_get_thread` for full details on specific threads.

## New Files

```
src/gmail/digest.ts          # handleGmailDigest + classification logic
tests/digest.test.ts         # Unit tests
```

No changes to existing modules. The digest handler imports from `threads.ts` (getMessageBody, stripQuotedText, stripSignature, getHeader, extractEmailAddresses, getAttachments) and `labels.ts` (for label name resolution).

## Registration in index.ts

```typescript
import { handleGmailDigest } from './gmail/digest.js';

server.tool(
  'gmail_digest',
  'Generate a structured digest of recent email activity, grouped by urgency and category (needs response, FYI, waiting, newsletters, etc.). Returns pre-classified threads with summaries.',
  {
    since: z.string().optional()
      .describe('Start time: ISO 8601 or relative ("24h", "2d", "1w"). Default: 24h ago.'),
    until: z.string().optional()
      .describe('End time: ISO 8601. Default: now.'),
    categories: z.array(z.enum([
      'needs_response', 'waiting', 'fyi', 'newsletter',
      'notification', 'meeting', 'commerce',
    ])).optional()
      .describe('Filter to specific categories. Omit for all.'),
    max_threads: z.number().min(1).max(200).optional()
      .describe('Max threads to process (default: 50).'),
    include_body_preview: z.boolean().optional()
      .describe('Include body preview per thread (default: true).'),
    account: accountParam,
  },
  async (params) => {
    try {
      const { account, ...handlerParams } = params;
      const gmail = getGmailClient(account);
      const result = await handleGmailDigest(gmail, handlerParams);
      return { content: [{ type: 'text', text: JSON.stringify(result) }] };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: error instanceof Error ? error.message : 'Unknown error occurred'
          })
        }]
      };
    }
  }
);
```

## Handler Pseudocode

```typescript
// src/gmail/digest.ts

export async function handleGmailDigest(
  gmail: gmail_v1.Gmail,
  params: DigestParams
): Promise<DigestOutput> {
  // 1. Resolve time range
  const { since, until } = resolveTimeRange(params.since, params.until);

  // 2. Get user's email for "from me" detection
  const profile = await gmail.users.getProfile({ userId: 'me' });
  const userEmail = profile.data.emailAddress!;

  // 3. Build Gmail query and fetch thread list
  const query = buildDigestQuery(since, until);
  const threads = await fetchAllThreads(gmail, query, params.max_threads ?? 50);

  // 4. Fetch full thread data (batched, parallel)
  const fullThreads = await fetchThreadDetails(gmail, threads);

  // 5. Classify each thread
  const classified = fullThreads.map(t => classifyThread(t, userEmail));

  // 6. Filter by requested categories (if specified)
  const filtered = params.categories
    ? classified.filter(t => params.categories!.includes(t.category))
    : classified;

  // 7. Group into categories
  const grouped = groupByCategory(filtered);

  // 8. Build output with body previews
  const output = buildDigestOutput(grouped, {
    account: params.account ?? 'default',
    since, until,
    includeBodyPreview: params.include_body_preview ?? true,
  });

  // 9. Apply token budget truncation
  return applyTokenBudget(output, TARGET_BUDGET_CHARS);
}
```

## Relationship to Email Watcher

The digest tool and the email watcher are complementary:

| | Digest (`gmail_digest`) | Watcher (`email-watcher.ts`) |
|---|---|---|
| **Trigger** | On-demand (user asks) | Continuous (background daemon) |
| **Scope** | Time range of threads | Individual new emails |
| **Output** | Structured JSON to AI assistant | Prompt to spawned Claude process |
| **Classification** | Groups threads into categories | Binary: respond or skip |
| **Action** | Read-only summary | May create drafts |
| **Runs as** | MCP tool in server process | Standalone daemon script |

The watcher's planned "digest mode" (mentioned in email-watcher.md future enhancements) could be implemented by having the watcher call `handleGmailDigest` directly, sharing the same classification logic rather than reimplementing it.

## Scopes

No new OAuth scopes required. Uses `gmail.readonly` for thread listing and fetching, same as existing tools.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Too many API calls for large time ranges | Rate limiting, slow response | `max_threads` cap (default 50), batched fetching with concurrency limit of 10 |
| Classification errors | Thread in wrong category | `classification_signal` field enables debugging; Superhuman labels are authoritative when present |
| Large output blows context window | AI assistant struggles to process | Multi-level truncation strategy with 8K char target; `digest_truncated` flag signals incompleteness |
| Slow response time | Poor UX | Parallel thread fetching; metadata-only fetch for threads where body preview is disabled |
| Superhuman labels not yet applied | Misclassification of very recent emails | Document the ~2 min label application delay; heuristics provide reasonable fallback |
| No Superhuman on account | Classification relies entirely on heuristics | Heuristic pass covers all major categories; slightly lower accuracy but functional |

## Testing Plan

### Unit Tests (`tests/digest.test.ts`)

1. **Time range parsing**: Relative strings ("24h", "2d", "1w") convert to correct Gmail queries
2. **Classification — Superhuman labels**: Thread with `AI/Respond` label maps to `needs_response`
3. **Classification — heuristics**: Thread where user is in To, unread, last message not from user maps to `needs_response`
4. **Classification — waiting**: Thread where last message is from user maps to `waiting`
5. **Classification — newsletter**: Thread with `List-Unsubscribe` header maps to `newsletter`
6. **Classification — notification**: Thread from noreply address maps to `notification`
7. **Grouping**: Multiple threads correctly grouped into categories
8. **Token budget**: Output exceeding budget is truncated; `digest_truncated` set to true
9. **Category filtering**: When `categories` param is set, only those categories appear
10. **Body preview**: Preview extracted and truncated to 200 chars
11. **Empty inbox**: Returns valid output with zero threads
12. **Skipped labels**: Threads with `AI/AutoArchived`, `Is Snoozed`, `Muted` excluded by default

### Mock Shape

Same Gmail mock pattern as existing tests:
```typescript
const gmail = {
  users: {
    getProfile: vi.fn().mockResolvedValue({ data: { emailAddress: 'me@test.com' } }),
    threads: { list: vi.fn(), get: vi.fn() },
    labels: { list: vi.fn() },
  },
} as any;
```

## Implementation Order

1. **`src/gmail/digest.ts`** — `resolveTimeRange`, `classifyThread`, `handleGmailDigest`, token budget logic
2. **`tests/digest.test.ts`** — Classification tests first, then integration tests for full handler
3. **Register in `src/index.ts`** — Add tool definition
4. **Manual testing** — Run against real account, verify classification accuracy
5. **Update CLAUDE.md** — Document new tool in architecture section
6. **Update INDEX.md** — Add digest module to file reference

## Future Enhancements

- **Sender grouping**: Within each category, group threads by sender/domain for cleaner presentation
- **Thread importance scoring**: Rank threads within categories by signal strength (multiple unread messages > single, direct email > CC, etc.)
- **Diff digest**: "What's new since my last digest?" — track last digest timestamp per account
- **Calendar correlation**: Cross-reference meeting category threads with `calendar_list_events` to add context ("This meeting is in 2 hours")
- **Custom classification rules**: User-defined rules in config file (similar to watcher's planned `rules` config)
- **Digest caching**: Cache results for a short TTL to avoid re-fetching if the assistant asks follow-up questions about the same digest
