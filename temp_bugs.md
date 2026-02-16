# BUGS.md

Known bugs and unfinished implementations, prioritized by severity. Each entry includes enough context for an agent to locate and fix the issue without prior codebase knowledge.

**Discovery method:** Parallel code audits by 5 specialized agents — each read source files line-by-line looking for missing error handling, unsafe operations, logic errors, edge cases, RFC violations, and test coverage gaps. Previous Claude instances didn't catch these because they were focused on feature implementation, not adversarial code review.

---

## Critical (will cause runtime failures or data loss)

### BUG-001: Draft update silently deletes body content
**File:** `src/gmail/drafts.ts`
**Lines:** 207-216 (body extraction), 88 (content type)

`handleUpdateDraft()` reads the existing draft body to preserve fields the user didn't change. It searches for `text/plain` MIME parts at line 212. But `buildRawEmail()` creates drafts with `Content-Type: text/html` at line 88. The existing draft has no `text/plain` part, so `existingBody` stays as empty string (line 207). When the user updates only the subject, the body is silently replaced with an empty HTML div.

**Triggers:** Any call to `gmail_update_draft` without providing the `body` parameter.
**Impact:** Complete loss of draft body content. User sees blank email.
**Likelihood:** Very high — happens on every partial update.

**Status: FIXED**

---

### BUG-002: RFC 2822 header injection
**File:** `src/gmail/drafts.ts`
**Lines:** 84-86 (From/To/Subject), 92-93 (Cc/Bcc), 95-99 (In-Reply-To/References)

All header values are interpolated directly into RFC 2822 output with no sanitization. The headers are joined with `\r\n` at line 105. If any input contains `\r\n`, it injects additional headers into the raw email.

Example: `subject: "Hello\r\nBcc: attacker@evil.com"` produces:
```
Subject: Hello
Bcc: attacker@evil.com
```

**Triggers:** Any `to`, `subject`, `cc`, `bcc`, or `in_reply_to` value containing `\r\n`.
**Impact:** Arbitrary header injection — hidden recipients, spoofed headers, body manipulation.
**Likelihood:** Medium-high. Exploitable if inputs come from untrusted sources.

**Status: FIXED**

---

### BUG-003: No error handling on any API call
**File:** `src/index.ts`
**Lines:** All 11 tool registrations (25-38, 40-52, 54-71, 73-91, 93-104, 106-117, 119-128, 132-146, 148-165, 167-185, 187-199)

Every tool handler follows the same pattern:
```typescript
async (params) => {
  const client = getGmailClient(); // or getCalendarClient()
  const result = await handler(client, params);
  return { content: [{ type: 'text', text: JSON.stringify(result) }] };
}
```

No try-catch anywhere. API errors (401 auth expired, 404 not found, 429 rate limit, network timeout) propagate as unhandled exceptions. The MCP server returns cryptic stack traces instead of user-friendly error messages.

**Triggers:** Any API failure — network down, token expired, invalid resource ID, quota exceeded.
**Impact:** Server crashes or returns unhelpful errors. No graceful degradation.
**Likelihood:** Very high — API failures are routine in production.

**Status: FIXED**

---

### BUG-004: Token file corruption crashes server on startup
**File:** `src/auth.ts`
**Line:** 33

```typescript
const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
```

No try-catch. If `tokens.json` contains invalid JSON (partial write from crash, disk corruption, manual edit), the server crashes immediately with `SyntaxError` and cannot start. No recovery path — user must manually delete or fix the file.

**Triggers:** Corrupted `~/.config/google-workspace-mcp/tokens.json`.
**Impact:** Server won't start. No error message pointing to the corrupt file.
**Likelihood:** Medium-high. File corruption is common from crashes during token refresh writes (see BUG-005).

**Status: FIXED**

---

### BUG-005: Race condition in token refresh
**File:** `src/auth.ts`
**Lines:** 60-89 (getAuthClient), 76-86 (tokens event handler), 92-96 (factory functions)

`getAuthClient()` creates a **new** `OAuth2Client` on every call. `getGmailClient()` (line 92) and `getCalendarClient()` (line 95) each call `getAuthClient()`, creating separate clients. Each client registers its own `tokens` event handler (line 76) that writes to the same file (line 85).

When multiple clients refresh tokens simultaneously (common when access token expires during concurrent requests), multiple handlers fire and write to the same `tokens.json` file. Each handler's closure captures `tokens` from creation time (line 61), so later writes can overwrite newer values with stale data.

**Triggers:** Concurrent Gmail + Calendar API calls when access token is expired (every ~1 hour).
**Impact:** Token file corruption (interleaved writes), lost refresh tokens (stale closure overwrites), cascading into BUG-004 on next startup.
**Likelihood:** High. Normal operation creates multiple clients; token expiry is routine.

**Status: FIXED**

---

### BUG-006: N+1 query in handleListDrafts()
**File:** `src/gmail/drafts.ts`
**Lines:** 292-305

```typescript
const res = await gmail.users.drafts.list({ userId: 'me', maxResults: params.max_results || 25 });
const drafts = res.data.drafts || [];
for (const draft of drafts) {
  const detail = await gmail.users.drafts.get({ userId: 'me', id: draft.id!, format: 'full' });
  // ...extract headers...
}
```

Lists drafts (1 API call), then fetches each draft individually in a sequential loop (N API calls). With default 25 drafts, that's 26 sequential API calls. At ~100-200ms per call, total latency is 2.5-5 seconds. Also burns through API quota rapidly.

**Triggers:** Every call to `gmail_list_drafts`.
**Impact:** Extremely slow responses, potential rate limiting.
**Likelihood:** Certain — happens on every invocation.

**Status: FIXED**

---

## High Severity (incorrect behavior or security risk)

### BUG-007: XSS in linkify()
**File:** `src/gmail/drafts.ts`
**Lines:** 29-36

```typescript
function linkify(html: string): string {
  return html.replace(
    /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g,
    '<a href="$2" style="color:#1a73e8;text-decoration:none">$1</a>'
  );
}
```

The captured URL (`$2`) is inserted into the `href` attribute without escaping double quotes. Input like `[x](https://a.com" onclick="alert(1))` breaks out of the attribute.

**Triggers:** Markdown link with `"` in the URL portion.
**Impact:** Attribute injection in HTML email. Gmail's CSP may mitigate execution, but the HTML is still malformed.
**Likelihood:** Medium. Requires crafted input, but the function processes user-provided body text.

**Status: FIXED**

---

### BUG-008: Non-ASCII headers not RFC 2047 encoded
**File:** `src/gmail/drafts.ts`
**Lines:** 84-86

```typescript
`From: ${params.from}`,
`To: ${params.to}`,
`Subject: ${params.subject}`,
```

RFC 2822 headers must be ASCII-only. Non-ASCII characters (accented letters, CJK, emoji) in subject lines or display names should be encoded per RFC 2047 (e.g., `=?UTF-8?B?...?=`). Raw UTF-8 bytes in headers may be rejected by strict mail servers or garbled by intermediate systems.

**Triggers:** Subject or display name with non-ASCII characters (e.g., "Re: café meeting", "日本語のメール").
**Impact:** Malformed headers, potential rejection or garbled display.
**Likelihood:** High for international users.

**Status: FIXED**

---

### BUG-009: getProfile() fallback to 'me' is invalid
**File:** `src/gmail/drafts.ts`
**Lines:** 113-114 (handleCreateDraft), 218-219 (handleUpdateDraft)

```typescript
const profile = await gmail.users.getProfile({ userId: 'me' });
const fromEmail = profile.data.emailAddress || 'me';
```

If `emailAddress` is null/undefined, the From header becomes `From: me`, which is not a valid RFC 2822 address. Also, `getProfile()` has no try-catch — if it throws (network error, auth revoked), the entire draft operation fails with no helpful error.

**Triggers:** `getProfile()` API failure or missing `emailAddress` in response.
**Impact:** Invalid From header or crash.
**Likelihood:** Low-medium. The API is usually reliable, but network issues happen.

**Status: FIXED**

---

### BUG-010: handleUpdateEvent() allows start > end
**File:** `src/calendar/events.ts`
**Lines:** 107-108

```typescript
if (params.start !== undefined) update.start = parseDateTime(params.start);
if (params.end !== undefined) update.end = parseDateTime(params.end);
```

PATCH sends only changed fields. Updating `start` without `end` (or vice versa) can create events where end is before start. The Google Calendar API accepts this silently, creating an invalid calendar entry.

Example: Event is 2pm-3pm. Update `start` to 4pm. Result: event from 4pm-3pm.

**Triggers:** Updating only `start` or only `end` on an existing event.
**Impact:** Invalid event data on user's calendar.
**Likelihood:** Medium-high. Common in rescheduling workflows.

**Status: FIXED**

---

### BUG-011: Partial env vars give unhelpful error
**File:** `src/auth.ts`
**Lines:** 38-52

```typescript
const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

if (clientId && clientSecret && refreshToken) {
  return { ... };
}

throw new Error(
  `No credentials found. Run 'npm run setup' first, or set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.`
);
```

If 1 or 2 of 3 env vars are set, the error message says "No credentials found" without indicating which specific variables are missing vs. present.

**Triggers:** Setting only some env vars (e.g., forgot `GOOGLE_REFRESH_TOKEN`).
**Impact:** Frustrating debugging experience — user doesn't know which var is missing.
**Likelihood:** Medium. Common during initial setup.

**Status: FIXED**

---

## Medium Severity (edge cases producing wrong results)

### BUG-012: getMessageBody() overwrites on multiple text/plain parts
**File:** `src/gmail/threads.ts`
**Lines:** 65-66

```typescript
if (part.mimeType === 'text/plain' && part.body?.data) {
  text = decodeBase64Url(part.body.data);  // overwrites, doesn't append
```

Uses `=` instead of `+=`. If a multipart message has multiple `text/plain` parts, only the last one is kept. Earlier parts are silently discarded.

**Triggers:** Multipart/mixed emails with multiple text parts (forwarded messages, some automated systems).
**Impact:** Lost email content — only last text part shown.
**Likelihood:** Medium. Uncommon but does occur with forwarded or automated messages.

**Status: FIXED**

---

### BUG-013: stripHtmlTags() misses script/style content
**File:** `src/gmail/threads.ts`
**Lines:** 35-46

```typescript
.replace(/<[^>]*>/g, '')  // removes tags but NOT their contents
```

`<script>alert(1)</script>` becomes `alert(1)`. `<style>.class{color:red}</style>` becomes `.class{color:red}`. Also missing entity decoding for `&mdash;`, `&#8212;`, `&#x2014;`, `&copy;`, etc. — only 7 hardcoded entities are handled (lines 38-43).

**Triggers:** HTML emails with script/style tags (marketing emails, tracking pixels) or named/numeric entities beyond the 7 hardcoded ones.
**Impact:** Script content leaks into plaintext. Undecoded entities show as raw codes.
**Likelihood:** High for entity issues (em dashes, curly quotes are extremely common in emails).

**Status: FIXED**

---

### BUG-014: Date parsing crash on malformed internalDate
**File:** `src/gmail/threads.ts`
**Lines:** 249-251

```typescript
const lastDate = lastMsg?.internalDate
  ? new Date(parseInt(lastMsg.internalDate, 10)).toISOString()
  : '';
```

If `internalDate` is non-numeric: `parseInt('abc', 10)` → `NaN` → `new Date(NaN)` → `Invalid Date` → `.toISOString()` throws `RangeError: Invalid time value`. Crashes the entire thread list operation.

**Triggers:** Malformed `internalDate` from Gmail API (corrupted email, API bug).
**Impact:** Runtime crash — entire thread listing fails.
**Likelihood:** Low but catastrophic when it occurs.

**Status: FIXED**

---

### BUG-015: parseDateTime() accepts garbage input
**File:** `src/calendar/events.ts`
**Lines:** 53-59

```typescript
function parseDateTime(iso: string): calendar_v3.Schema$EventDateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { date: iso };
  }
  return { dateTime: iso };
}
```

No validation. `"not-a-date"`, `"2024-13-99"`, `"tomorrow"` all pass through as `{ dateTime: "..." }`. The Calendar API rejects them later with cryptic errors.

**Triggers:** Any non-ISO-8601 string passed as start/end time.
**Impact:** Unhelpful API error instead of early validation message.
**Likelihood:** High. Users frequently provide informal date strings.

**Status: FIXED**

---

### BUG-016: || vs ?? in label type fallback
**File:** `src/gmail/labels.ts`
**Line:** 8

```typescript
type: label.type?.toLowerCase() || 'user',
```

The `||` operator treats empty string `""` as falsy, falling back to `'user'`. Should use `??` (nullish coalescing) to only fall back on `null`/`undefined`.

**Triggers:** API returning a label with `type: ""`.
**Impact:** Empty string silently replaced with `'user'`.
**Likelihood:** Low. Gmail API typically returns `"system"` or `"user"`.

**Status: FIXED**

---

### BUG-017: Unicode truncation with substring()
**File:** `src/gmail/threads.ts`
**Lines:** 260 (snippet), 313 (body)

```typescript
snippet = snippet.substring(0, 150) + '...';
bodyText = bodyText.substring(0, 4000) + '\n\n[truncated]';
```

JavaScript's `substring()` operates on UTF-16 code units. Surrogate pairs (emoji like 💌, characters beyond U+FFFF) are two code units. Truncating mid-pair produces `�` (replacement character) at the boundary.

**Triggers:** Emoji or non-BMP characters near the 150-char or 4000-char truncation boundary.
**Impact:** Corrupted character at truncation point.
**Likelihood:** Medium-high. Emoji in emails are extremely common.

**Status: FIXED**

---

### BUG-018: stripQuotedText() false positives
**File:** `src/gmail/threads.ts`
**Line:** 92

```typescript
/^On .+wrote:\s*$/m,
```

Matches any line starting with "On " and ending with "wrote:". False positives include: "On reflection, she wrote:", "On this topic, the author wrote:", or any prose matching the pattern. Everything after the match is discarded.

**Triggers:** Legitimate email text matching `On ... wrote:` pattern.
**Impact:** Silently strips real email content.
**Likelihood:** Medium. Academic and professional emails discussing writing/authorship are vulnerable.

**Status: FIXED**

---

### BUG-019: stripSignature() false positives
**File:** `src/gmail/threads.ts`
**Lines:** 127 (underscore delimiter), 176-187 (sign-off heuristic)

Two distinct false positive vectors:

1. `__\n` (line 127) matches markdown horizontal rules, Python dunder references, or any line that is just two underscores. Everything after is stripped.

2. Sign-off heuristic (lines 176-187) strips content after "Best,", "Thanks,", "Regards,", etc. if followed by ≤5 lines under 80 chars each. This catches short lists or bullet points after polite phrases:
```
Thanks, here are the items:
- Item 1
- Item 2
- Item 3
```
All three items get stripped.

**Triggers:** Emails with `__` separators or short content after common sign-off words.
**Impact:** Silently removes legitimate email content.
**Likelihood:** Medium. Developer emails (markdown, Python) and short follow-up lists are affected.

**Status: FIXED**

---

### BUG-020: getAttachments() doesn't distinguish inline vs attachment
**File:** `src/gmail/threads.ts`
**Lines:** 203-210

```typescript
if (part.filename && part.filename.length > 0) {
  attachments.push({ filename: part.filename, ... });
}
```

Checks only `part.filename` existence. Inline images (embedded logos, signature images) have filenames but `Content-Disposition: inline`. The code ignores the `Content-Disposition` header entirely.

**Triggers:** Any HTML email with embedded images (logos, signature images, inline graphics).
**Impact:** Inline images listed as downloadable attachments, cluttering the attachment list.
**Likelihood:** Very high. Most formatted emails have inline images.

**Status: FIXED**

---

### BUG-021: List detection breaks on blank lines
**File:** `src/gmail/drafts.ts`
**Lines:** 42, 14-20

```typescript
const blocks = escaped.split(/\n\n+/);  // line 42

function isNumberedListBlock(lines: string[]): boolean {
  return lines.length > 0 && lines.every((l) => /^\d+[\.\)]\s/.test(l));  // line 15
}
```

Line 42 splits on double newlines, then each block is split on single newlines. A list with blank lines between items:
```
1. First item

2. Second item
```
Gets split into two separate blocks: `["1. First item"]` and `["2. Second item"]`. Each is detected independently, producing two separate `<ol>` lists instead of one.

**Triggers:** Numbered or bullet lists with blank lines between items.
**Impact:** Broken list formatting in HTML email.
**Likelihood:** High. Users commonly add spacing between list items.

**Status: FIXED**

---

### BUG-022: decodeBase64Url() no error handling
**File:** `src/gmail/threads.ts`
**Lines:** 10-12

```typescript
export function decodeBase64Url(data: string): string {
  return Buffer.from(data, 'base64url').toString('utf-8');
}
```

No try-catch. Malformed base64 input either silently produces garbage bytes or throws depending on Node.js version. Called from multiple locations (`getMessageBody`, `handleUpdateDraft`), so a failure propagates up and crashes the entire operation.

**Triggers:** Corrupted or truncated base64 data from Gmail API.
**Impact:** Silent data corruption or runtime crash.
**Likelihood:** Low but unrecoverable when it occurs.

**Status: FIXED**

---

### BUG-023: Label filtering keeps unwanted system labels
**File:** `src/gmail/threads.ts`
**Lines:** 264-267

```typescript
const KEEP_LABELS = new Set(['INBOX', 'UNREAD', 'SENT', 'IMPORTANT', 'STARRED', 'DRAFT']);
const filteredLabels = labels.filter(
  (l) => KEEP_LABELS.has(l) || !l.startsWith('CATEGORY_')
);
```

Logic: keep if in KEEP_LABELS set OR if it doesn't start with `CATEGORY_`. This passes through system labels like `CHAT`, `SPAM`, `TRASH` (they don't start with `CATEGORY_`), plus all user labels. Only `CATEGORY_*` labels are removed. The intent appears to be showing only "useful" labels, but the filter is too permissive.

**Triggers:** Emails in Spam, Trash, or Chat.
**Impact:** Noisy label lists with irrelevant system labels.
**Likelihood:** High for any email in spam/trash.

**Status: FIXED**

---

## Low Severity

### BUG-024: escapeHtml() missing quote escaping
**File:** `src/gmail/drafts.ts`
**Lines:** 22-27

Escapes `&`, `<`, `>` but not `"` (`&quot;`) or `'` (`&#39;`). Currently safe because escaped text goes into element content, not attributes. But a latent vulnerability if code is extended to use escaped text in attribute contexts.

**Status: FIXED**

### BUG-025: Missing Date header in RFC 2822 output
**File:** `src/gmail/drafts.ts`
**Lines:** 83-100

RFC 2822 Section 3.6 requires a `Date:` header. Gmail likely adds it on send, but the draft is technically non-compliant.

**Status: FIXED**

### BUG-026: HOME/USERPROFILE not set falls back to literal '~'
**File:** `src/auth.ts`
**Lines:** 6-10

In containerized environments where neither `HOME` nor `USERPROFILE` is set, `path.join('~', '.config', ...)` creates a literal `~` directory in the working directory instead of the home directory.

**Status: FIXED**

### BUG-027: macOS-only `open` command in setup
**File:** `scripts/setup-oauth.ts`
**Line:** 66

Uses `exec('open "${authUrl}"')` which only works on macOS. Fails silently on Windows (`start`) and Linux (`xdg-open`). Script still prints the URL, so user can copy-paste.

**Status: FIXED**

### BUG-028: Non-null assertions on API response IDs
**File:** `src/gmail/threads.ts` (line 239: `t.id!`), `src/gmail/drafts.ts` (line 303: `draft.id!`)

TypeScript non-null assertions assume the API always returns `id` fields. If it doesn't (API bug, schema change), `undefined` propagates and causes crashes downstream.

**Status: FIXED**

### BUG-029: formatEvent() attendee email could be undefined
**File:** `src/calendar/events.ts`
**Lines:** 43-46

`a.email` in the attendee mapping could be `undefined` per the Calendar API schema. Returns `{ email: undefined }` instead of filtering or providing a default.

**Status: FIXED**

### BUG-030: No email validation on to/cc/bcc
**File:** `src/index.ts`
**Lines:** 58, 63-64, 78, 83-84

Zod schemas accept any string for email fields. Invalid emails pass through to the Gmail API, which rejects them with cryptic errors instead of early validation.

**Status: FIXED**

### BUG-031: handleListLabels() no pagination
**File:** `src/gmail/labels.ts`
**Lines:** 3-12

Only returns first page of labels. Users with extensive label systems (rare) won't see all labels.

**Status: FIXED**

### BUG-032: Setup script timeout race condition
**File:** `scripts/setup-oauth.ts`
**Lines:** 89, 97-101

If OAuth succeeds just before the 2-minute timeout fires, the server is already closed but the timeout still rejects, potentially causing an unhandled promise rejection.

**Status: FIXED**

---

## Test Coverage Gaps

These modules/functions have **zero test coverage**:

| Module | Untested Functions |
|--------|--------------------|
| `src/auth.ts` | `loadTokens()`, `saveTokens()`, `getAuthClient()`, `getGmailClient()`, `getCalendarClient()` — entire module |
| `src/gmail/drafts.ts` | `plainTextToHtml()`, `escapeHtml()`, `linkify()`, `isNumberedListBlock()`, `isBulletListBlock()`, `handleUpdateDraft()`, `handleListDrafts()`, `handleDeleteDraft()` |
| `src/index.ts` | All tool registrations, Zod schema validation, MCP server setup |

Additionally, **no error-path tests exist** across the entire codebase. All tests cover happy paths only.

---

## Post-Fix Audit Findings (Feb 16, 2026)

### Test Status
