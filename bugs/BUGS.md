# Remaining Bugs

Unfixed bugs consolidated from bug reports, calendar audit, and security audit. Each entry has enough context for an agent to locate and fix the issue without prior codebase knowledge.

**Last updated:** 2026-02-20

---

## Critical

### BUG-047: Refresh Token Replay Attacks
**File:** `src/auth.ts`, lines 89-100
**Severity:** Critical

**Root cause:** No token binding or replay protection. A stolen refresh token can be used from any machine with the matching `client_id`/`client_secret` to mint new access tokens indefinitely.

```typescript
// Attacker's code:
const stolenRefreshToken = "...";
const client = new OAuth2Client(client_id, client_secret);
client.setCredentials({ refresh_token: stolenRefreshToken });
const tokens = await client.refreshAccessToken(); // Works from anywhere
```

**Impact:** Permanent account compromise until the user manually revokes the token at https://myaccount.google.com/permissions.

**Suggested fix:** This is inherent to OAuth2 refresh tokens. Mitigations:
1. Encrypt tokens at rest in `tokens.json` (derive key from machine-specific secret)
2. Set restrictive file permissions (`0600`) on token file at write time
3. Optionally bind tokens to a machine fingerprint and warn on mismatch

---

## High

### BUG-036: Quote Detection Bypass via HTML Tags
**File:** `src/gmail/threads.ts`, lines 91-94
**Severity:** High

**Root cause:** `stripQuotedText()` uses rigid regex patterns that are trivially bypassed by HTML formatting in the raw text.

**Confirmed bypasses:**
- `<br>On Feb 16 wrote:<br>` (HTML line breaks)
- `On Feb 16&nbsp;wrote:` (non-breaking space entity)
- `On Feb 16 wrоte:` (Cyrillic 'о' in "wrote")
- Styled text, extra whitespace between tokens

**Impact:** Quoted/phishing content persists through email threads when it should be stripped.

**Suggested fix:** Normalize whitespace and strip residual HTML entities/tags before applying quote regexes. Consider also matching on structural patterns (indentation, `>` prefixes) rather than only text patterns.

---

### BUG-037: Signature Detection Bypass
**File:** `src/gmail/threads.ts`, lines 127-128, 133-137
**Severity:** High

**Root cause:** `stripSignature()` only recognizes a hardcoded set of delimiters (`-- `, `—`, `__`). Many real-world signatures use other delimiters.

**Confirmed bypasses:**
- `***`, `===`, `+++`, `###` (common horizontal rules)
- Emoji delimiters: `✆\n`, `📧\n`
- Unicode dash variants (em dash, en dash, horizontal bar)

**Impact:** Unwanted signature/footer content (including phishing footers) persists across all replies.

**Suggested fix:** Expand delimiter set to include common horizontal rule characters. Consider a scoring heuristic that combines delimiter presence, line count, and content patterns rather than relying solely on exact delimiter matches.

---

### BUG-038: Email Extraction Regex Failures
**File:** `src/gmail/threads.ts`, lines 219-221
**Severity:** High

**Root cause:** `extractEmailAddresses()` regex is too restrictive for internationalized addresses and doesn't detect homograph attacks.

**Confirmed failures:**
- `tést@example.com` — accented chars rejected (valid per RFC 6531)
- `admin@ɡoogle.com` — Cyrillic 'ɡ' accepted without warning (homograph attack)
- Injection payloads in angle brackets can break the regex

**Impact:** Legitimate internationalized emails are silently dropped; malicious homograph addresses pass through undetected.

**Suggested fix:**
1. Widen the local-part character class to accept Unicode letters
2. Add a homograph detection warning for mixed-script domains (Latin + Cyrillic, etc.)
3. Normalize Unicode (NFC) before extraction

---

## Medium

### BUG-042: Symlink Attack on Token Write
**File:** `src/auth.ts`, lines 69-72
**Severity:** Medium

**Root cause:** `saveTokens()` writes to `TOKEN_PATH` without checking if the path (or any ancestor) is a symlink. An attacker with local access can replace `~/.config/google-workspace-mcp/` or `tokens.json` with a symlink pointing elsewhere.

**Impact:** Arbitrary file overwrite — tokens written to attacker-controlled location, or attacker overwrites an unrelated file with token JSON.

**Suggested fix:** Use `fs.lstat()` to check that `TOKEN_PATH` is a regular file (not a symlink) before writing. Alternatively, use `O_NOFOLLOW` flag when opening the file.

---

### BUG-043: TOCTOU Race Condition in Token Write
**File:** `src/auth.ts`, lines 69-72
**Severity:** Medium

**Root cause:** Time-of-check to time-of-use race between the directory existence check (`mkdirSync`) and the file write (`writeFileSync`). An attacker can create a symlink in the gap.

**Impact:** Same as BUG-042 — token theft or arbitrary file write.

**Note:** BUG-042 and BUG-043 are closely related and should be fixed together. The atomic write (tmp + rename) added for legacy migration partially mitigates this for that code path, but `saveTokens()` itself still does a direct write.

**Suggested fix:** Apply the same atomic write pattern (write to tmp file, then `rename()`) to all token writes, combined with symlink checks.

---

### BUG-050: Homograph/Unicode Spoofing
**File:** Email parsing and validation (multiple locations)
**Severity:** Medium

**Root cause:** No Unicode normalization or mixed-script detection anywhere in the codebase.

**Confirmed attacks:**
- `admin@ɡoogle.com` (Cyrillic 'ɡ' indistinguishable from Latin 'g')
- `security@paypa1.com` (digit '1' vs letter 'l')
- RTL override characters (`\u202E`) can reverse displayed text
- Zero-width characters can hide content

**Impact:** Phishing via email spoofing, invisible content injection, misleading display of email addresses and event data.

**Suggested fix:**
1. Normalize all user-facing strings to NFC
2. Detect mixed-script domains (e.g., Latin + Cyrillic) and warn or reject
3. Strip bidirectional control characters (`\u202A`-`\u202E`, `\u2066`-`\u2069`, `\u200E`, `\u200F`, `\u061C`)
4. Strip zero-width characters from display-critical fields

---

## Low

### BUG-058: No Date Range Validation in parseDateTime
**File:** `src/calendar/events.ts`, lines 54-60
**Severity:** Low

**Root cause:** `parseDateTime()` accepts dates before Unix epoch (1970) and far-future dates (e.g., year 10000) without validation. Google Calendar may technically support these, but they're almost never intentional.

**Suggested fix:** Add optional range enforcement (e.g., years 1970-9999). Low priority since the Calendar API itself handles most edge cases.

---

### BUG-059: Single-Digit Month/Day Misclassified as dateTime
**File:** `src/calendar/events.ts`, lines 54-60
**Severity:** Low

**Root cause:** The regex `/^\d{4}-\d{2}-\d{2}$/` requires zero-padded month/day. Input like `"2024-1-1"` doesn't match, so it falls through as `{ dateTime: "2024-1-1" }` instead of being recognized as an all-day date.

**Suggested fix:** Either relax the regex to accept 1-2 digit month/day (`\d{1,2}`), or document that dates must use zero-padded `YYYY-MM-DD` format. The current Zod schema description should be explicit about the required format.

---

### BUG-060: No Length Validation on Event Summary
**File:** `src/calendar/events.ts`, lines 83-100
**Severity:** Low

**Root cause:** `handleCreateEvent` and `handleUpdateEvent` accept arbitrarily long summaries. Google Calendar has limits (~1024 chars), but the MCP server doesn't enforce them client-side.

**Suggested fix:** Add Zod `.max(1024)` to the summary field in `src/index.ts`, or validate in the handler before the API call.

---

### BUG-062: No Change Detection Before Update
**File:** `src/calendar/events.ts`, lines 102-122
**Severity:** Low

**Root cause:** `handleUpdateEvent` doesn't compare new values against current values. Updating with the same summary still makes an API call.

**Suggested fix:** This would require fetching the current event first (extra API call). Probably not worth the complexity — document that updates always make an API call even if values are unchanged. Skip this one.

---

### BUG-064: No Time Range Duration Limit
**File:** `src/calendar/events.ts`, lines 62-81
**Severity:** Low

**Root cause:** `handleListEvents` allows arbitrarily wide time ranges (e.g., 100 years). This can cause slow responses or API errors.

**Suggested fix:** Add a maximum span check (e.g., 365 days) and return an error with a helpful message. Low priority since the Calendar API's pagination handles this reasonably.

---

### BUG-065: Silent Description Truncation in formatEvent
**File:** `src/calendar/events.ts`, lines 37-52
**Severity:** Low

**Root cause:** `formatEvent()` truncates descriptions > 500 chars and appends `[truncated: N chars]`. The full description is silently lost with no way to retrieve it.

**Suggested fix:** Either remove truncation entirely (let the MCP client handle display), or add a `full` format option similar to `gmail_get_thread`'s `format` parameter.

---

## Test Coverage Gaps

These functions have **zero test coverage**:

| Module | Untested |
|--------|----------|
| `src/gmail/drafts.ts` | `plainTextToHtml()`, `escapeHtml()`, `linkify()`, `isNumberedListBlock()`, `isBulletListBlock()`, `handleUpdateDraft()`, `handleListDrafts()`, `handleDeleteDraft()` |
| `src/index.ts` | All 12 tool registrations, Zod schema validation, MCP server setup, error handling wrappers |

Additionally, **no error-path tests** exist across the entire codebase. All tests cover happy paths only. Priority areas for error-path coverage:
- API failures (network errors, 404s, 429 rate limiting)
- Invalid input rejection (bad dates, empty strings, malformed IDs)
- Token refresh failures
- Corrupted token file recovery

---

## Summary

| ID | Severity | Module | Description |
|----|----------|--------|-------------|
| BUG-047 | Critical | auth.ts | Refresh token replay — no binding or encryption at rest |
| BUG-036 | High | threads.ts | Quote detection bypassed by HTML/Unicode in raw text |
| BUG-037 | High | threads.ts | Signature detection bypassed by non-standard delimiters |
| BUG-038 | High | threads.ts | Email regex rejects i18n addresses, misses homographs |
| BUG-042 | Medium | auth.ts | Symlink attack on token file write |
| BUG-043 | Medium | auth.ts | TOCTOU race between dir check and file write |
| BUG-050 | Medium | multiple | Homograph/Unicode spoofing — no mixed-script detection |
| BUG-058 | Low | events.ts | No date range bounds (pre-epoch, far-future) |
| BUG-059 | Low | events.ts | Single-digit month/day treated as dateTime |
| BUG-060 | Low | events.ts | No event summary length limit |
| BUG-062 | Low | events.ts | No change detection before PATCH call |
| BUG-064 | Low | events.ts | No time range duration limit |
| BUG-065 | Low | events.ts | Silent description truncation (500 char cap) |

**Total: 13 bugs** (1 critical, 3 high, 3 medium, 6 low) + test coverage gaps
