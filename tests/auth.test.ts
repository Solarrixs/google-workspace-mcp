import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getAuthClient, getGmailClient, getCalendarClient } from '../src/auth.js';

// Mock file system
const mockFs = {
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
};

vi.mock('fs', () => mockFs);

// Mock googleapis
const mockOAuth2ClientInstance = {
  setCredentials: vi.fn(),
  on: vi.fn(),
  getAccessToken: vi.fn(),
};

const mockGoogleAuth = {
  OAuth2Client: vi.fn().mockImplementation(() => mockOAuth2ClientInstance),
};

const mockGoogleGmail = vi.fn().mockReturnValue({ gmail: 'instance' });
const mockGoogleCalendar = vi.fn().mockReturnValue({ calendar: 'instance' });

vi.mock('googleapis', () => ({
  google: {
    auth: mockGoogleAuth,
    gmail: mockGoogleGmail,
    calendar: mockGoogleCalendar,
  },
}));

describe('BUG-004: Token file corruption crashes server on startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws helpful error when tokens.json contains invalid JSON (fix provides context)', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{ invalid json }');

    expect(() => getAuthClient()).toThrow();
    expect(() => getAuthClient()).toThrow(/Failed to parse/);
    expect(() => getAuthClient()).toThrow(/tokens file/);
    expect(() => getAuthClient()).not.toThrow(/^SyntaxError/); // Not raw SyntaxError
  });

  it('throws helpful error when tokens.json read fails', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => getAuthClient()).toThrow(/Failed to parse/);
    expect(() => getAuthClient()).not.toThrow(/^EACCES/); // Wrapped in helpful error
  });
});

describe('BUG-011: Partial env vars give unhelpful error', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    mockFs.existsSync.mockReturnValue(false);
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('provides specific error message listing all missing env vars', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    await expect(getAuthClient()).rejects.toThrow(/GOOGLE_CLIENT_ID/);
    await expect(getAuthClient()).rejects.toThrow(/GOOGLE_CLIENT_SECRET/);
    await expect(getAuthClient()).rejects.toThrow(/GOOGLE_REFRESH_TOKEN/);
    await expect(getAuthClient()).rejects.toThrow(/missing/i);
  });

  it('identifies specifically which vars are missing when some are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    const error = await Promise.reject(() => getAuthClient()).catch(e => e);
    expect(error.message).toContain('GOOGLE_CLIENT_SECRET');
    expect(error.message).toContain('GOOGLE_REFRESH_TOKEN');
    expect(error.message).not.toContain('GOOGLE_CLIENT_ID');
  });

  it('succeeds when all required env vars are present', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';

    const client = getAuthClient();
    expect(client).toBeDefined();
    expect(mockGoogleAuth.OAuth2Client).toHaveBeenCalled();
  });

  it('provides helpful error message with npm run setup suggestion', async () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    const error = await Promise.reject(() => getAuthClient()).catch(e => e);
    expect(error.message).toContain('npm run setup');
  });
});

describe('BUG-026: HOME/USERPROFILE not set falls back to working directory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses tokens.json file when available (file takes precedence over env vars)', async () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      client_id: 'file-id',
      client_secret: 'file-secret',
      refresh_token: 'file-refresh',
    }));

    // Even if env vars are set, file should take precedence
    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'env-refresh';

    getAuthClient();

    const authCall = mockGoogleAuth.OAuth2Client.mock.calls[0];
    expect(authCall[0]).toBe('file-id');
    expect(authCall[1]).toBe('file-secret');
  });

  it('falls back to env vars when tokens.json does not exist', async () => {
    mockFs.existsSync.mockReturnValue(false);

    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'env-refresh';

    getAuthClient();

    const authCall = mockGoogleAuth.OAuth2Client.mock.calls[0];
    expect(authCall[0]).toBe('env-id');
  });
});

describe('Gmail and Calendar client creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';
    mockFs.existsSync.mockReturnValue(false);
  });

  it('getGmailClient creates Gmail client with auth', () => {
    getGmailClient();

    expect(mockGoogleGmail).toHaveBeenCalledWith({
      version: 'v1',
      auth: expect.any(Object),
    });
  });

  it('getCalendarClient creates Calendar client with auth', () => {
    getCalendarClient();

    expect(mockGoogleCalendar).toHaveBeenCalledWith({
      version: 'v3',
      auth: expect.any(Object),
    });
  });

  it('both clients use OAuth2Client for authentication', () => {
    const gmailClient = getGmailClient();
    const calendarClient = getCalendarClient();

    const gmailAuth = mockGoogleGmail.mock.calls[0][1]?.auth;
    const calendarAuth = mockGoogleCalendar.mock.calls[0][1]?.auth;

    expect(gmailAuth).toBeDefined();
    expect(calendarAuth).toBeDefined();
  });
});

describe('Token refresh event handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(JSON.stringify({
      client_id: 'test-id',
      client_secret: 'test-secret',
      refresh_token: 'test-refresh',
      access_token: 'old-token',
      expiry_date: 1234567890,
    }));
  });

  it('registers tokens event handler on OAuth2Client', () => {
    getAuthClient();

    expect(mockOAuth2ClientInstance.on).toHaveBeenCalledWith('tokens', expect.any(Function));
  });

  it('handles token refresh by updating tokens', () => {
    getAuthClient();

    const handler = mockOAuth2ClientInstance.on.mock.calls.find(c => c[0] === 'tokens')?.[1];

    if (handler) {
      handler({ access_token: 'new-token', expiry_date: 9999999999 });

      expect(mockFs.writeFileSync).toHaveBeenCalled();
      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written.access_token).toBe('new-token');
      expect(written.refresh_token).toBe('test-refresh'); // preserved
    }
  });

  it('handles rotation of refresh_token when provided', () => {
    getAuthClient();

    const handler = mockOAuth2ClientInstance.on.mock.calls.find(c => c[0] === 'tokens')?.[1];

    if (handler) {
      handler({
        access_token: 'new-token',
        expiry_date: 9999999999,
        refresh_token: 'new-refresh',
      });

      const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
      expect(written.refresh_token).toBe('new-refresh');
    }
  });
});
