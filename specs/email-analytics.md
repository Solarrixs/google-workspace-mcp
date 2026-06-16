# Spec: Email Analytics & Insights

**Status**: Proposed
**Priority**: P2
**Depends on**: Existing auth + Gmail modules (`src/auth.ts`, `src/gmail/threads.ts`)

## Summary

A new MCP tool (`gmail_analytics`) that computes email activity statistics from recent threads. Answers questions like "How many emails did I get this week?", "Who emails me the most?", "What's my average response time?", and "Show me my busiest email hours."

## Motivation

The MCP server can read threads and draft replies, but has no way to summarize email patterns. Users frequently want a high-level view of their inbox: volume trends, key correspondents, response habits, and time-of-day patterns. This tool turns raw Gmail data into structured analytics that an AI assistant can interpret and present conversationally.

## New MCP Tool

### Definition

```typescript
server.tool(
  'gmail_analytics',
  'Compute email activity statistics: volume, top senders, response time, label distribution, busiest hours. Analyzes recent threads over a configurable time window.',
  {
    period: z.enum(['1d', '3d', '7d', '14d', '30d']).optional()
      .describe('Time window to analyze (default: "7d")'),
    metrics: z.array(
      z.enum(['volume', 'top_senders', 'response_time', 'labels', 'hourly', 'daily'])
    ).optional()
      .describe('Which metrics to compute (default: all). Requesting fewer metrics is faster.'),
    query: z.string().optional()
      .describe('Additional Gmail search filter applied before analysis (e.g., "label:inbox", "from:@company.com")'),
    max_threads: z.number().min(50).max(500).optional()
      .describe('Max threads to sample (default: 200). Higher = more accurate but slower.'),
    account: accountParam,
  },
  async (params) => { ... }
);
```

### Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `period` | enum | `"7d"` | Time window: 1d, 3d, 7d, 14d, 30d |
| `metrics` | string[] | all six | Subset of metrics to compute. Fewer = faster. |
| `query` | string | none | Additional Gmail search query to scope the analysis |
| `max_threads` | number | 200 | Upper bound on threads fetched. Caps API usage. |
| `account` | string | primary | Account alias |

### Response Shape

```typescript
interface AnalyticsResponse {
  period: string;             // e.g., "7d"
  period_start: string;       // ISO 8601
  period_end: string;         // ISO 8601
  threads_analyzed: number;
  messages_analyzed: number;

  volume?: {
    total_received: number;
    total_sent: number;
    daily_average_received: number;
    daily_average_sent: number;
    trend: 'increasing' | 'decreasing' | 'stable';  // vs. previous equivalent period
    by_date: Array<{
      date: string;           // YYYY-MM-DD
      received: number;
      sent: number;
    }>;
  };

  top_senders?: Array<{
    email: string;
    name: string;             // display name from From header, or empty
    count: number;
    percentage: number;       // of total received
  }>;  // top 10, sorted by count desc

  response_time?: {
    median_minutes: number;
    average_minutes: number;
    p90_minutes: number;
    fastest_minutes: number;
    slowest_minutes: number;
    threads_with_reply: number;
    threads_without_reply: number;
    by_sender: Array<{        // top 5 senders by volume, with response stats
      email: string;
      median_minutes: number;
      count: number;
    }>;
  };

  labels?: Array<{
    label: string;
    count: number;
    percentage: number;
  }>;  // sorted by count desc, excludes system category labels

  hourly?: {
    timezone_note: string;    // "Hours are in UTC. Adjust for your local timezone."
    received: number[];       // 24 elements, index 0 = midnight UTC
    sent: number[];           // 24 elements
    busiest_hour_received: number;
    quietest_hour_received: number;
  };

  daily?: {
    received: number[];       // 7 elements, index 0 = Sunday
    sent: number[];
    busiest_day: string;      // "Monday", "Tuesday", etc.
    quietest_day: string;
  };
}
```

### Example Response (abbreviated)

```json
{
  "period": "7d",
  "period_start": "2026-03-07T00:00:00Z",
  "period_end": "2026-03-14T00:00:00Z",
  "threads_analyzed": 142,
  "messages_analyzed": 387,
  "volume": {
    "total_received": 312,
    "total_sent": 75,
    "daily_average_received": 44.6,
    "daily_average_sent": 10.7,
    "trend": "stable",
    "by_date": [
      { "date": "2026-03-07", "received": 41, "sent": 12 },
      { "date": "2026-03-08", "received": 38, "sent": 8 }
    ]
  },
  "top_senders": [
    { "email": "alice@company.com", "name": "Alice Chen", "count": 28, "percentage": 9.0 }
  ],
  "response_time": {
    "median_minutes": 47,
    "average_minutes": 142,
    "p90_minutes": 480,
    "fastest_minutes": 2,
    "slowest_minutes": 2880,
    "threads_with_reply": 53,
    "threads_without_reply": 89
  },
  "hourly": {
    "timezone_note": "Hours are in UTC. Adjust for your local timezone.",
    "received": [2, 1, 0, 0, 0, 3, 8, 22, 45, 51, 38, 33, 28, 31, 27, 19, 12, 5, 3, 2, 1, 0, 0, 1],
    "busiest_hour_received": 9,
    "quietest_hour_received": 2
  }
}
```

## Analytics Computations

### 1. Volume Trends

Count messages where the user is in `To`/`Cc` (received) vs. messages where `From` matches the user's email (sent). Group by date to produce `by_date` array.

**Trend calculation**: Compare current period total to the previous equivalent period (e.g., this week vs. last week). If the previous period has <50% of the data (e.g., account is new), report `"stable"` as default. Thresholds: >15% increase = `"increasing"`, >15% decrease = `"decreasing"`, otherwise `"stable"`.

The user's own email address is obtained from `gmail.users.getProfile({ userId: 'me' })` which returns `emailAddress`.

### 2. Top Senders

Parse `From` header of each received message using the existing `extractEmailAddresses()` and raw header for display name. Aggregate by email address. Return top 10 sorted by count descending, with percentage of total received.

### 3. Response Time

For each thread with multiple messages:
1. Find the last inbound message (not from the user)
2. Find the next outbound message (from the user) after it
3. The delta is the response time for that thread

Only threads where the user actually replied contribute to response time stats. Report median, mean, p90, min, max. Also break down by top 5 senders to show per-correspondent response patterns.

Edge cases:
- Threads where the user never replied: counted as `threads_without_reply`, not included in time calculations
- Threads the user initiated: skip for response time (no inbound message preceded the user's message)
- Multiple reply pairs in a thread: use the most recent pair only

### 4. Label Distribution

Count label occurrences across all analyzed messages. Filter out `CATEGORY_*` system labels (same filtering as `handleListThreads`). Include Superhuman labels if present. Useful for questions like "What percentage of my email is marketing?"

### 5. Hourly Distribution

Bucket messages by hour of day (UTC) based on `internalDate`. Produces two 24-element arrays (received, sent). Identifies busiest and quietest hours.

UTC note: Gmail `internalDate` is always UTC. The response includes a `timezone_note` string so the AI assistant can advise the user to mentally adjust, or the user can state their timezone and the assistant can shift the array.

### 6. Daily Distribution

Bucket messages by day of week (Sunday=0 through Saturday=6) based on `internalDate`. Identifies busiest and quietest days by name.

## Data Collection Strategy

### API Calls

The Gmail API does not have a built-in analytics endpoint. All stats must be computed client-side from message metadata.

**Primary approach**: Use `threads.list` + `threads.get` with `format: 'metadata'`.

```
Step 1: threads.list(q: "newer_than:{period}", maxResults: max_threads)
        → returns thread IDs + snippets
        → paginate if needed (multiple list calls)

Step 2: threads.get(id, format: 'metadata', metadataHeaders: ['From', 'To', 'Cc', 'Date', 'Message-ID'])
        → returns all messages in each thread with headers + labelIds + internalDate
        → one API call per thread
```

**Why `metadata` format, not `full`**: Analytics needs headers and timestamps, not message bodies. `metadata` format is significantly smaller — ~1KB per message vs. ~50KB for `full`. This reduces bandwidth and parsing time by ~50x.

**Why not `messages.list`**: Threads group conversations naturally. Response time computation requires knowing which messages belong to the same conversation. Using `threads.get` returns messages pre-grouped.

### API Cost Estimate

| Period | Typical threads | API calls | Gmail quota units |
|---|---|---|---|
| 1d | ~30 | 1 list + 30 get = 31 | ~160 |
| 7d | ~150 | 2 list + 150 get = 152 | ~760 |
| 14d | ~300 (capped at 200) | 3 list + 200 get = 203 | ~1015 |
| 30d | ~600 (capped at 200) | 3 list + 200 get = 203 | ~1015 |

Gmail API quota: 250 quota units/second, 1 billion/day. `threads.list` = 5 units, `threads.get` = 5 units each. Even the heaviest analytics call uses <1100 units total — well within limits.

### Concurrency

Fetch threads in parallel batches of 20 (same pattern as `handleListThreads` uses `Promise.all`). With 20 concurrent gets, a 200-thread analysis completes in ~10 serial rounds, roughly 5-10 seconds.

### User Email Detection

To classify messages as sent vs. received, the handler needs the user's email. Fetch once via `gmail.users.getProfile({ userId: 'me' })` at the start of the handler. Cache the result for the duration of the call.

## Caching Strategy

Analytics over a fixed period (e.g., "last 7 days") produces deterministic results for a short window. Re-fetching 200 threads every time the user asks "who emails me the most?" is wasteful.

### In-Memory Cache

```typescript
interface CacheEntry {
  key: string;          // `${account}:${period}:${query}:${max_threads}`
  timestamp: number;    // Date.now() when cached
  data: AnalyticsResponse;
}

const analyticsCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
```

**Cache behavior**:
- **Hit**: If a cache entry exists with the same key and is <5 minutes old, return it immediately. If the request asks for a subset of metrics that are all present in the cached response, extract and return just those metrics.
- **Miss**: Fetch from Gmail API, compute all requested metrics, cache the result.
- **Eviction**: Entries older than 5 minutes are evicted on next access. Map is capped at 20 entries (LRU eviction if exceeded).
- **No persistence**: Cache lives only in server process memory. Restarting the MCP server clears it. This is intentional — analytics data is cheap to recompute and should reflect recent inbox state.

### Why 5 Minutes

- Short enough to reflect inbox changes (new emails arrive)
- Long enough that a multi-turn conversation ("Show me top senders" → "What about response time?") reuses the same data without re-fetching
- Aligns with typical MCP session interaction pace

### Selective Metric Computation

When `metrics` is provided, only compute the requested metrics. This saves CPU but not API calls — the thread data fetch is the same regardless. The cache stores all computed metrics; a follow-up request for different metrics from the same period triggers a partial recompute using cached thread data (not a full re-fetch).

To support this, the cache also stores the raw processed message data:

```typescript
interface CacheEntry {
  key: string;
  timestamp: number;
  data: AnalyticsResponse;
  messages: ProcessedMessage[];   // raw data for recomputation
  computedMetrics: Set<string>;   // which metrics are already computed
}
```

If a new request asks for metrics not yet computed but the thread data is cached, compute the missing metrics from `messages` without hitting the API.

## Module Location

**New file**: `src/gmail/analytics.ts`

### Exports

```typescript
// Types
export interface AnalyticsParams { ... }
export interface AnalyticsResponse { ... }

// Handler (called from src/index.ts)
export async function handleGmailAnalytics(
  gmail: gmail_v1.Gmail,
  params: AnalyticsParams
): Promise<AnalyticsResponse>;

// Internal (exported for testing)
export function classifyMessage(msg: ProcessedMessage, userEmail: string): 'sent' | 'received';
export function computeVolume(messages: ProcessedMessage[], userEmail: string, periodDays: number): VolumeStats;
export function computeTopSenders(messages: ProcessedMessage[], userEmail: string): SenderStats[];
export function computeResponseTime(threads: ProcessedThread[], userEmail: string): ResponseTimeStats;
export function computeLabelDistribution(messages: ProcessedMessage[]): LabelStats[];
export function computeHourlyDistribution(messages: ProcessedMessage[], userEmail: string): HourlyStats;
export function computeDailyDistribution(messages: ProcessedMessage[], userEmail: string): DailyStats;
```

### Internal Types

```typescript
interface ProcessedMessage {
  id: string;
  threadId: string;
  from: string;         // raw From header
  fromEmail: string;    // extracted email address
  fromName: string;     // extracted display name
  to: string;
  cc: string;
  date: Date;           // parsed from internalDate
  labelIds: string[];
}

interface ProcessedThread {
  id: string;
  messages: ProcessedMessage[];
}
```

### Dependencies

```
src/gmail/analytics.ts
  ├── imports extractEmailAddresses, getHeader from './threads.js'
  ├── imports compact from '../utils.js'
  └── uses gmail_v1 types from 'googleapis'
```

No new npm dependencies required.

## Implementation Plan

### 1. Core data fetching (`src/gmail/analytics.ts`)

- `fetchThreadsForAnalytics(gmail, period, query, maxThreads)` — paginated `threads.list` + batched `threads.get` with `format: 'metadata'`
- `processThread(thread)` — extract `ProcessedMessage` from each message in a thread
- User email detection via `getProfile`

### 2. Metric computation functions

Each metric is a pure function over `ProcessedMessage[]` or `ProcessedThread[]`:
- `computeVolume` — group by date, count sent/received, compute trend
- `computeTopSenders` — aggregate by sender email, sort, take top 10
- `computeResponseTime` — pair inbound/outbound messages per thread, compute deltas
- `computeLabelDistribution` — count labels, filter system categories
- `computeHourlyDistribution` — bucket by UTC hour
- `computeDailyDistribution` — bucket by day of week

### 3. Caching layer

- `Map<string, CacheEntry>` with TTL check and LRU eviction
- Partial metric recomputation from cached message data

### 4. Handler and registration

- `handleGmailAnalytics` — orchestrates fetch, cache, compute, assemble response
- Register in `src/index.ts` as `gmail_analytics` tool with Zod schema

### 5. Tests (`tests/analytics.test.ts`)

Follow existing test patterns — mock Gmail client, call handler directly.

Test cases:
- Volume counting with mixed sent/received messages
- Top senders aggregation and ranking
- Response time with various thread structures (no reply, single reply, multiple exchanges)
- Response time edge cases (user-initiated thread, single-message thread)
- Label distribution filtering
- Hourly/daily bucketing across UTC day boundaries
- Cache hit returns same data without re-fetching
- Cache miss after TTL expiry triggers re-fetch
- Partial metric requests work correctly
- Empty inbox (no threads) returns zeroed stats without errors
- `max_threads` cap is respected
- `query` parameter is forwarded to `threads.list`

### 6. Documentation

- Add `gmail_analytics` to tool list in `CLAUDE.md`
- Update `INDEX.md` with `src/gmail/analytics.ts` exports

## Implementation Order

1. `src/gmail/analytics.ts` — types, data fetching, metric functions, cache, handler
2. `src/index.ts` — register `gmail_analytics` tool
3. `tests/analytics.test.ts` — unit tests for all metric functions + handler
4. Update `CLAUDE.md` and `INDEX.md`

## Scopes

No new OAuth scopes required. `gmail.readonly` covers `threads.list`, `threads.get`, and `users.getProfile`.

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Slow for large mailboxes | 10+ second response time | `max_threads` cap (default 200), parallel fetches, caching |
| Rate limiting on batch gets | 429 errors | Batch size of 20 is well within 250 units/s quota |
| Inaccurate response time for complex threads | Misleading stats | Use most recent inbound/outbound pair; document limitations |
| UTC-only hour data | User confusion about "busiest hour" | Include `timezone_note` in response; AI assistant can adjust |
| Cache serves stale data | User sees outdated stats | 5-minute TTL is short; user can re-invoke after TTL expires |
| Memory usage for cached messages | Process bloat | Cap cache at 20 entries; `ProcessedMessage` is lightweight (~200 bytes each) |
| Sampling bias from `max_threads` cap | Stats don't represent full period | Document that results are sampled; increase `max_threads` for accuracy |

## Out of Scope for v1

- Historical trend comparisons beyond one previous period (e.g., month-over-month charts)
- Attachment size analytics (would require `full` format, too expensive)
- Thread categorization / topic clustering (would require body text + NLP)
- Sentiment analysis on email content
- Per-recipient response time (only per-sender)
- Export to CSV/JSON file
- Real-time streaming updates
- Calendar cross-reference ("emails during meetings")
