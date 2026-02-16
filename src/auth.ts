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
}

function loadTokens(): StoredTokens {
  // First try tokens.json file
  if (fs.existsSync(TOKEN_PATH)) {
    const data = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
    return data;
  }

  // Fall back to environment variables
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    return {
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    };
  }

  throw new Error(
    `No credentials found. Run 'npm run setup' first, or set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN environment variables.`
  );
}

function saveTokens(tokens: StoredTokens): void {
  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
}

export function getAuthClient(): OAuth2Client {
  const tokens = loadTokens();

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
    saveTokens(updated);
  });

  return oauth2Client;
}

export function getGmailClient() {
  return google.gmail({ version: 'v1', auth: getAuthClient() });
}

export function getCalendarClient() {
  return google.calendar({ version: 'v3', auth: getAuthClient() });
}
