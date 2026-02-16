import { google } from 'googleapis';
import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as url from 'url';
import * as readline from 'readline';


function sanitizeError(error: any): string {
  if (error && error.message) {
    // Remove potential credential strings from error messages
    return error.message
      .replace(/client_id['":\s]*[^\s,}]+/gi, 'client_id: [REDACTED]')
      .replace(/client_secret['":\s]*[^\s,}]+/gi, 'client_secret: [REDACTED]')
      .replace(/refresh_token['":\s]*[^\s,}]+/gi, 'refresh_token: [REDACTED]')
      .replace(/access_token['":\s]*[^\s,}]+/gi, 'access_token: [REDACTED]');
  }
  return 'An error occurred';
}

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

const REDIRECT_URI = 'http://localhost:3000/oauth2callback';

async function prompt(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function main() {
  console.log('=== Google Workspace MCP — OAuth Setup ===\n');
  console.log('Prerequisites:');
  console.log('  1. Go to https://console.cloud.google.com/apis/credentials');
  console.log('  2. Create an OAuth 2.0 Client ID (type: Desktop app)');
  console.log('  3. Enable Gmail API and Google Calendar API');
  console.log('  4. Copy the Client ID and Client Secret\n');

  const clientId = await prompt('Enter Client ID: ');
  const clientSecret = await prompt('Enter Client Secret: ');

  if (!clientId || !clientSecret) {
    console.error('Client ID and Client Secret are required.');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret, REDIRECT_URI);

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent', // Force consent to get refresh token
  });

  console.log('\nOpening browser for authorization...');
  console.log(`If the browser doesn't open, visit this URL:\n\n${authUrl}\n`);

  // Open browser (cross-platform)
  const { exec } = await import('child_process');
  const platform = process.platform;
  let command: string;
  if (platform === 'darwin') {
    command = `open "${authUrl}"`;
  } else if (platform === 'win32') {
    command = `start "" "${authUrl}"`;
  } else {
    command = `xdg-open "${authUrl}"`;
  }
  exec(command);

  // Start local server to capture the callback
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const parsedUrl = url.parse(req.url || '', true);

      if (parsedUrl.pathname === '/oauth2callback') {
        const authCode = parsedUrl.query.code as string;
        const error = parsedUrl.query.error as string;

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h1>Authorization failed</h1><p>${error}</p>`);
          reject(new Error(`Authorization failed: ${error}`));
        } else if (authCode) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(
            '<h1>Authorization successful!</h1><p>You can close this tab and return to the terminal.</p>'
          );
          resolve(authCode);
        }

        server.close();
      }
    });

    server.listen(3000, () => {
      console.log('Waiting for authorization callback on http://localhost:3000 ...');
    });

    // Timeout after 2 minutes
    const timeoutTimer = setTimeout(() => {
      server.close();
      reject(new Error('Authorization timed out after 2 minutes'));
    }, 120000);

    server.on('close', () => {
      clearTimeout(timeoutTimer);
    });
  });

  // Token logging removed for security;

  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.refresh_token) {
    console.error(
      'No refresh token received. Try revoking app access at https://myaccount.google.com/permissions and running setup again.'
    );
    process.exit(1);
  }

  // Save tokens
  const tokenData = {
    client_id: clientId,
    client_secret: clientSecret,
    refresh_token: tokens.refresh_token,
    access_token: tokens.access_token,
    expiry_date: tokens.expiry_date,
  };

  fs.mkdirSync(TOKEN_DIR, { recursive: true });
  fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokenData, null, 2));

  // Token logging removed for security;

  // Quick verification — list first Gmail thread
  console.log('\nVerifying access...');
  oauth2Client.setCredentials(tokens);
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  try {
    const res = await gmail.users.threads.list({
      userId: 'me',
      maxResults: 1,
    });
    console.log(
      `Gmail access OK — found ${res.data.resultSizeEstimate || 0} threads`
    );
  } catch (err: any) {
    console.error(`Gmail verification failed: ${err.message}`);
    // Token logging removed for security;
  }

  try {
    const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
    const calRes = await calendar.events.list({
      calendarId: 'primary',
      maxResults: 1,
      timeMin: new Date().toISOString(),
    });
    console.log(
      `Calendar access OK — found ${calRes.data.items?.length || 0} upcoming events`
    );
  } catch (err: any) {
    console.error(`Calendar verification failed: ${err.message}`);
    // Token logging removed for security;
  }

  console.log('\nSetup complete! The MCP server is ready to use.');
}

main().catch((err) => {
  console.error('Setup failed:', err.message);
  process.exit(1);
});
