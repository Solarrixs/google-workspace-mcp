# Calendar Events Bug Report

Generated from edge case testing of src/calendar/events.ts

---

## BUG-054: formatEvent() crashes on null/undefined attendees without email — FIXED

**Location**: src/calendar/events.ts:48

**Severity**: Critical

**Root cause**: The `formatEvent()` function assumes all attendee objects have an `email` property. When an attendee is null, undefined, or an object without an email field, the code crashes with "Cannot read properties of null (reading 'email')".

```typescript
attendees: (event.attendees || []).map((a) => a.email).filter((email): email is string => !!email),
```

**How to trigger**: List or retrieve an event that has attendees with missing email fields:
```typescript
{
  attendees: [
    { email: 'valid@example.com' },
    { displayName: 'No Email' },  // crashes here
    null,
    undefined
  ]
}
```

**Suggested fix**: Add optional chaining and null check:
```typescript
attendees: (event.attendees || [])
  .map((a) => a?.email)
  .filter((email): email is string => !!email),
```

---

## BUG-055: max_results of zero is ignored (falsy value bug) — FIXED

**Location**: src/calendar/events.ts:73

**Severity**: Medium

**Root cause**: The code uses `params.max_results || 25` which treats 0 as falsy and falls back to the default. This makes it impossible to request zero events (e.g., to just check if events exist without retrieving them).

**How to trigger**: Call `handleListEvents()` with `max_results: 0`:
```typescript
await handleListEvents(calendar, { max_results: 0 });
// API is called with maxResults: 25 instead
```

**Suggested fix**: Use nullish coalescing instead:
```typescript
maxResults: params.max_results ?? 25,
```

---

## BUG-056: parseDateTime accepts invalid calendar dates — FIXED

**Location**: src/calendar/events.ts:54-60

**Severity**: Medium

**Root cause**: The regex `/^\d{4}-\d{2}-\d{2}$/` only validates the format, not whether the date is a valid calendar date. Invalid dates like "2024-13-45" pass the regex but aren't valid calendar dates.

**How to trigger**:
```typescript
await handleCreateEvent(calendar, {
  start: '2024-13-45',  // Invalid - month 13
  end: '2024-13-46',
});
```

**Suggested fix**: Add date validation using JavaScript Date object:
```typescript
function parseDateTime(iso: string): calendar_v3.Schema$EventDateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const date = new Date(iso);
    if (isNaN(date.getTime())) {
      throw new Error(`Invalid date: ${iso}`);
    }
    return { date: iso };
  }
  return { dateTime: iso };
}
```

---

## BUG-057: parseDateTime accepts invalid leap day for non-leap years — FIXED

**Location**: src/calendar/events.ts:54-60

**Severity**: Medium

**Root cause**: Same as BUG-056 - the regex doesn't validate that February 29th actually exists in the given year. "2023-02-29" (non-leap year) is accepted.

**How to trigger**:
```typescript
await handleCreateEvent(calendar, {
  start: '2023-02-29',  // Invalid - 2023 is not a leap year
  end: '2023-03-01',
});
```

**Suggested fix**: Same as BUG-056 - validate the date using JavaScript Date.

---

## BUG-058: No validation of date time ranges

**Location**: src/calendar/events.ts:54-60

**Severity**: Low

**Root cause**: parseDateTime accepts dates before Unix epoch (1970) and dates far in the future without validation. While Google Calendar may support these, there's no reasonable range enforcement.

**How to trigger**:
```typescript
await handleCreateEvent(calendar, {
  start: '1969-12-31',  // Before Unix epoch
  end: '1970-01-01',
});

await handleCreateEvent(calendar, {
  start: '10000-01-01',  // Far in the future
  end: '10000-01-02',
});
```

**Suggested fix**: Add reasonable range validation (e.g., years 1970-9999):
```typescript
function parseDateTime(iso: string): calendar_v3.Schema$EventDateTime {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const year = parseInt(iso.substring(0, 4), 10);
    if (year < 1970 || year > 9999) {
      throw new Error(`Date must be between years 1970 and 9999: ${iso}`);
    }
    // ... rest of validation
  }
  return { dateTime: iso };
}
```

---

## BUG-059: Single-digit month/day misclassified as dateTime

**Location**: src/calendar/events.ts:54-60

**Severity**: Low

**Root cause**: The regex requires exactly 2 digits for month and day (`\d{2}`). Single-digit dates like "2024-1-1" don't match, so they're treated as `dateTime` instead of `date`.

**How to trigger**:
```typescript
await handleCreateEvent(calendar, {
  start: '2024-1-1',     // Treated as dateTime
  end: '2024-1-2',
});
// Calls API with: { start: { dateTime: '2024-1-1' } }
// Instead of:      { start: { date: '2024-01-01' } }
```

**Suggested fix**: Option A - Relax regex to accept 1-2 digits:
```typescript
if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(iso)) {
  // Normalize to 2-digit format
  return { date: iso }; // Or normalize first
}
```

Option B - Document that dates must be in YYYY-MM-DD format with zero-padding.

---

## BUG-060: No length validation on event summary

**Location**: src/calendar/events.ts:83-100

**Severity**: Low

**Root cause**: The `handleCreateEvent` function accepts any length for the `summary` field without validation. Google Calendar has limits (typically a few thousand characters), but this is not enforced client-side.

**How to trigger**:
```typescript
const longSummary = 'A'.repeat(10000); // 10,000 character title
await handleCreateEvent(calendar, {
  summary: longSummary,
  start: '2024-03-01',
  end: '2024-03-02',
});
```

**Suggested fix**: Add summary length validation:
```typescript
if (params.summary && params.summary.length > 2000) {
  throw new Error('Event summary must be less than 2000 characters');
}
```

---

## BUG-061: Empty update object triggers unnecessary API call — FIXED

**Location**: src/calendar/events.ts:102-122

**Severity**: Low

**Root cause**: When `handleUpdateEvent` is called with only an `event_id` and no other fields (all undefined), it still makes an API call to patch the event with an empty object. This is wasteful and may have unintended side effects.

**How to trigger**:
```typescript
await handleUpdateEvent(calendar, {
  event_id: 'event1',
  // No other fields
});
// Makes API call with: { eventId: 'event1', requestBody: {} }
```

**Suggested fix**: Check if update object is empty before calling API:
```typescript
export async function handleUpdateEvent(
  calendar: calendar_v3.Calendar,
  params: UpdateEventParams
) {
  const update: calendar_v3.Schema$Event = {};
  if (params.summary !== undefined) update.summary = params.summary;
  if (params.start !== undefined) update.start = parseDateTime(params.start);
  if (params.end !== undefined) update.end = parseDateTime(params.end);
  if (params.description !== undefined) update.description = params.description;
  if (params.location !== undefined) update.location = params.location;
  if (params.attendees !== undefined)
    update.attendees = params.attendees.map((email) => ({ email }));

  if (Object.keys(update).length === 0) {
    throw new Error('At least one field must be specified for update');
  }

  const res = await calendar.events.patch({
    calendarId: params.calendar_id || 'primary',
    eventId: params.event_id,
    requestBody: update,
  });

  return formatEvent(res.data);
}
```

---

## BUG-062: No change detection before update (unnecessary API calls)

**Location**: src/calendar/events.ts:102-122

**Severity**: Low

**Root cause**: The function doesn't check if the new values are different from existing values before making an API call. Updating with the same summary makes a network request with no effect.

**How to trigger**:
```typescript
// Event already has summary "Original Title"
await handleUpdateEvent(calendar, {
  event_id: 'event1',
  summary: 'Original Title', // Same as current value
});
// Still makes API call unnecessarily
```

**Suggested fix**: This requires fetching the current event first and comparing values. However, this adds complexity. An alternative is to document that updates will always make API calls, even if values are the same.

---

## BUG-063: No validation that time_min <= time_max — FIXED

**Location**: src/calendar/events.ts:62-81

**Severity**: Low

**Root cause**: `handleListEvents` accepts `time_min` and `time_max` without validating that `time_min` is before `time_max`. This could lead to unexpected empty results or API errors.

**How to trigger**:
```typescript
await handleListEvents(calendar, {
  time_min: '2026-02-20T00:00:00Z',
  time_max: '2026-02-10T00:00:00Z',  // time_max before time_min
});
```

**Suggested fix**: Add validation:
```typescript
if (params.time_min && params.time_max) {
  const minTime = new Date(params.time_min).getTime();
  const maxTime = new Date(params.time_max).getTime();
  if (minTime > maxTime) {
    throw new Error('time_min must be before or equal to time_max');
  }
}
```

---

## BUG-064: No validation of reasonable time ranges

**Location**: src/calendar/events.ts:62-81

**Severity**: Low

**Root cause**: Users can specify extremely long time ranges (e.g., 100 years) without validation. This could cause performance issues or unexpected behavior.

**How to trigger**:
```typescript
await handleListEvents(calendar, {
  time_min: '1924-01-01T00:00:00Z',
  time_max: '2024-01-01T00:00:00Z',  // 100 year span
});
```

**Suggested fix**: Add range duration validation (e.g., max 10-25 years):
```typescript
if (params.time_min && params.time_max) {
  const minTime = new Date(params.time_min).getTime();
  const maxTime = new Date(params.time_max).getTime();
  const maxDays = 365 * 25; // 25 years
  if (maxTime - minTime > maxDays * 24 * 60 * 60 * 1000) {
    throw new Error('Time range cannot exceed 25 years');
  }
}
```

---

## BUG-065: Description truncation causes data loss

**Location**: src/calendar/events.ts:37-52

**Severity**: Low

**Root cause**: `formatEvent()` truncates descriptions longer than 500 characters. The truncation happens silently, and users have no way to know their content was truncated or retrieve the full content.

**How to trigger**:
```typescript
{
  description: 'A'.repeat(1000)  // 1000 character description
}
// Returned as: 500 chars + "\n\n[truncated: 1000 chars]"
// Original 1000 chars are lost
```

**Suggested fix**: Options:
1. Don't truncate at all - let the consumer handle long strings
2. Add a `full` parameter to `formatEvent` that returns untruncated descriptions
3. Return a `description_truncated` boolean flag to signal data loss

Option 1 suggested (simplest):
```typescript
function formatEvent(event: calendar_v3.Schema$Event) {
  const desc = event.description || '';
  return compact({
    id: event.id,
    summary: event.summary || '',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    attendees: (event.attendees || []).map((a) => a?.email).filter((email): email is string => !!email),
    location: event.location || '',
    description: desc, // Don't truncate
  });
}
```

---

## Summary

| Bug ID | Severity | Description |
|--------|----------|-------------|
| BUG-054 | Critical | Crash on null/undefined attendees | **FIXED** |
| BUG-055 | Medium | max_results=0 ignored | **FIXED** |
| BUG-056 | Medium | Invalid dates accepted | **FIXED** |
| BUG-057 | Medium | Invalid leap day accepted | **FIXED** |
| BUG-058 | Low | No date range validation | Skipped |
| BUG-059 | Low | Single-digit dates misclassified | Skipped |
| BUG-060 | Low | No summary length limit | Skipped |
| BUG-061 | Low | Empty update still makes API call | **FIXED** |
| BUG-062 | Low | No change detection | Skipped |
| BUG-063 | Low | No time_min/time_max validation | **FIXED** |
| BUG-064 | Low | No time range duration limit | Skipped |
| BUG-065 | Low | Silent description truncation | Skipped |

Total: 12 bugs (1 Critical, 3 Medium, 8 Low)
