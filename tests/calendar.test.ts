import { describe, it, expect, vi } from 'vitest';
import {
  handleListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
} from '../src/calendar/events.js';

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
              htmlLink: 'https://calendar.google.com/event?id=event1',
            },
            {
              id: 'event2',
              summary: 'All-day workshop',
              start: { date: '2026-02-15' },
              end: { date: '2026-02-16' },
              attendees: [],
              location: '',
              description: '',
              htmlLink: 'https://calendar.google.com/event?id=event2',
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
          htmlLink: 'https://calendar.google.com/event?id=new-event-1',
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
          htmlLink: 'https://calendar.google.com/event?id=event1',
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
