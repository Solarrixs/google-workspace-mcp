import { execSync } from 'child_process';

try {
  const result = execSync(
    './node_modules/.bin/vitest run --reporter=verbose',
    {
      cwd: '/Users/maxxyung/Projects/google-workspace-mcp',
      timeout: 60000,
      encoding: 'utf-8',
      stdio: 'pipe',
      env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' },
    }
  );
  console.log(result);
} catch (err) {
  console.log(err.stdout || '');
  console.error(err.stderr || '');
  process.exit(err.status || 1);
}
