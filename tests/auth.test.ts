import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted to declare mocks before vi.mock hoisting
const { mockFs, mockOAuth2ClientInstance, mockGoogleAuth, mockGoogleGmail, mockGoogleCalendar } = vi.hoisted(() => {
  const mockOAuth2ClientInstance = {
    setCredentials: vi.fn(),
    on: vi.fn(),
    getAccessToken: vi.fn(),
  };
  return {
    mockFs: {
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
      renameSync: vi.fn(),
    },
    mockOAuth2ClientInstance,
    mockGoogleAuth: {
      OAuth2: vi.fn().mockImplementation(function () { return mockOAuth2ClientInstance; }),
    },
    mockGoogleGmail: vi.fn().mockReturnValue({ gmail: 'instance' }),
    mockGoogleCalendar: vi.fn().mockReturnValue({ calendar: 'instance' }),
  };
});

vi.mock('fs', () => mockFs);

vi.mock('googleapis', () => ({
  google: {
    auth: mockGoogleAuth,
    gmail: mockGoogleGmail,
    calendar: mockGoogleCalendar,
  },
}));

import { getAuthClient, getGmailClient, getCalendarClient, listAccounts } from '../src/auth.js';

// Helper to create v2 multi-account token file JSON
function v2TokenFile(accounts: Record<string, any>, defaultAccount?: string): string {
  return JSON.stringify({
    version: 2,
    default_account: defaultAccount || Object.keys(accounts)[0],
    accounts,
  });
}

// Helper for legacy (flat) token file JSON
function legacyTokenFile(tokens: any): string {
  return JSON.stringify(tokens);
}

describe('BUG-004: Token file corruption crashes server on startup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('throws helpful error when tokens.json contains invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue('{ invalid json }');

    expect(() => getAuthClient()).toThrow(/corrupted/);
    expect(() => getAuthClient()).toThrow(/DO NOT delete/);
  });

  it('throws helpful error when tokens.json read fails', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES: permission denied');
    });

    expect(() => getAuthClient()).toThrow(/corrupted/);
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

  it('provides specific error message listing all missing env vars', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    expect(() => getAuthClient()).toThrow(/GOOGLE_CLIENT_ID/);
    expect(() => getAuthClient()).toThrow(/GOOGLE_CLIENT_SECRET/);
    expect(() => getAuthClient()).toThrow(/GOOGLE_REFRESH_TOKEN/);
    expect(() => getAuthClient()).toThrow(/Missing/i);
  });

  it('identifies specifically which vars are missing when some are set', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    try {
      getAuthClient();
      expect.unreachable('should have thrown');
    } catch (e: any) {
      expect(e.message).toContain('GOOGLE_CLIENT_SECRET');
      expect(e.message).toContain('GOOGLE_REFRESH_TOKEN');
      expect(e.message).not.toContain('GOOGLE_CLIENT_ID');
    }
  });

  it('succeeds when all required env vars are present', () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'test-refresh';

    const client = getAuthClient();
    expect(client).toBeDefined();
    expect(mockGoogleAuth.OAuth2).toHaveBeenCalled();
  });

  it('provides helpful error message with npm run setup suggestion', () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.GOOGLE_REFRESH_TOKEN;

    expect(() => getAuthClient()).toThrow(/npm run setup/);
  });
});

describe('Legacy format auto-migration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('auto-migrates legacy tokens.json to v2 format on disk', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(legacyTokenFile({
      client_id: 'legacy-id',
      client_secret: 'legacy-secret',
      refresh_token: 'legacy-refresh',
    }));

    getAuthClient();

    // Should have written migrated v2 format
    expect(mockFs.writeFileSync).toHaveBeenCalled();
    const firstWrite = JSON.parse(mockFs.writeFileSync.mock.calls[0][1]);
    expect(firstWrite.version).toBe(2);
    expect(firstWrite.default_account).toBe('default');
    expect(firstWrite.accounts.default.client_id).toBe('legacy-id');
  });

  it('does not re-migrate v2 format files', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: {
        client_id: 'work-id',
        client_secret: 'work-secret',
        refresh_token: 'work-refresh',
      },
    }, 'work'));

    getAuthClient();

    // writeFileSync should NOT be called for migration (only if token refresh happens)
    expect(mockFs.writeFileSync).not.toHaveBeenCalled();
  });
});

describe('Multi-account resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('loadTokens with no arg returns default account tokens', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'work-id', client_secret: 'work-secret', refresh_token: 'work-refresh' },
      personal: { client_id: 'personal-id', client_secret: 'personal-secret', refresh_token: 'personal-refresh' },
    }, 'work'));

    getAuthClient();

    expect(mockGoogleAuth.OAuth2).toHaveBeenCalledWith(
      'work-id', 'work-secret', expect.any(String)
    );
  });

  it('loadTokens with explicit alias returns that account tokens', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'work-id', client_secret: 'work-secret', refresh_token: 'work-refresh' },
      personal: { client_id: 'personal-id', client_secret: 'personal-secret', refresh_token: 'personal-refresh' },
    }, 'work'));

    getAuthClient('personal');

    expect(mockGoogleAuth.OAuth2).toHaveBeenCalledWith(
      'personal-id', 'personal-secret', expect.any(String)
    );
  });

  it('throws with available account list when alias not found', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'w', client_secret: 'w', refresh_token: 'w' },
      personal: { client_id: 'p', client_secret: 'p', refresh_token: 'p' },
    }, 'work'));

    expect(() => getAuthClient('nonexistent')).toThrow(/Account "nonexistent" not found/);
    expect(() => getAuthClient('nonexistent')).toThrow(/work/);
    expect(() => getAuthClient('nonexistent')).toThrow(/personal/);
  });
});

describe('File takes precedence over env vars', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('uses tokens.json file when available (file takes precedence over env vars)', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(legacyTokenFile({
      client_id: 'file-id',
      client_secret: 'file-secret',
      refresh_token: 'file-refresh',
    }));

    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'env-refresh';

    getAuthClient();

    const authCall = mockGoogleAuth.OAuth2.mock.calls[0];
    expect(authCall[0]).toBe('file-id');
    expect(authCall[1]).toBe('file-secret');
  });

  it('falls back to env vars when tokens.json does not exist', () => {
    mockFs.existsSync.mockReturnValue(false);

    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'env-refresh';

    getAuthClient();

    const authCall = mockGoogleAuth.OAuth2.mock.calls[0];
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

  it('getGmailClient passes account through to auth', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'work-id', client_secret: 'work-secret', refresh_token: 'work-refresh' },
      personal: { client_id: 'personal-id', client_secret: 'personal-secret', refresh_token: 'personal-refresh' },
    }, 'work'));

    getGmailClient('personal');

    expect(mockGoogleAuth.OAuth2).toHaveBeenCalledWith(
      'personal-id', 'personal-secret', expect.any(String)
    );
  });

  it('getCalendarClient passes account through to auth', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'work-id', client_secret: 'work-secret', refresh_token: 'work-refresh' },
      personal: { client_id: 'personal-id', client_secret: 'personal-secret', refresh_token: 'personal-refresh' },
    }, 'work'));

    getCalendarClient('personal');

    expect(mockGoogleAuth.OAuth2).toHaveBeenCalledWith(
      'personal-id', 'personal-secret', expect.any(String)
    );
  });
});

describe('Token refresh event handler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: {
        client_id: 'test-id',
        client_secret: 'test-secret',
        refresh_token: 'test-refresh',
        access_token: 'old-token',
        expiry_date: 1234567890,
      },
    }, 'work'));
  });

  it('registers tokens event handler on OAuth2Client', () => {
    getAuthClient();

    expect(mockOAuth2ClientInstance.on).toHaveBeenCalledWith('tokens', expect.any(Function));
  });

  it('handles token refresh by writing v2 format with updated tokens', () => {
    getAuthClient();

    const handler = mockOAuth2ClientInstance.on.mock.calls.find((c: any[]) => c[0] === 'tokens')?.[1];

    if (handler) {
      handler({ access_token: 'new-token', expiry_date: 9999999999 });

      // saveTokens writes to .tmp first, then renames. Find the first writeFileSync call (to .tmp)
      const tmpWrite = mockFs.writeFileSync.mock.calls.find((c: any[]) => String(c[0]).endsWith('.tmp'));
      expect(tmpWrite).toBeDefined();
      const written = JSON.parse(tmpWrite![1]);
      expect(written.version).toBe(2);
      expect(written.accounts.work.access_token).toBe('new-token');
      expect(written.accounts.work.refresh_token).toBe('test-refresh'); // preserved
      // Verify atomic rename was called
      expect(mockFs.renameSync).toHaveBeenCalled();
    }
  });

  it('handles rotation of refresh_token when provided', () => {
    getAuthClient();

    const handler = mockOAuth2ClientInstance.on.mock.calls.find((c: any[]) => c[0] === 'tokens')?.[1];

    if (handler) {
      handler({
        access_token: 'new-token',
        expiry_date: 9999999999,
        refresh_token: 'new-refresh',
      });

      const tmpWrite = mockFs.writeFileSync.mock.calls.find((c: any[]) => String(c[0]).endsWith('.tmp'));
      expect(tmpWrite).toBeDefined();
      const written = JSON.parse(tmpWrite![1]);
      expect(written.accounts.work.refresh_token).toBe('new-refresh');
    }
  });

  it('saves refreshed tokens to the correct account slot without clobbering others', () => {
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: {
        client_id: 'work-id', client_secret: 'work-secret',
        refresh_token: 'work-refresh', access_token: 'work-old',
      },
      personal: {
        client_id: 'personal-id', client_secret: 'personal-secret',
        refresh_token: 'personal-refresh', access_token: 'personal-old',
      },
    }, 'work'));

    getAuthClient('work');

    const handler = mockOAuth2ClientInstance.on.mock.calls.find((c: any[]) => c[0] === 'tokens')?.[1];

    if (handler) {
      handler({ access_token: 'work-new-token', expiry_date: 9999999999 });

      const tmpWrite = mockFs.writeFileSync.mock.calls.find((c: any[]) => String(c[0]).endsWith('.tmp'));
      expect(tmpWrite).toBeDefined();
      const written = JSON.parse(tmpWrite![1]);
      expect(written.accounts.work.access_token).toBe('work-new-token');
      // Personal account should be untouched
      expect(written.accounts.personal.access_token).toBe('personal-old');
      expect(written.accounts.personal.client_id).toBe('personal-id');
    }
  });
});

describe('listAccounts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns account aliases, emails, and default from v2 file', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'w', client_secret: 'w', refresh_token: 'w', email: 'max@work.com' },
      personal: { client_id: 'p', client_secret: 'p', refresh_token: 'p', email: 'max@personal.com' },
    }, 'work'));

    const result = listAccounts();

    expect(result.default_account).toBe('work');
    expect(result.accounts).toHaveLength(2);
    expect(result.accounts).toContainEqual({ alias: 'work', email: 'max@work.com' });
    expect(result.accounts).toContainEqual({ alias: 'personal', email: 'max@personal.com' });
  });

  it('returns accounts from env vars as "env" alias', () => {
    mockFs.existsSync.mockReturnValue(false);
    process.env.GOOGLE_CLIENT_ID = 'env-id';
    process.env.GOOGLE_CLIENT_SECRET = 'env-secret';
    process.env.GOOGLE_REFRESH_TOKEN = 'env-refresh';

    const result = listAccounts();

    expect(result.default_account).toBe('env');
    expect(result.accounts).toHaveLength(1);
    expect(result.accounts[0].alias).toBe('env');
    expect(result.accounts[0].email).toBeUndefined();
  });

  it('handles accounts without email field', () => {
    mockFs.existsSync.mockReturnValue(true);
    mockFs.readFileSync.mockReturnValue(v2TokenFile({
      work: { client_id: 'w', client_secret: 'w', refresh_token: 'w' },
    }, 'work'));

    const result = listAccounts();
    expect(result.accounts[0].email).toBeUndefined();
  });
});
