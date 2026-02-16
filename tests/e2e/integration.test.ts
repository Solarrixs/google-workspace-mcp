import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleListThreads, handleGetThread } from '../../src/gmail/threads.js';
import {
  handleCreateDraft,
  handleUpdateDraft,
  handleDeleteDraft,
} from '../../src/gmail/drafts.js';
import { handleListLabels } from '../../src/gmail/labels.js';
import {
  handleListEvents,
  handleCreateEvent,
  handleUpdateEvent,
  handleDeleteEvent,
} from '../../src/calendar/events.js';

// ===== MOCK FACTORIES =====

function createMockGmail(overrides: Record<string, any> = {}) {
  const gmail = {
    users: {
      getProfile: vi.fn().mockResolvedValue({
        data: {
          emailAddress: 'maxx@engramcompute.com',
        },
      }),
      threads: {
        list: vi.fn().mockResolvedValue({
          data: {
            threads: [
              {
                id: 'thread1',
                snippet: 'CO2 regulator quote request',
              },
              {
                id: 'thread2',
                snippet: 'Meeting tomorrow at 3pm',
              },
            ],
            nextPageToken: 'page2',
            ...overrides.threadsListData,
          },
        }),
        get: vi.fn().mockImplementation(({ id }: any) => {
          const threads: Record<string, any> = {
            thread1: {
              data: {
                id: 'thread1',
                snippet: 'CO2 regulator quote request',
                messages: [
                  {
                    id: 'msg1',
                    internalDate: '1770138900000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'CO2 regulator quote' },
                        { name: 'From', value: 'Max <maxx@engramcompute.com>' },
                        { name: 'To', value: 'sales@vendor.com>' },
                        { name: 'Date', value: 'Mon, 03 Feb 2026 09:15:00 -0800' },
                        { name: 'Message-ID', value: '<msg1@mail.gmail.com>' },
                      ],
                      mimeType: 'text/plain',
                      body: {
                        data: Buffer.from(
                          'Hi,\n\nI\'m looking to purchase CO2 regulators for our lab. Please provide a quote for 50 units of Model A.\n\nThanks,\nMax'
                        ).toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX', 'CATEGORY_PRIMARY'],
                  },
                  {
                    id: 'msg2',
                    internalDate: '1770143400000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'Re: CO2 regulator quote' },
                        { name: 'From', value: 'Sales <sales@vendor.com>' },
                        { name: 'To', value: 'maxx@engramcompute.com>' },
                        { name: 'Message-ID', value: '<msg2@vendor.com>' },
                        { name: 'References', value: '<msg1@mail.gmail.com>' },
                      ],
                      mimeType: 'text/html',
                      body: {
                        data: Buffer.from(
                          '<html><body><p>Thanks Max!</p><p>We\'d be happy to provide a quote. Here are our prices:</p><ul><li>Model A: $120/unit</li><li>Model B: $150/unit</li></ul><p>Let us know which you prefer.</p><p>Best,<br>Sales Team</p><p>--\nCONFIDENTIAL - This email may contain confidential information.</p></body></html>'
                        ).toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX'],
                  },
                ],
              },
            },
            thread2: {
              data: {
                id: 'thread2',
                snippet: 'Meeting tomorrow at 3pm',
                messages: [
                  {
                    id: 'msg3',
                    internalDate: '1770220000000',
                    payload: {
                      headers: [
                        { name: 'Subject', value: 'Meeting tomorrow' },
                        { name: 'From', value: 'Jane <jane@example.com>' },
                        { name: 'To', value: 'maxx@engramcompute.com>' },
                        { name: 'Date', value: 'Tue, 04 Feb 2026 10:30:00 -0800' },
                        { name: 'Message-ID', value: '<msg3@example.com>' },
                      ],
                      mimeType: 'text/plain',
                      body: {
                        data: Buffer.from(
                          'Hi Max,\n\nCan we meet tomorrow at 3pm to discuss the project?\n\nOn Mon, Feb 3, 2026 at 9:15 AM, Max Yung wrote:\n> Original message content\n> that was quoted here\n\nThanks!\nJane\n\n-- \nJane Smith\nSenior Product Manager'
                        ).toString('base64url'),
                      },
                    },
                    labelIds: ['INBOX', 'STARRED'],
                  },
                ],
              },
            },
          };
          return Promise.resolve(threads[id!] || { data: {} });
        }),
        ...overrides.threadsMethods,
      },
      drafts: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'draft1',
            message: {
              id: 'msg4',
              threadId: null,
              payload: {
                headers: [
                  { name: 'Subject', value: 'Draft: New Project Proposal' },
                  { name: 'To', value: 'team@engramcompute.com>' },
                ],
              },
            },
          },
        }),
        update: vi.fn().mockResolvedValue({
          data: {
            id: 'draft1',
            message: {
              id: 'msg4',
              threadId: null,
              payload: {
                headers: [
                  { name: 'Subject', value: 'Draft: Updated Project Proposal' },
                  { name: 'To', value: 'team@engramcompute.com>' },
                ],
              },
            },
          },
        }),
        delete: vi.fn().mockResolvedValue({}),
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'draft1',
            message: {
              id: 'msg1',
              threadId: null,
              payload: {},
            },
          },
        }),
        ...overrides.draftsMethods,
      },
      labels: {
        list: vi.fn().mockResolvedValue({
          data: {
            labels: [
              { id: 'INBOX', name: 'INBOX', type: 'system' },
              { id: 'SENT', name: 'SENT', type: 'system' },
              { id: 'IMPORTANT', name: 'IMPORTANT', type: 'system' },
              { id: 'STARRED', name: 'STARRED', type: 'system' },
              { id: 'UNREAD', name: 'UNREAD', type: 'system' },
              { id: 'DRAFT', name: 'DRAFT', type: 'system' },
              { id: 'Label_123', name: 'Projects/Active', type: 'user' },
              { id: 'Label_456', name: 'Projects/Archived', type: 'user' },
              { id: 'Label_789', name: 'Priority', type: 'user' },
            ],
          },
        }),
      },
    },
  };
  return gmail as any;
}

function createMockCalendar(overrides: Record<string, any> = {}) {
  const calendar = {
    events: {
      list: vi.fn().mockResolvedValue({
        data: {
          items: [
            {
              id: 'event1',
              summary: 'Team Standup',
              start: { dateTime: '2026-02-15T09:00:00-08:00' },
              end: { dateTime: '2026-02-15T09:30:00-08:00' },
              attendees: [
                { email: 'maxx@engramcompute.com', responseStatus: 'accepted' },
                { email: 'jane@engramcompute.com', responseStatus: 'needsAction' },
                { email: 'bob@engramcompute.com', responseStatus: 'declined' },
              ],
              location: 'Zoom - https://zoom.us/j/123456789',
              description: 'Daily team standup',
              htmlLink: 'https://calendar.google.com/event?id=event1',
            },
            {
              id: 'event2',
              summary: 'Product Launch',
              start: { date: '2026-02-20' },
              end: { date: '2026-02-21' },
              attendees: [],
              location: '',
              description: 'Product launch all-hands',
              htmlLink: 'https://calendar.google.com/event?id=event2',
            },
          ],
          ...overrides.eventsListData,
        },
      }),
      insert: vi.fn().mockResolvedValue({
        data: {
          id: 'new-event-1',
          summary: 'New Strategy Meeting',
          start: { dateTime: '2026-02-25T10:00:00-08:00' },
          end: { dateTime: '2026-02-25T11:30:00-08:00' },
          attendees: [
            { email: 'maxx@engramcompute.com', responseStatus: 'accepted' },
            { email: 'team@engramcompute.com', responseStatus: 'needsAction' },
          ],
          location: 'Main Conference Room',
          description: 'Discussing Q2 strategy',
        },
      }),
      patch: vi.fn().mockResolvedValue({
        data: {
          id: 'event1',
          summary: 'Team Standup Updated',
          start: { dateTime: '2026-02-15T10:00:00-08:00' },
          end: { dateTime: '2026-02-15T10:30:00-08:00' },
          attendees: [
            { email: 'maxx@engramcompute.com', responseStatus: 'accepted' },
            { email: 'jane@engramcompute.com', responseStatus: 'needsAction' },
          ],
          location: 'Google Meet',
          description: 'Updated description',
        },
      }),
      delete: vi.fn().mockResolvedValue({}),
    },
  };
  return calendar as any;
}

// ===== GMAIL INTEGRATION TESTS =====

describe('Gmail Integration: Thread Workflow', () => {
  let gmail: any;

  beforeEach(() => {
    gmail = createMockGmail();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists threads and gets thread details', async () => {
    const threadsList = await handleListThreads(gmail, {});
    expect(threadsList.threads).toHaveLength(2);
    expect(threadsList.threads[0].id).toBe('thread1');
    expect(threadsList.count).toBe(2);
    expect(threadsList.next_page_token).toBe('page2');

    const thread = await handleGetThread(gmail, { thread_id: 'thread1' });

    expect(thread.thread_id).toBe('thread1');
    expect(thread.subject).toBe('CO2 regulator quote');
    expect(thread.messages).toHaveLength(2);

    const msg1 = thread.messages[0];
    expect(msg1.id).toBe('msg1');
    expect(msg1.from).toBe('Max <maxx@engramcompute.com>');
    expect(msg1.to).toBe('sales@vendor.com>');
    expect(msg1.body_text).toBe(
      'Hi,\n\nI\'m looking to purchase CO2 regulators for our lab. Please provide a quote for 50 units of Model A.'
    );

    const msg2 = thread.messages[1];
    expect(msg2.id).toBe('msg2');
    expect(msg2.from).toBe('Sales <sales@vendor.com>');
    expect(msg2.to).toBe('maxx@engramcompute.com>');
    expect(msg2.body_text).toContain('Thanks Max!');
    expect(msg2.body_text).toContain('Model A: $120/unit');
    expect(msg2.body_text).toContain('Model B: $150/unit');

    expect(msg2.body_text).not.toContain('<html>');
    expect(msg2.body_text).not.toContain('<p>');
    expect(msg2.body_text).not.toContain('</html>');
  });

  it('strips quotes and signatures from thread messages', async () => {
    const thread = await handleGetThread(gmail, { thread_id: 'thread2' });

    expect(thread.messages[0].from).toBe('Jane <jane@example.com>');
    expect(thread.messages[0].body_text).toContain('Can we meet tomorrow at 3pm');

    expect(thread.messages[0].body_text).not.toContain('Original message content');
    expect(thread.messages[0].body_text).not.toContain('Jane Smith');
    expect(thread.messages[0].body_text).not.toContain('Senior Product Manager');
  });

  it('properly truncates long messages', async () => {
    const longBody = 'A'.repeat(5000);

    const customGmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'thread-long',
            snippet: 'Long message',
            messages: [
              {
                id: 'msg-long',
                internalDate: '1770138900000',
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Long message' },
                    { name: 'From', value: 'test@test.com>' },
                    { name: 'To', value: 'test@test.com>' },
                  ],
                  mimeType: 'text/plain',
                  body: {
                    data: Buffer.from(longBody).toString('base64url'),
                  },
                },
                labelIds: ['INBOX'],
              },
            ],
          },
        }),
      },
    });

    const thread = await handleGetThread(customGmail, { thread_id: 'thread-long' });
    const body = thread.messages[0].body_text as string;

    expect(body.length).toBeLessThan(3000); // Approximate - allows room for truncation marker
    expect(body).toContain('[truncated:');
  });
});

describe('Gmail Integration: Draft Workflow', () => {
  let gmail: any;

  beforeEach(() => {
    gmail = createMockGmail();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('creates, updates, and deletes a draft', async () => {
    const createResult = await handleCreateDraft(gmail, {
      to: 'team@engramcompute.com>',
      subject: 'New Project Proposal',
      body: 'Hi team,\n\nI\'d like to propose a new project for Q2.\n\nDetails:\n1. Phase 1: Research\n2. Phase 2: Development\n3. Phase 3: Launch\n\nLet me know your thoughts.\n\nThanks,\nMax',
    });

    expect(createResult.id).toBe('draft1');
    expect(createResult.msg_id).toBe('msg4');
    expect(gmail.users.drafts.create).toHaveBeenCalledTimes(1);

    const createCall = gmail.users.drafts.create.mock.calls[0][0];
    expect(createCall.userId).toBe('me');

    const updateResult = await handleUpdateDraft(gmail, {
      draft_id: 'draft1',
      to: 'team@engramcompute.com>',
      subject: 'Updated Project Proposal',
      body: 'Hi team,\n\nI\'d like to propose a new project for Q2.\n\nDetails:\n1. Phase 1: Research\n2. Phase 2: Development\n3. Phase 3: Launch\n4. Phase 4: Maintenance\n\nLet me know your thoughts.\n\nThanks,\nMax',
    });

    expect(updateResult.id).toBe('draft1');
    expect(gmail.users.drafts.update).toHaveBeenCalledTimes(1);

    const updateCall = gmail.users.drafts.update.mock.calls[0][0];
    expect(updateCall.id).toBe('draft1');

    await handleDeleteDraft(gmail, { draft_id: 'draft1' });
    expect(gmail.users.drafts.delete).toHaveBeenCalledTimes(1);
    expect(gmail.users.drafts.delete).toHaveBeenCalledWith({
      userId: 'me',
      id: 'draft1',
    });
  });

  it('creates draft in a thread with proper threading headers', async () => {
    const customGmail = createMockGmail({
      draftsMethods: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'draft-thread',
            message: {
              id: 'msg-draft',
              threadId: 'thread1',
              payload: {},
            },
          },
        }),
      },
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'thread1',
            messages: [
              {
                id: 'msg1',
                payload: {
                  headers: [
                    { name: 'Message-ID', value: '<msg1@mail.gmail.com>' },
                  ],
                },
              },
            ],
          },
        }),
      },
    });

    await handleCreateDraft(customGmail, {
      to: 'test@test.com>',
      subject: 'Re: Test',
      body: 'Reply',
      thread_id: 'thread1',
    });

    const createCall = customGmail.users.drafts.create.mock.calls[0][0];
    const rawMessage = Buffer.from(createCall.requestBody.message.raw, 'base64url').toString('utf-8');

    expect(rawMessage).toContain('In-Reply-To:');
    expect(rawMessage).toContain('References:');
  });
});

// ===== CALENDAR INTEGRATION TESTS =====

describe('Calendar Integration: Event CRUD Workflow', () => {
  let calendar: any;

  beforeEach(() => {
    calendar = createMockCalendar();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists, creates, updates, and deletes events', async () => {
    const eventsList = await handleListEvents(calendar, {});
    expect(eventsList.events).toHaveLength(2);

    const standup = eventsList.events[0];
    expect(standup.id).toBe('event1');
    expect(standup.summary).toBe('Team Standup');
    expect(standup.start).toBe('2026-02-15T09:00:00-08:00');
    expect(standup.end).toBe('2026-02-15T09:30:00-08:00');
    expect(standup.location).toBe('Zoom - https://zoom.us/j/123456789');
    expect(standup.description).toBe('Daily team standup');
    expect(standup.attendees).toHaveLength(3);
    expect(standup.attendees).toContain('maxx@engramcompute.com');

    const launch = eventsList.events[1];
    expect(launch.id).toBe('event2');
    expect(launch.summary).toBe('Product Launch');
    expect(launch.start).toBe('2026-02-20');
    expect(launch.end).toBe('2026-02-21');
    expect(launch).not.toHaveProperty('attendees');
    expect(launch).not.toHaveProperty('location');
    expect(launch.description).toBe('Product launch all-hands'); // Not stripped (non-empty)

    const createResult = await handleCreateEvent(calendar, {
      summary: 'New Strategy Meeting',
      start: '2026-02-25T10:00:00-08:00',
      end: '2026-02-25T11:30:00-08:00',
      description: 'Discussing Q2 strategy',
      attendees: ['maxx@engramcompute.com', 'team@engramcompute.com'],
      location: 'Main Conference Room',
    });

    expect(createResult.id).toBe('new-event-1');
    expect(createResult.summary).toBe('New Strategy Meeting');
    expect(createResult.location).toBe('Main Conference Room');

    const updateResult = await handleUpdateEvent(calendar, {
      event_id: 'event1',
      summary: 'Team Standup Updated',
      start: '2026-02-15T10:00:00-08:00',
      end: '2026-02-15T10:30:00-08:00',
      location: 'Google Meet',
      description: 'Updated description',
    });

    expect(updateResult.id).toBe('event1');
    expect(updateResult.summary).toBe('Team Standup Updated');
    expect(updateResult.location).toBe('Google Meet');

    await handleDeleteEvent(calendar, { event_id: 'event1' });
    expect(calendar.events.delete).toHaveBeenCalledTimes(1);
    expect(calendar.events.delete).toHaveBeenCalledWith({
      calendarId: 'primary',
      eventId: 'event1',
    });
  });

  it('handles all-day events correctly', async () => {
    const result = await handleCreateEvent(calendar, {
      summary: 'Company Holiday',
      start: '2026-03-01',
      end: '2026-03-02',
    });

    const createCall = calendar.events.insert.mock.calls[0][0];
    expect(createCall.requestBody.start).toEqual({ date: '2026-03-01' });
    expect(createCall.requestBody.end).toEqual({ date: '2026-03-02' });
  });
});

// ===== LABELS INTEGRATION TESTS =====

describe('Labels Integration', () => {
  let gmail: any;

  beforeEach(() => {
    gmail = createMockGmail();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists all labels with correct typing', async () => {
    const result = await handleListLabels(gmail);

    expect(result.labels).toHaveLength(9);

    const inbox = result.labels.find((l: any) => l.id === 'INBOX');
    expect(inbox).toBeDefined();
    expect(inbox.type).toBe('system');

    const projectsActive = result.labels.find((l: any) => l.id === 'Label_123');
    expect(projectsActive).toBeDefined();
    expect(projectsActive.name).toBe('Projects/Active');
    expect(projectsActive.type).toBe('user');

    const priority = result.labels.find((l: any) => l.id === 'Label_789');
    expect(priority.type).toBe('user');
  });
});

// ===== ERROR HANDLING TESTS =====

describe('Error Handling: API Failures', () => {
  it('handles Gmail list threads API failure', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        list: vi.fn().mockRejectedValue(new Error('API quota exceeded')),
      },
    });

    await expect(handleListThreads(gmail, {})).rejects.toThrow('API quota exceeded');
  });

  it('handles Gmail get thread API failure', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockRejectedValue(new Error('Thread not found')),
      },
    });

    await expect(handleGetThread(gmail, { thread_id: 'invalid' })).rejects.toThrow(
      'Thread not found'
    );
  });

  it('handles draft creation API failure', async () => {
    const gmail = createMockGmail({
      draftsMethods: {
        create: vi.fn().mockRejectedValue(new Error('Invalid recipient')),
      },
    });

    await expect(
      handleCreateDraft(gmail, {
        to: 'invalid-email',
        subject: 'Test',
        body: 'Test',
      })
    ).rejects.toThrow('Invalid recipient');
  });

  it('handles Calendar API failure', async () => {
    const calendar = createMockCalendar();
    calendar.events.list = vi.fn().mockRejectedValue(new Error('Calendar API error'));

    await expect(handleListEvents(calendar, {})).rejects.toThrow('Calendar API error');
  });
});

// ===== EDGE CASES TESTS =====

describe('Edge Cases: Empty and Null Data', () => {
  it('handles empty threads list', async () => {
    const gmail = createMockGmail({
      threadsListData: {
        threads: [],
      },
    });

    const result = await handleListThreads(gmail, {});
    expect(result.threads).toHaveLength(0);
    expect(result.count).toBe(0);
  });

  it('handles thread with no messages', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'empty-thread',
            messages: [],
          },
        }),
      },
    });

    const result = await handleGetThread(gmail, { thread_id: 'empty-thread' });
    expect(result.messages).toHaveLength(0);
  });

  it('handles empty labels list', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({ data: { labels: [] } }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels).toHaveLength(0);
  });

  it('handles null labels response', async () => {
    const gmail = {
      users: {
        labels: {
          list: vi.fn().mockResolvedValue({ data: {} }),
        },
      },
    } as any;

    const result = await handleListLabels(gmail);
    expect(result.labels).toHaveLength(0);
  });

  it('handles empty events list', async () => {
    const calendar = createMockCalendar({
      eventsListData: {
        items: [],
      },
    });

    const result = await handleListEvents(calendar, {});
    expect(result.events).toHaveLength(0);
  });
});

// ===== BUG FIX VERIFICATION TESTS =====

describe('Bug Fix Verification', () => {
  it('BUG-001: Draft update preserves body content', async () => {
    const gmail = createMockGmail({
      draftsMethods: {
        create: vi.fn().mockResolvedValue({
          data: {
            id: 'draft1',
            message: {
              id: 'msg1',
              threadId: null,
              payload: {},
            },
          },
        }),
        update: vi.fn().mockResolvedValue({
          data: {
            id: 'draft1',
            message: {
              id: 'msg1',
              threadId: null,
              payload: {},
            },
          },
        }),
      },
    });

    await handleCreateDraft(gmail, {
      to: 'test@test.com>',
      subject: 'Test',
      body: 'Original content',
    });

    await handleUpdateDraft(gmail, {
      draft_id: 'draft1',
      to: 'test@test.com>',
      subject: 'Test',
      body: 'Original content\n\nAdded note',
    });

    const updateCall = gmail.users.drafts.update.mock.calls[0][0];
    const rawMessage = Buffer.from(updateCall.requestBody.message.raw, 'base64url').toString('utf-8');

    expect(rawMessage).toContain('Original content');
    expect(rawMessage).toContain('Added note');
  });

  it('BUG-013: Quoted text is stripped from messages', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'thread-with-quote',
            messages: [
              {
                id: 'msg1',
                internalDate: '1770138900000',
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Test' },
                    { name: 'From', value: 'test@test.com>' },
                  ],
                  mimeType: 'text/plain',
                  body: {
                    data: Buffer.from(
                      'New content here\n\nOn Feb 3, 2026, at 9:15 AM, Test wrote:\n> This is quoted\n> This is also quoted'
                    ).toString('base64url'),
                  },
                },
                labelIds: ['INBOX'],
              },
            ],
          },
        }),
      },
    });

    const result = await handleGetThread(gmail, { thread_id: 'thread-with-quote' });
    expect(result.messages[0].body_text).toContain('New content here');
    expect(result.messages[0].body_text).not.toContain('This is quoted');
  });

  it('BUG-014: Signatures are stripped', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'thread-with-sig',
            messages: [
              {
                id: 'msg1',
                internalDate: '1770138900000',
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Test' },
                    { name: 'From', value: 'test@test.com>' },
                  ],
                  mimeType: 'text/plain',
                  body: {
                    data: Buffer.from(
                      'Main message content\n\nBest regards,\nJohn Doe\nCEO\nAcme Corp'
                    ).toString('base64url'),
                  },
                },
                labelIds: ['INBOX'],
              },
            ],
          },
        }),
      },
    });

    const result = await handleGetThread(gmail, { thread_id: 'thread-with-sig' });
    expect(result.messages[0].body_text).toContain('Main message content');
    expect(result.messages[0].body_text).not.toContain('John Doe');
    expect(result.messages[0].body_text).not.toContain('CEO');
  });

  it('BUG-007: XSS prevention - HTML tags are stripped', async () => {
    const gmail = createMockGmail({
      threadsMethods: {
        get: vi.fn().mockResolvedValue({
          data: {
            id: 'thread-with-html',
            messages: [
              {
                id: 'msg1',
                internalDate: '1770138900000',
                payload: {
                  headers: [
                    { name: 'Subject', value: 'Test' },
                    { name: 'From', value: 'test@test.com>' },
                  ],
                  mimeType: 'text/html',
                  body: {
                    data: Buffer.from(
                      '<p>Message content</p><script>alert("XSS")</script>'
                    ).toString('base64url'),
                  },
                },
                labelIds: ['INBOX'],
              },
            ],
          },
        }),
      },
    });

    const result = await handleGetThread(gmail, { thread_id: 'thread-with-html' });
    // BUG-007: HTML tags are stripped to prevent XSS
    expect(result.messages[0].body_text).not.toContain('<p>');
    expect(result.messages[0].body_text).not.toContain('</p>');
    expect(result.messages[0].body_text).not.toContain('<script>');
    expect(result.messages[0].body_text).not.toContain('</script>');
    // Text content is preserved (not running as script due to stripped tags)
    expect(result.messages[0].body_text).toContain('Message content');
  });
});
