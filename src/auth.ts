import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import * as fs from 'fs';
import * as path from 'path';

const TOKEN_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '~',
  '.config',
  'google-workspace-mcp'
);
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
      data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    } catch (e) {
      throw new Error(
        `Failed to parse tokens file at ${TOKEN_PATH}. The file may be corrupted. ` +
        `Delete it and run 'npm run setup' to reconfigure.`
      );
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
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(migrated, null, 2));
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
    `Run 'npm run setup' first, or set all required environment variables.`
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
      const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
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
      store = {
        version: 2,
        default_account: account,
        accounts: {},
      };
    }
  } else {
    store = {
      version: 2,
      default_account: account,
      accounts: {},
    };
  }

  store.accounts[account] = tokens;
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(store, null, 2));
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
