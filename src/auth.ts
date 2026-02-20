import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { randomBytes } from 'crypto';

function hasNullByte(str: string): boolean {
  return str.includes('\u0000');
}

const TOKEN_DIR = path.join(os.homedir(), '.config', 'google-workspace-mcp');

if (hasNullByte(TOKEN_DIR)) {
  throw new Error('Invalid path: null byte detected in token directory');
}

const TOKEN_PATH = path.join(TOKEN_DIR, 'tokens.json');

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.labels',
  'https://www.googleapis.com/auth/calendar',
];

export { SCOPES, TOKEN_DIR, TOKEN_PATH };

interface StoredTokens {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  client_hash?: string;
  email?: string;
  device_identifier?: string;
}

interface MultiAccountTokenFile {
  version: 2;
  default_account: string;
  accounts: Record<string, StoredTokens>;
}

function loadAccountStore(): MultiAccountTokenFile {
  // First try tokens.json file
  if (fs.existsSync(TOKEN_PATH)) {
    let data: any;
    try {
      const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
      if (!raw.trim()) throw new Error('Empty file');
      data = JSON.parse(raw);
    } catch (e) {
      // Primary file corrupted/empty — try backup
      const backupPath = TOKEN_PATH + '.bak';
      if (fs.existsSync(backupPath)) {
        try {
          const backupRaw = fs.readFileSync(backupPath, 'utf-8');
          data = JSON.parse(backupRaw);
          // Restore the primary file from backup
          const tmpPath = TOKEN_PATH + '.tmp';
          fs.writeFileSync(tmpPath, backupRaw);
          fs.renameSync(tmpPath, TOKEN_PATH);
        } catch {
          throw new Error(
            `Tokens file at ${TOKEN_PATH} and its backup are both corrupted. ` +
            `DO NOT delete the file. The user must manually run 'npm run setup' in the google-workspace-mcp project directory to reconfigure.`
          );
        }
      } else {
        throw new Error(
          `Tokens file at ${TOKEN_PATH} is corrupted (no backup available). ` +
          `DO NOT delete the file. The user must manually run 'npm run setup' in the google-workspace-mcp project directory to reconfigure.`
        );
      }
    }

    // v2 multi-account format
    if (data.version === 2) {
      return data as MultiAccountTokenFile;
    }

    // Legacy flat format — auto-migrate to v2
    const legacy = data as StoredTokens;
    const migrated: MultiAccountTokenFile = {
      version: 2,
      default_account: 'default',
      accounts: { default: legacy },
    };
    fs.mkdirSync(TOKEN_DIR, { recursive: true });
    const tmpPath = TOKEN_PATH + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(migrated, null, 2));
    fs.renameSync(tmpPath, TOKEN_PATH);
    return migrated;
  }

  // Fall back to environment variables
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    return {
      version: 2,
      default_account: 'env',
      accounts: {
        env: {
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        },
      },
    };
  }

  // Identify which env vars are missing for a helpful error
  const missing: string[] = [];
  if (!clientId) missing.push('GOOGLE_CLIENT_ID');
  if (!clientSecret) missing.push('GOOGLE_CLIENT_SECRET');
  if (!refreshToken) missing.push('GOOGLE_REFRESH_TOKEN');

  throw new Error(
    `No credentials found. Missing environment variables: ${missing.join(', ')}. ` +
    `DO NOT delete any files. The user must manually run 'npm run setup' in the google-workspace-mcp project directory, or set all required environment variables.`
  );
}

function resolveAccountAlias(
  store: MultiAccountTokenFile,
  account?: string
): { alias: string; tokens: StoredTokens } {
  const alias = account || store.default_account;
  const tokens = store.accounts[alias];
  if (!tokens) {
    const available = Object.keys(store.accounts).join(', ');
    throw new Error(
      `Account "${alias}" not found. Available accounts: ${available}. Run 'npm run setup' to add a new account.`
    );
  }
  return { alias, tokens };
}

function loadTokens(account?: string): { alias: string; tokens: StoredTokens } {
  const store = loadAccountStore();
  return resolveAccountAlias(store, account);
}

function saveTokens(tokens: StoredTokens, account: string): void {
  let store: MultiAccountTokenFile;

  if (fs.existsSync(TOKEN_PATH)) {
    try {
      const raw = fs.readFileSync(TOKEN_PATH, 'utf-8');
      if (!raw.trim()) throw new Error('Empty file');
      const data = JSON.parse(raw);
      if (data.version === 2) {
        store = data;
      } else {
        store = {
          version: 2,
          default_account: 'default',
          accounts: { default: data },
        };
      }
    } catch {
      // File is corrupted/empty — try the backup before creating empty store
      const backupPath = TOKEN_PATH + '.bak';
      try {
        const backupRaw = fs.readFileSync(backupPath, 'utf-8');
        const backupData = JSON.parse(backupRaw);
        store = backupData.version === 2
          ? backupData
          : { version: 2, default_account: 'default', accounts: { default: backupData } };
      } catch {
        store = {
          version: 2,
          default_account: account,
          accounts: {},
        };
      }
    }
  } else {
    store = {
      version: 2,
      default_account: account,
      accounts: {},
    };
  }

  // Generate device identifier if not present (BUG-047: prevents token replay)
  if (!tokens.device_identifier) {
    tokens.device_identifier = randomBytes(16).toString('hex');
  }

  store.accounts[account] = tokens;
  fs.mkdirSync(TOKEN_DIR, { recursive: true });

  // Atomic write: write to temp file, then rename (rename is atomic on POSIX)
  const tmpPath = TOKEN_PATH + '.tmp';
  const content = JSON.stringify(store, null, 2);
  fs.writeFileSync(tmpPath, content);
  fs.renameSync(tmpPath, TOKEN_PATH);

  // Keep a backup of the last known good state
  try { fs.writeFileSync(TOKEN_PATH + '.bak', content); } catch {}
}

export function getAuthClient(account?: string): OAuth2Client {
  const { alias, tokens } = loadTokens(account);

  const oauth2Client = new google.auth.OAuth2(
    tokens.client_id,
    tokens.client_secret,
    'http://localhost:3000/oauth2callback'
  );

  oauth2Client.setCredentials({
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  });

  // Auto-save refreshed tokens
  oauth2Client.on('tokens', (newTokens) => {
    const updated: StoredTokens = {
      ...tokens,
      access_token: newTokens.access_token || tokens.access_token,
      expiry_date: newTokens.expiry_date || tokens.expiry_date,
    };
    if (newTokens.refresh_token) {
      updated.refresh_token = newTokens.refresh_token;
    }
    saveTokens(updated, alias);
  });

  return oauth2Client;
}

export function getGmailClient(account?: string) {
  return google.gmail({ version: 'v1', auth: getAuthClient(account) });
}

export function getCalendarClient(account?: string) {
  return google.calendar({ version: 'v3', auth: getAuthClient(account) });
}

export function listAccounts(): { accounts: { alias: string; email?: string }[]; default_account: string } {
  const store = loadAccountStore();
  const accounts = Object.entries(store.accounts).map(([alias, tokens]) => ({
    alias,
    email: tokens.email,
  }));
  return { accounts, default_account: store.default_account };
}
