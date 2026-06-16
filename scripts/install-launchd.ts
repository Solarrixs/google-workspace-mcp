import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

const PLIST_NAME = 'com.google-workspace-mcp.email-watcher.plist';
const PROJECT_DIR = path.resolve(new URL('..', import.meta.url).pathname);
const SOURCE_PLIST = path.join(PROJECT_DIR, 'launchd', PLIST_NAME);
const DEST_DIR = path.join(os.homedir(), 'Library', 'LaunchAgents');
const DEST_PLIST = path.join(DEST_DIR, PLIST_NAME);

function main(): void {
  if (process.platform !== 'darwin') {
    console.error('launchd is only available on macOS.');
    process.exit(1);
  }

  // Read and customize plist
  let plist = fs.readFileSync(SOURCE_PLIST, 'utf-8');
  plist = plist.replaceAll('__WORKING_DIR__', PROJECT_DIR);

  // Unload existing if present
  try {
    execSync(`launchctl unload "${DEST_PLIST}" 2>/dev/null`, { stdio: 'ignore' });
  } catch {
    // Not loaded — that's fine
  }

  // Write customized plist
  fs.mkdirSync(DEST_DIR, { recursive: true });
  fs.writeFileSync(DEST_PLIST, plist);
  console.log(`Installed plist to: ${DEST_PLIST}`);

  // Load the service
  execSync(`launchctl load "${DEST_PLIST}"`);
  console.log('Email watcher service loaded and running.');
  console.log('Logs: /tmp/email-watcher.log');
  console.log('Errors: /tmp/email-watcher.err');
  console.log(`\nTo stop: launchctl unload "${DEST_PLIST}"`);
}

main();
