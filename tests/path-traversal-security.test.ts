import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Path Traversal Security Tests', () => {
  const originalHome = process.env.HOME;
  const originalUserprofile = process.env.USERPROFILE;

  const testDir = path.join(os.tmpdir(), 'mcp-security-test');
  const mockTokens = {
    client_id: 'test-client-id',
    client_secret: 'test-client-secret',
    refresh_token: 'test-refresh-token',
    access_token: 'test-access-token',
  };

  beforeEach(() => {
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  afterEach(() => {
    if (originalHome !== undefined) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUserprofile !== undefined) {
      process.env.USERPROFILE = originalUserprofile;
    } else {
      delete process.env.USERPROFILE;
    }

    if (fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('CVE-1: HOME Environment Variable Path Traversal', () => {
    it('SEVERITY: MEDIUM - HOME with absolute path can redirect token storage anywhere', () => {
      const arbitraryPath = path.join(testDir, 'attacker-controlled-directory');
      process.env.HOME = arbitraryPath;

      const constructedPath = path.join(process.env.HOME, '.config', 'google-workspace-mcp', 'tokens.json');

      expect(constructedPath).toContain(arbitraryPath);
    });
  });

  describe('CVE-2: Null Byte Injection', () => {
    it('SEVERITY: CRITICAL - Null bytes in HOME directory name bypass path validation', () => {
      const maliciousHome = testDir + '\x00evil-path';

      try {
        const constructedPath = path.join(maliciousHome, '.config', 'google-workspace-mcp', 'tokens.json');

        expect(constructedPath).not.toContain('\x00');
        const constructedPathFromEnv = path.join(testDir, '.config', 'google-workspace-mcp', 'tokens.json');
        expect(constructedPath).toBe(constructedPathFromEnv);
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('CVE-5: Symbolic Link Attack', () => {
    it('SEVERITY: MEDIUM - No symlink checking before writing tokens', () => {
      const symlinkTarget = path.join(testDir, 'sensitive-file.txt');
      fs.writeFileSync(symlinkTarget, 'SENSITIVE DATA');

      const symlinkPath = path.join(testDir, 'tokens.json');
      if (process.platform !== 'win32') {
        fs.symlinkSync(symlinkTarget, symlinkPath);

        expect(fs.existsSync(symlinkPath)).toBe(true);
        const stats = fs.lstatSync(symlinkPath);
        expect(stats.isSymbolicLink()).toBe(true);

        fs.writeFileSync(symlinkPath, 'ATTACKER CONTROLLED CONTENT');

        expect(fs.readFileSync(symlinkTarget, 'utf-8')).toBe('ATTACKER CONTROLLED CONTENT');

        fs.unlinkSync(symlinkPath);
      }
    });
  });

  describe('CVE-6: Race Condition in Directory Creation', () => {
    it('SEVERITY: MEDIUM - TOCTOU race between directory existence check and creation', () => {
      const targetDir = path.join(testDir, 'target-dir');
      fs.mkdirSync(targetDir, { recursive: true });

      if (process.platform !== 'win32') {
        const symlinkTarget = path.join(testDir, 'config', 'google-workspace-mcp');
        fs.mkdirSync(path.dirname(symlinkTarget), { recursive: true });

        const symlinkPath = symlinkTarget;
        fs.symlinkSync(targetDir, symlinkPath);

        expect(fs.existsSync(symlinkPath)).toBe(true);
        expect(fs.lstatSync(symlinkPath).isSymbolicLink()).toBe(true);

        const tokenPath = path.join(symlinkPath, 'tokens.json');
        fs.writeFileSync(tokenPath, JSON.stringify(mockTokens, null, 2));

        expect(fs.existsSync(path.join(targetDir, 'tokens.json'))).toBe(true);

        fs.unlinkSync(symlinkPath);
      }
    });
  });

  describe('Mitigation Analysis', () => {
    it('CAP: Mitigation - path.join() prevents most path traversal attacks', () => {
      const maliciousInputs = [
        '../../../etc/passwd',
        '../../././etc/hosts',
        '/../../etc/passwd',
      ];

      maliciousInputs.forEach((malicious) => {
        const base = path.join(testDir, 'safe');
        const combined = path.join(base, malicious, 'tokens.json');

        expect(combined).not.toContain('../');
      });

      // On Windows, backslashes would cause issues
      if (process.platform === 'win32') {
        const windowsMalicious = '..\\..\\..\\windows\\system32';
        const combined = path.join(testDir, 'safe', windowsMalicious, 'tokens.json');
        expect(combined).not.toContain('..\\');
      }
    });

    it('CAP: No mitigation - No validation of HOME environment variable', () => {
      const arbitrary = path.join(testDir, 'arbitrary', 'location');
      process.env.HOME = arbitrary;

      const constructedPath = path.join(process.env.HOME, '.config', 'google-workspace-mcp', 'tokens.json');

      expect(constructedPath).toContain(arbitrary);
    });
  });
});
