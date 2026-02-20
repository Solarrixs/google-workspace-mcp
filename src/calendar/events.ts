import type { calendar_v3 } from 'googleapis';
import { compact } from '../utils.js';

interface ListEventsParams {
  time_min?: string;
  time_max?: string;
  max_results?: number;
  calendar_id?: string;
}

interface CreateEventParams {
  summary: string;
  start: string;
  end: string;
  description?: string;
  attendees?: string[];
  location?: string;
  calendar_id?: string;
}

interface UpdateEventParams {
  event_id: string;
  summary?: string;
  start?: string;
  end?: string;
  description?: string;
  attendees?: string[];
  location?: string;
  calendar_id?: string;
}

interface DeleteEventParams {
  event_id: string;
  calendar_id?: string;
}

function formatEvent(event: calendar_v3.Schema$Event) {
  let desc = event.description || '';
  if (desc.length > 500) {
    desc = desc.substring(0, 500) + `\n\n[truncated: ${desc.length} chars]`;
  }

  return compact({
    id: event.id,
    summary: event.summary || '',
    start: event.start?.dateTime || event.start?.date || '',
    end: event.end?.dateTime || event.end?.date || '',
    attendees: (event.attendees || []).map((a) => a?.email).filter((email): email is string => !!email),
    location: event.location || '',
    description: desc,
  });
}

function parseDateTime(iso: string): calendar_v3.Schema$EventDateTime {
  if (!iso) {
    throw new Error('Invalid date input: value cannot be empty');
  }
  // If it's a date-only string (YYYY-MM-DD), use date field
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const d = new Date(iso + 'T00:00:00');
    if (isNaN(d.getTime())) {
      throw new Error(`Invalid date: ${iso}`);
    }
    return { date: iso };
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) {
    throw new Error(`Invalid datetime: ${iso}`);
  }
  return { dateTime: iso };
}

export async function handleListEvents(
  calendar: calendar_v3.Calendar,
  params: ListEventsParams
) {
  const now = new Date();
  const weekFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (params.time_min && params.time_max) {
    if (new Date(params.time_min) > new Date(params.time_max)) {
      throw new Error('time_min must be before time_max');
    }
  }

  const res = await calendar.events.list({
    calendarId: params.calendar_id || 'primary',
    timeMin: params.time_min || now.toISOString(),
    timeMax: params.time_max || weekFromNow.toISOString(),
    maxResults: params.max_results ?? 25,
    singleEvents: true,
    orderBy: 'startTime',
  });

  return {
    events: (res.data.items || []).map(formatEvent),
  };
}

export async function handleCreateEvent(
  calendar: calendar_v3.Calendar,
  params: CreateEventParams
) {
  const res = await calendar.events.insert({
    calendarId: params.calendar_id || 'primary',
    requestBody: {
      summary: params.summary,
      start: parseDateTime(params.start),
      end: parseDateTime(params.end),
      description: params.description,
      location: params.location,
      attendees: params.attendees?.map((email) => ({ email })),
    },
  });

  return formatEvent(res.data);
}

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
    throw new Error('At least one field must be provided for update');
  }

  const res = await calendar.events.patch({
    calendarId: params.calendar_id || 'primary',
    eventId: params.event_id,
    requestBody: update,
  });

  return formatEvent(res.data);
}

export async function handleDeleteEvent(
  calendar: calendar_v3.Calendar,
  params: DeleteEventParams
) {
  await calendar.events.delete({
    calendarId: params.calendar_id || 'primary',
    eventId: params.event_id,
  });

  return compact({ status: `Event ${params.event_id} deleted.` });
}
