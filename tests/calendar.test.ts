import { describe, it, expect, vi } from 'vitest';
import {
  handleListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
} from '../src/calendar/events.js';
import { handleListLabels } from '../src/gmail/labels.js';

function createMockCalendar() {
  return {
    events: {
      list: vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'event1',
              summary: 'Team standup',
              start: { dateTime: '2026-02-12T09:00:00-08:00' },
              end: { dateTime: '2026-02-12T09:30:00-08:00' },
              attendees: [
                { email: 'maxx@engramcompute.com', responseStatus: 'accepted' },
                { email: 'jane@engramcompute.com', responseStatus: 'needsAction' },
              ],
              location: 'Zoom',
              description: 'Daily standup',
            },
            {
              id: 'event2',
              summary: 'All-day workshop',
              start: { date: '2026-02-15' },
              end: { date: '2026-02-16' },
              attendees: [],
              location: '',
              description: '',
            },
          ],
        },
      }),
      insert: vi.fn().mockResolvedValue({
        data: {
          id: 'new-event-1',
          summary: 'New Meeting',
          start: { dateTime: '2026-02-20T14:00:00-08:00' },
          end: { dateTime: '2026-02-20T15:00:00-08:00' },
          attendees: [{ email: 'guest@example.com', responseStatus: 'needsAction' }],
          location: 'Conference Room',
          description: 'Important discussion',
        },
      }),
      get: vi.fn().mockResolvedValue({
        data: {
          id: 'event1',
          summary: 'Team standup',
          start: { dateTime: '2026-02-12T09:00:00-08:00' },
          end: { dateTime: '2026-02-12T09:30:00-08:00' },
        },
      }),
      patch: vi.fn().mockResolvedValue({
        data: {
          id: 'event1',
          summary: 'Renamed standup',
          start: { dateTime: '2026-02-12T10:00:00-08:00' },
          end: { dateTime: '2026-02-12T10:30:00-08:00' },
          attendees: [],
          location: '',
          description: '',
        },
      }),
      delete: vi.fn().mockResolvedValue({}),
    },
  } as any;
}

describe('handleListEvents', () => {
  it('returns formatted event list', async () => {
    const calendar = createMockCalendar();
    const result = await handleListEvents(calendar, {});

    expect(result.events).toHaveLength(2);

    // DateTime event
    expect(result.events[0].id).toBe('event1');
    expect(result.events[0].summary).toBe('Team standup');
    expect(result.events[0].start).toBe('2026-02-12T09:00:00-08:00');
    expect(result.events[0].attendees).toHaveLength(2);
    expect(result.events[0].location).toBe('Zoom');

    // All-day event
    expect(result.events[1].id).toBe('event2');
    expect(result.events[1].start).toBe('2026-02-15');
    expect(result.events[1].end).toBe('2026-02-16');

    // Empty fields stripped by compact
    expect(result.events[1]).not.toHaveProperty('attendees');
    expect(result.events[1]).not.toHaveProperty('location');
    expect(result.events[1]).not.toHaveProperty('description');
  });

  it('passes time range to API', async () => {
    const calendar = createMockCalendar();
    await handleListEvents(calendar, {
      time_min: '2026-02-10T00:00:00Z',
      time_max: '2026-02-20T00:00:00Z',
      max_results: 50,
    });

    expect(calendar.events.list).toHaveBeenCalledWith(
      expect.objectContaining({
        timeMin: '2026-02-10T00:00:00Z',
        timeMax: '2026-02-20T00:00:00Z',
        maxResults: 50,
        singleEvents: true,
        orderBy: 'startTime',
      })
    );
  });

  it('uses default calendar_id of primary', async () => {
    const calendar = createMockCalendar();
    await handleListEvents(calendar, {});

    expect(calendar.events.list).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'primary' })
    );
  });

  it('uses custom calendar_id when provided', async () => {
    const calendar = createMockCalendar();
    await handleListEvents(calendar, { calendar_id: 'custom@group.calendar.google.com' });

    expect(calendar.events.list).toHaveBeenCalledWith(
      expect.objectContaining({ calendarId: 'custom@group.calendar.google.com' })
    );
  });
});

describe('handleCreateEvent', () => {
  it('creates event with all fields', async () => {
    const calendar = createMockCalendar();
    const result = await handleCreateEvent(calendar, {
      summary: 'New Meeting',
      start: '2026-02-20T14:00:00-08:00',
      end: '2026-02-20T15:00:00-08:00',
      description: 'Important discussion',
      attendees: ['guest@example.com'],
      location: 'Conference Room',
    });

    expect(result.id).toBe('new-event-1');
    expect(result.summary).toBe('New Meeting');
    expect(result.location).toBe('Conference Room');

    expect(calendar.events.insert).toHaveBeenCalledWith({
      calendarId: 'primary',
      requestBody: {
        summary: 'New Meeting',
        start: { dateTime: '2026-02-20T14:00:00-08:00' },
        end: { dateTime: '2026-02-20T15:00:00-08:00' },
        description: 'Important discussion',
        location: 'Conference Room',
        attendees: [{ email: 'guest@example.com' }],
      },
    });
  });

  it('handles all-day events (date-only format)', async () => {
    const calendar = createMockCalendar();
    await handleCreateEvent(calendar, {
      summary: 'Workshop',
      start: '2026-02-25',
      end: '2026-02-26',
    });

    expect(calendar.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          start: { date: '2026-02-25' },
          end: { date: '2026-02-26' },
        }),
      })
    );
  });
});

describe('handleUpdateEvent', () => {
  it('patches event with only provided fields', async () => {
    const calendar = createMockCalendar();
    const result = await handleUpdateEvent(calendar, {
      event_id: 'event1',
      summary: 'Renamed standup',
      start: '2026-02-12T10:00:00-08:00',
      end: '2026-02-12T10:30:00-08:00',
    });

    expect(result.summary).toBe('Renamed standup');
    expect(calendar.events.patch).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event1',
      requestBody: {
        summary: 'Renamed standup',
        start: { dateTime: '2026-02-12T10:00:00-08:00' },
        end: { dateTime: '2026-02-12T10:30:00-08:00' },
      },
    });
  });

});

describe('handleDeleteEvent', () => {
  it('deletes event and returns confirmation', async () => {
    const calendar = createMockCalendar();
    const result = await handleDeleteEvent(calendar, { event_id: 'event1' });

    expect(result.status).toBe('Event event1 deleted successfully.');
    expect(calendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event1',
    });
  });

  it('uses custom calendar_id', async () => {
    const calendar = createMockCalendar();
    await handleDeleteEvent(calendar, {
      event_id: 'event1',
      calendar_id: 'work@group.calendar.google.com',
    });

    expect(calendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'work@group.calendar.google.com',
      eventId: 'event1',
    });
  });
});

describe('BUG-010: handleUpdateEvent() allows start > end', () => {
  it('throws error when start > end (fix validates start <= end)', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleUpdateEvent(calendar, {
        event_id: 'event1',
        start: '2026-02-20T16:00:00-08:00',
        end: '2026-02-20T15:00:00-08:00',
      })
    ).rejects.toThrow('Invalid event: start time must be before or equal to end time');
  });

  it('throws error when start > end for date-only events', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleUpdateEvent(calendar, {
        event_id: 'event1',
        start: '2026-02-25',
        end: '2026-02-20',
      })
    ).rejects.toThrow('Invalid event: start time must be before or equal to end time');
  });

  it('allows equal start and end times', async () => {
    const calendar = createMockCalendar();

    const result = await handleUpdateEvent(calendar, {
      event_id: 'event1',
      start: '2026-02-20T10:00:00-08:00',
      end: '2026-02-20T10:00:00-08:00',
    });

    expect(result).toBeDefined();
    expect(calendar.events.patch).toHaveBeenCalled();
  });

  it('allows start < end (valid time range)', async () => {
    const calendar = createMockCalendar();

    const result = await handleUpdateEvent(calendar, {
      event_id: 'event1',
      start: '2026-02-20T09:00:00-08:00',
      end: '2026-02-20T10:00:00-08:00',
    });

    expect(result).toBeDefined();
  });
});

describe('BUG-015: parseDateTime() accepts garbage input', () => {
  it('throws error on invalid date string "not-a-date"', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleCreateEvent(calendar, {
        summary: 'Test',
        start: 'not-a-date',
        end: '2026-02-20T10:00:00-08:00',
      })
    ).rejects.toThrow('Invalid datetime');
  });

  it('throws error on invalid date "2024-13-99"', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleCreateEvent(calendar, {
        summary: 'Test',
        start: '2024-13-99',
        end: '2026-02-20T10:00:00-08:00',
      })
    ).rejects.toThrow('Invalid date');
  });

  it('throws error on informal date "tomorrow"', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleCreateEvent(calendar, {
        summary: 'Test',
        start: 'tomorrow',
        end: '2026-02-20T10:00:00-08:00',
      })
    ).rejects.toThrow('Invalid datetime');
  });

  it('throws error on empty string', async () => {
    const calendar = createMockCalendar();

    await expect(
      handleCreateEvent(calendar, {
        summary: 'Test',
        start: '',
        end: '2026-02-20T10:00:00-08:00',
      })
    ).rejects.toThrow('Invalid date input');
  });

  it('accepts valid ISO-8601 date string', async () => {
    const calendar = createMockCalendar();

    await handleCreateEvent(calendar, {
      summary: 'All-day event',
      start: '2026-03-15',
      end: '2026-03-16',
    });

    expect(calendar.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          start: { date: '2026-03-15' },
          end: { date: '2026-03-16' },
        }),
      })
    );
  });
});

describe('BUG-029: formatEvent() attendee email could be undefined', () => {
  it('filters out attendees with undefined email in response', async () => {
    const calendar = {
      events: {
        insert: vi.fn().mockResolvedValue({
          data: {
            id: 'event1',
            summary: 'Test Event',
            start: { dateTime: '2026-02-20T10:00:00-08:00' },
            end: { dateTime: '2026-02-20T11:00:00-08:00' },
            attendees: [
              { email: 'valid@example.com', responseStatus: 'accepted' },
              { responseStatus: 'declined' }, // Missing email - should be filtered by compact
              { email: 'another@example.com', responseStatus: 'needsAction' },
              { email: undefined, responseStatus: 'tentative' }, // Explicit undefined
            ],
          },
        }),
      },
    } as any;

    const result = await handleCreateEvent(calendar, {
      summary: 'Test Event',
      start: '2026-02-20T10:00:00-08:00',
      end: '2026-02-20T11:00:00-08:00',
      attendees: ['valid@example.com', 'another@example.com'],
    });

    // attendees should be an array of strings (emails only)
    expect(result.attendees).toBeDefined();
    expect(result.attendees).toHaveLength(2);
    expect(result.attendees).toContain('valid@example.com');
    expect(result.attendees).toContain('another@example.com');
  });

  it('handles events with no attendees gracefully', async () => {
    const calendar = {
      events: {
        insert: vi.fn().mockResolvedValue({
          data: {
            id: 'event2',
            summary: 'Solo Event',
            start: { dateTime: '2026-02-20T10:00:00-08:00' },
            end: { dateTime: '2026-02-20T11:00:00-08:00' },
            attendees: undefined,
          },
        }),
      },
    } as any;

    const result = await handleCreateEvent(calendar, {
      summary: 'Solo Event',
      start: '2026-02-20T10:00:00-08:00',
      end: '2026-02-20T11:00:00-08:00',
    });

    // attendees array with compact() should be stripped if empty
    const hasAttendees = result.hasOwnProperty('attendees');
    expect(hasAttendees).toBe(false);
  });
});

describe('BUG-031: handleListLabels() no pagination', () => {
  it('handleListLabels does not implement pagination (documented limitation)', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({
            data: {
              labels: [
                { id: 'INBOX', name: 'INBOX', type: 'system' },
                { id: 'SENT', name: 'SENT', type: 'system' },
              ],
              nextPageToken: 'page2', // Ignored in current implementation
            },
          }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);

    expect(gmail.users.labels.list).toHaveBeenCalledWith({ userId: 'me' });
    expect(gmail.users.labels.list).toHaveBeenCalledTimes(1); // Only one call, no pagination
    expect(result.labels).toHaveLength(2);
  });

  it('returns first page of labels only', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({
            data: {
              labels: [
                { id: 'Label1', name: 'Label1', type: 'user' },
                { id: 'Label2', name: 'Label2', type: 'user' },
                { id: 'Label3', name: 'Label3', type: 'user' },
              ],
            },
          }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels).toHaveLength(3);
  });
});
