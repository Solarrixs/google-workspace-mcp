import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { getGmailClient, getCalendarClient } from './auth.js';
import {
  handleListThreads,
  handleGetThread,
} from './gmail/threads.js';
import { handleCreateDraft, handleUpdateDraft, handleDeleteDraft, handleListDrafts } from './gmail/drafts.js';
import { handleListLabels } from './gmail/labels.js';
import {
  handleListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
} from './calendar/events.js';

function validateStringSize(value: string, maxSize: number, name: string): string {
  if (value.length > maxSize) {
    throw new Error(`${name} exceeds maximum size of ${maxSize} bytes`);
  }
  return value;
}

function stripControlChars(value: string): string {
  return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

const server = new McpServer({
  name: 'google-workspace',
  version: '1.0.0',
});

// --- Gmail Tools ---

server.tool(
  'gmail_list_threads',
  'List email threads with filtering. Returns thread metadata (subject, snippet, dates, labels), not full content.',
  {
    query: z.string().optional().transform(v => v ? stripControlChars(validateStringSize(v, 2000, 'query')) : v).describe('Gmail search query (e.g., "is:inbox", "newer_than:14d", "from:me")'),
    max_results: z.number().min(1).max(100).optional().describe('Max threads to return (default: 25)'),
    page_token: z.string().optional().describe('Pagination token for next page'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleListThreads(gmail, params);
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

server.tool(
  'gmail_get_thread',
  'Read the full content of a specific email thread — all messages in chronological order with bodies.',
  {
    thread_id: z.string().describe('Gmail thread ID'),
    format: z.enum(['full', 'minimal']).optional().describe('full (default) includes message bodies, minimal does not'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleGetThread(gmail, params);
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

server.tool(
  'gmail_create_draft',
  'Create a draft email. Supports threaded replies (draft appears as reply in existing conversation). Draft-only — never sends.',
  {
    to: z.string().describe('Recipient email(s), comma-separated'),
    subject: z.string().transform(v => stripControlChars(validateStringSize(v, 1000, 'subject'))).describe('Email subject line'),
    body: z.string().transform(v => stripControlChars(validateStringSize(v, 10485760, 'body'))).describe('Email body (plain text)'),
    thread_id: z.string().optional().describe('Thread ID for threaded reply'),
    in_reply_to: z.string().optional().describe('Message-ID of the message being replied to'),
    cc: z.string().optional().describe('CC recipients'),
    bcc: z.string().optional().describe('BCC recipients'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleCreateDraft(gmail, params);
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

server.tool(
  'gmail_update_draft',
  'Update an existing draft email. Only provide fields you want to change; others are preserved from the existing draft.',
  {
    draft_id: z.string().describe('Draft ID to update (returned by gmail_create_draft)'),
    to: z.string().optional().describe('New recipient email(s), comma-separated'),
    subject: z.string().optional().describe('New subject line'),
    body: z.string().optional().describe('New email body (plain text)'),
    thread_id: z.string().optional().describe('Thread ID for threaded reply'),
    in_reply_to: z.string().optional().describe('Message-ID of the message being replied to'),
    cc: z.string().optional().describe('New CC recipients'),
    bcc: z.string().optional().describe('New BCC recipients'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleUpdateDraft(gmail, params);
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

server.tool(
  'gmail_delete_draft',
  'Permanently delete a draft email.',
  {
    draft_id: z.string().describe('Draft ID to delete (returned by gmail_create_draft)'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleDeleteDraft(gmail, params);
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

server.tool(
  'gmail_list_drafts',
  'List all draft emails with their draft IDs, subjects, and recipients.',
  {
    max_results: z.number().min(1).max(100).optional().describe('Max drafts to return (default: 25)'),
  },
  async (params) => {
    try {
      const gmail = getGmailClient();
      const result = await handleListDrafts(gmail, params);
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

server.tool(
  'gmail_list_labels',
  'List all Gmail labels (including Superhuman auto-labels).',
  {},
  async () => {
    try {
      const gmail = getGmailClient();
      const result = await handleListLabels(gmail);
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

// --- Calendar Tools ---

server.tool(
  'calendar_list_events',
  'List calendar events within a time range.',
  {
    time_min: z.string().optional().describe('ISO 8601 start time (default: now)'),
    time_max: z.string().optional().describe('ISO 8601 end time (default: 7 days from now)'),
    max_results: z.number().min(1).max(100).optional().describe('Max events (default: 25)'),
    calendar_id: z.string().optional().describe('Calendar ID (default: primary)'),
  },
  async (params) => {
    try {
      const calendar = getCalendarClient();
      const result = await handleListEvents(calendar, params);
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

server.tool(
  'calendar_create_event',
  'Create a new calendar event.',
  {
    summary: z.string().describe('Event title'),
    start: z.string().describe('ISO 8601 start time'),
    end: z.string().describe('ISO 8601 end time'),
    description: z.string().optional().describe('Event description'),
    attendees: z.array(z.string()).optional().describe('Attendee email addresses'),
    location: z.string().optional().describe('Event location'),
    calendar_id: z.string().optional().describe('Calendar ID (default: primary)'),
  },
  async (params) => {
    try {
      const calendar = getCalendarClient();
      const result = await handleCreateEvent(calendar, params);
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

server.tool(
  'calendar_update_event',
  'Update an existing calendar event.',
  {
    event_id: z.string().describe('Event ID to update'),
    summary: z.string().optional().describe('New title'),
    start: z.string().optional().describe('New start time'),
    end: z.string().optional().describe('New end time'),
    description: z.string().optional().describe('New description'),
    attendees: z.array(z.string()).optional().describe('New attendee list'),
    location: z.string().optional().describe('New location'),
    calendar_id: z.string().optional().describe('Calendar ID (default: primary)'),
  },
  async (params) => {
    try {
      const calendar = getCalendarClient();
      const result = await handleUpdateEvent(calendar, params);
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

server.tool(
  'calendar_delete_event',
  'Delete a calendar event.',
  {
    event_id: z.string().describe('Event ID to delete'),
    calendar_id: z.string().optional().describe('Calendar ID (default: primary)'),
  },
  async (params) => {
    try {
      const calendar = getCalendarClient();
      const result = await handleDeleteEvent(calendar, params);
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

// --- Start Server ---

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  console.error('Server failed to start:', error);
  process.exit(1);
});
