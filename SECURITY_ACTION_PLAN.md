# Security Action Plan

**Status:** Active  
**Last Updated:** 2026-02-16  
**Overall Risk Level:** 🔴 **HIGH** - **HALT PRODUCTION USE** until CRITICAL vulnerabilities are fixed

---

## Executive Summary

**Total Vulnerabilities:** 17 unfixed security issues
- **CRITICAL:** 7 (Immediate action required)
- **HIGH:** 5 (Fix within 1 week)
- **MEDIUM:** 5 (Fix within 2-3 weeks)

**Source Documentation:** Consolidated from:
- OAUTH_SECURITY_AUDIT.md
- SECURITY_ASSESSMENT_REPORT.md
- SECURITY_PATH_TRAVERSAL_REPORT.md
- SECURITY_TESTING_SUMMARY.md
- BUGS.md (Security Audit Vulnerabilities section)

---

## 🔴 CRITICAL VULNERABILITIES (Fix Within 24-48 Hours)

### 1. BUG-044: OAuth CSRF Protection Missing
**Severity:** CRITICAL  
**Impact:** Full Gmail/Calendar account takeover  
**File:** `scripts/setup-oauth.ts` (lines 55-59, 82-96)

**Attack Scenario:**
1. Attacker crafts OAuth URL with their `client_id`
2. Sends URL to victim via phishing email
3. Victim clicks, authorizes attacker's app
4. Attacker receives victim's OAuth tokens, gains full account access

**Fix Required:**
```typescript
// 1. Generate random state parameter
import { randomBytes } from 'crypto';
const state = randomBytes(32).toString('hex');

// 2. Store pending states in Set
const pendingStates = new Set<string>();
pendingStates.add(state);

// 3. Add state to Auth URL
const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope,
  state,  // ← ADD THIS
});

// 4. Validate state in callback
if (!pendingStates.has(state)) {
  throw new Error('Invalid state - possible CSRF attack');
}
pendingStates.delete(state);
```

**Test:** Replay same auth URL twice; second attempt should be rejected.

**Estimated Time:** 30 minutes

---

### 2. BUG-047: Refresh Token Replay Attacks
**Severity:** CRITICAL  
**Impact:** Permanent account compromise until tokens manually revoked  
**File:** `src/auth.ts` (lines 89-100)

**Attack Scenario:**
1. Attacker steals refresh_token from victim's system
2. Attacker uses refresh_token from different device
3. System accepts it with no binding to original session/device
4. Permanent unauthorized access until token revoked manually

**Fix Required:**
```typescript
import { randomBytes } from 'crypto';

// 1. Add device binding to per-account token storage (v2 multi-account format)
// In the accounts map: store.accounts[alias].device_identifier
interface StoredTokens {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  access_token?: string;
  expiry_date?: number;
  email?: string;
  device_identifier?: string;  // ← ADD THIS
}

// 2. Generate device ID on first write per account
if (!tokens.device_identifier) {
  tokens.device_identifier = randomBytes(16).toString('hex');
}

// 3. Validate device ID on refresh
if (refreshedTokens.device_identifier !== tokens.device_identifier) {
  throw new Error('Refresh token replay detected from different device');
}

// 4. Prevent concurrent refreshes per account
// saveTokens(updated, alias) already does read-modify-write per account
```

**Test:** Copy refresh_token to another device; attempt refresh should fail.

**Estimated Time:** 45 minutes

---

### 3. BUG-045: Token Leakage in Logs
**Severity:** CRITICAL  
**Impact:** Permanent unauthorized access via log theft  
**File:** `scripts/setup-oauth.ts` (lines 140, 152-154, 167-169, src/auth.ts:39-41, 59-66)

**Attack Scenario:**
1. Attacker gains access to server logs (via misconfigured directory permissions, log aggregation, etc.)
2. Finds unredacted refresh tokens in log output
3. Uses tokens to gain permanent account access
4. Access persists even if original victim changes passwords

**Fix Required:**
```typescript
// Remove all console.log statements with tokens
console.log('Token file:', tokenFile);  // ❌ REMOVE
// Replace with:
console.log('Token file path:', path.basename(tokenFile));  // ✓ SAFE

// In src/auth.ts, replace token logging:
console.log('Loading tokens from:', tokenPath);  // ✓ SAFE
// ❌ console.log('Tokens:', tokens);  // REMOVE

// Add DEBUG flag for sensitive operations
if (process.env.DEBUG === 'true') {
  console.log('DEBUG: Token refresh triggered');
}
```

**Test:** Run setup; search logs for "ya29." (Google token prefix); should return 0 results.

**Estimated Time:** 15 minutes

---

### 4. BUG-046: Credential Exposure in Error Messages
**Severity:** CRITICAL  
**Impact:** Credential theft via error log monitoring  
**File:** `scripts/setup-oauth.ts` (lines 155-157, 170-172, src/auth.ts:32-42)

**Attack Scenario:**
1. System error occurs (network failure, OAuth error, etc.)
2. Error objects containing secrets are logged
3. Attacker with log access extracts credentials
4. Uses credentials to impersonate users or steal tokens

**Fix Required:**
```typescript
// Define safe error interface
interface SafeAuthError {
  message: string;
  code?: string;
}

// Sanitize error before logging
function sanitizeError(error: any): SafeAuthError {
  return {
    message: error.message || 'Unknown error',
    code: error.code || undefined,
  };
}

// Replace all try-catch blocks
try {
  await action();
} catch (error) {
  console.error('Error:', sanitizeError(error));  // ✓ SAFE
  // ❌ console.error('Error:', error);  // DANGEROUS
}
```

**Test:** Trigger various error conditions; logs should contain only message/code, never full error objects.

**Estimated Time:** 20 minutes

---

### 5. BUG-034: HTML Entity XSS in Email Text Pipeline
**Severity:** CRITICAL  
**Impact:** XSS attacks, credential theft, session hijacking  
**File:** `src/gmail/threads.ts` (lines 35-46)

**Attack Scenario:**
```javascript
Input: '<div>Click</div>&lt;script&gt;evil()<;/script&gt;'
Output after current code: 'Click<script>evil()</script>'  // Script executes!
```
Attacker crafts malicious email that executes JavaScript when rendered in victim's browser, stealing cookies, session tokens, or redirecting to phishing sites.

**Fix Required:**
```typescript
function stripHtmlTags(html: string): string {
  // Option 1: Decode entities FIRST, then strip tags
  let text = html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  
  // THEN strip tags
  text = text.replace(/<[^>]*>/g, '');
  
  return text;
}

// Option 2: Use DOMPurify (recommended for production)
import DOMPurify from 'dompurify';

function stripHtmlTags(html: string): string {
  const clean = DOMPurify.sanitize(html, { 
    ALLOWED_TAGS: []  // Remove all tags
  });
  return clean;
}
```

**Test:** Send email with `<div>&lt;script&gt;alert(1)<;/script&gt;</div>`; output should be `alert(1)` (plain text), not script tag.

**Estimated Time:** 30 minutes

---

### 6. BUG-040: Null Byte Path Injection
**Severity:** CRITICAL
**Impact:** Arbitrary file write, token theft, system compromise
**File:** `src/auth.ts` (TOKEN_DIR construction, `saveTokens()`)

**Attack Scenario:**
```javascript
export HOME="/tmp/legit\x00/evil/path"
// Tokens written to /tmp/legit/evil/path/tokens.json (v2 multi-account format)
```
Attacker injects null bytes into environment variables or file paths, bypassing validation checks and redirecting token writes to attacker-controlled locations.

**Fix Required:**
```typescript
// Add null byte validator
function hasNullByte(str: string): boolean {
  return str.includes('\u0000');
}

// Replace path validation (applies to both loadAccountStore and saveTokens)
const tokenDir = path.join(os.homedir(), '.config', 'google-workspace-mcp');

if (hasNullByte(tokenDir)) {
  throw new Error('Invalid path: null byte detected');
}

// Note: saveTokens(tokens, account) writes the full v2 multi-account structure.
// Both loadAccountStore() and saveTokens() use the same TOKEN_PATH.
```

**Test:** Set `HOME=/tmp/path\x00/evil`; token write should fail with null byte error.

**Estimated Time:** 40 minutes

---

### 7. BUG-033: Stack Overflow DoS via Deeply Nested Arrays
**Severity:** CRITICAL  
**Impact:** Server crash requiring restart (DoS)  
**File:** `src/gmail/drafts.ts` (`handleCreateDraft()`, `handleUpdateDraft()`)

**Attack Scenario:**
```javascript
{
  "cc": [[[[[...10000 levels deep...]]]]]  // Creates 10,000 level nesting
}
```
Attacker sends deeply nested array causing recursive processing to exceed maximum call stack size, crashing the server.

**Fix Required:**
```typescript
// Add array depth validator
function validateArrayDepth(arr: any, maxDepth: number = 50, currentDepth: number = 0): void {
  if (currentDepth > maxDepth) {
    throw new Error(`Array nesting depth exceeds limit of ${maxDepth}`);
  }
  
  if (!Array.isArray(arr)) return;
  
  for (const item of arr) {
    if (Array.isArray(item)) {
      validateArrayDepth(item, maxDepth, currentDepth + 1);
    }
  }
}

// Add to handleCreateDraft/handleUpdateDraft
export async function handleCreateDraft(params: CreateDraftParams) {
  const { cc, bcc } = params;
  
  // Validate array depth
  if (cc) validateArrayDepth(cc);
  if (bcc) validateArrayDepth(bcc);
  
  // Rest of implementation...
}
```

**Test:** Send draft with `cc: [[[[[1]]]]]` (depth 5) → success; send with depth 100 → error.

**Estimated Time:** 20 minutes

---

## 🟠 HIGH PRIORITY VULNERABILITIES (Fix Within 1 Week)

### 8. BUG-035: ID Field Injection Attacks
**Severity:** HIGH  
**Impact:** SQL injection, XSS, path traversal  
**Files:** All handler functions (`src/gmail/threads.ts`, `drafts.ts`, `events.ts`)

**Attack Scenario:**
```javascript
// SQL injection in thread_id
gmail_get_thread({ thread_id: "1'; DROP TABLE users; --" })

// XSS in draft_id
gmail_get_thread({ thread_id: "<script>alert('XSS')</script>" })

// Path traversal
gmail_get_thread({ thread_id: "../../../etc/passwd" })
```

**Fix Required:**
```typescript
// Add ID validation utility
function validateId(id: string, fieldName: string): void {
  // Allow alphanumeric, hyphens, underscores only
  const validPattern = /^[a-zA-Z0-9_-]+$/;
  
  if (!validPattern.test(id)) {
    throw new Error(`Invalid ${fieldName}: contains invalid characters`);
  }
  
  // Limit length (Google IDs are typically < 100 chars)
  if (id.length > 200) {
    throw new Error(`Invalid ${fieldName}: exceeds maximum length`);
  }
}

// Add to all handlers
export async function handleGetThread(params: GetThreadParams) {
  validateId(params.thread_id, 'thread_id');
  // Rest of implementation...
}
```

**Estimated Time:** 1 hour

---

### 9. BUG-036: Quote Detection Bypass via HTML Tags
**Severity:** HIGH  
**Impact:** Quote filtering evasion, persistence of quoted content

**Attack Scenario:**
10+ techniques to bypass quote stripping:
- `<On ... wrote:>` (HTML tags)
- `&lt;On ... wrote:&gt;` (Encoded)
- `On ...  wrote:` (Extra spaces)
- `Ｏｎ　...　ｗｒｏｔｅ：` (Full-width Unicode)
- `Ǫn ... wrǭte:` (Lookalike characters)

**Fix Required:**
```typescript
function stripQuotedText(text: string): string {
  // HTML-decode first
  let decoded = text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ');
  
  // Strip HTML tags
  decoded = decoded.replace(/<\/?[a-z][a-z0-9]*[^a-z0-9>]*>/gi, '');
  
  // Quote patterns with fuzzy matching
  const patterns = [
    /On\s+(.+)?\s+wrote:?/i,
    /(On.+at.+)wrote:?/i,
    /___\s*From:/i,
    /^>.+/m,
    // Add encoded variations
    /On\s+&nbsp;(.+)?&nbsp;wrote:?/i,
  ];
  
  for (const pattern of patterns) {
    const match = decoded.match(pattern);
    if (match) {
      const before = decoded.substring(0, match.index);
      if (before.trim().length > 50) {
        return before.trim();
      }
    }
  }
  
  return text;
}
```

**Estimated Time:** 45 minutes

---

### 10. BUG-037: Signature Detection Bypass
**Severity:** HIGH  
**Impact:** Signature filtering evasion

**Attack Scenario:**
Attacker uses alternative signature delimiters not detected:
- `***` instead of `-- `
- `===` instead of `-- `  
- `===` with spaces
- `&lt;page_break&gt;` (HTML entities)
- Emoji delimiters: `✉️`, `📧`, `🔗`

**Fix Required:**
```typescript
function stripSignature(text: string): string {
  const delimiters = [
    /^-- \s*$/m,           // Standard
    /^—\s*$/m,             // Em dash
    /^__\s*$/m,            // Underscores
    /^\*{3,}\s*$/m,        // Asterisks (***)
    /^\={3,}\s*$/m,        // Equals (===)
    /^\+{3,}\s*$/m,        // Pluses (+++)
    /^\#{3,}\s*$/m,        // Hashes (###)
  ];
  
  for (const delimiter of delimiters) {
    const parts = text.split(delimiter);
    if (parts.length > 1) {
      const before = parts[0].trim();
      // Heuristic: signature is short text at end
      const after = parts.slice(1).join('').trim();
      const lines = after.split('\n').filter(l => l.length < 100);
      
      if (lines.length <= 5) {
        return before + '\n\n[signature removed]';
      }
    }
  }
  
  return text;
}
```

**Estimated Time:** 30 minutes

---

### 11. BUG-038: Email Extraction Regex Failures
**Severity:** HIGH  
**Impact:** Parsing errors, lost email addresses

**Attack Scenario:**
Regex fails on:
- `"John <john@example.com>"` (angle brackets)
- `"multiple@emails@test.com"` (multiple @)
- `"test 🔥@example.com"` (emoji before @)
- `"test@sub.domain.co.uk"` (multiple subdomains)

**Fix Required:**
```typescript
// Use RFC 5322 compliant parser
import { parseAddress } from 'email-addresses';

function extractEmails(text: string): string[] {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  
  // Validate with RFC 5322 parser
  const validEmails = matches.filter(email => {
    try {
      const parsed = parseAddress(email);
      return parsed !== null;
    } catch {
      return false;
    }
  });
  
  // Deduplicate
  return [...new Set(validEmails)];
}
```

**Estimated Time:** 20 minutes

---

### 12. BUG-039: Header CRLF Injection
**Severity:** HIGH  
**Impact:** SMTP header injection attacks

**Attack Scenario:**
```javascript
// Attacker injects CRLF to create new headers
subject: "High priority\r\nBcc:attacker@evil.com"
// Results in:
// Subject: High priority
// Bcc: attacker@evil.com  // ← Unintended header!
```

**Fix Required:**
```typescript
function sanitizeHeaderValue(value: string): string {
  // Remove CRLF sequences
  let sanitized = value
    .replace(/\r\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\n/g, ' ');
  
  // Remove null bytes
  sanitized = sanitized.replace(/\u0000/g, '');
  
  // Collapse multiple spaces
  sanitized = sanitized.replace(/ +/g, ' ').trim();
  
  // Limit length (RFC 5322: max 998 chars, safer to use 500)
  if (sanitized.length > 500) {
    sanitized = sanitized.substring(0, 500);
  }
  
  return sanitized;
}

// Apply to all headers in buildRawEmail()
headers['Subject'] = sanitizeHeaderValue(subject);
headers['To'] = sanitizeHeaderValue(to);
// ... etc
```

**Estimated Time:** 25 minutes

---

## 🟡 MEDIUM PRIORITY VULNERABILITIES (Fix Within 2-3 Weeks)

### 13. BUG-042: Symlink Attack on Token Write
**Severity:** MEDIUM
**Impact:** Token theft via symlink manipulation
**File:** `src/auth.ts` (`saveTokens()` — writes v2 multi-account structure)

**Fix Required:**
```typescript
async function atomicSaveTokens(tokens: TokenSet): Promise<void> {
  const tokenPath = getTokenPath();
  const tempPath = `${tokenPath}.tmp.${Date.now()}`;
  
  // Write to temp file
  await fs.writeFile(tempPath, JSON.stringify(tokens, null, 2));
  
  // Verify not a symlink
  const stats = await fs.lstat(tempPath);
  if (stats.isSymbolicLink()) {
    await fs.unlink(tempPath);
    throw new Error('Symlink attack detected');
  }
  
  // Verify file ownership
  const uid = process.getuid?.(); // Unix only
  if (uid !== undefined && stats.uid !== uid) {
    await fs.unlink(tempPath);
    throw new Error('File ownership mismatch');
  }
  
  // Atomic rename
  await fs.rename(tempPath, tokenPath);
}
```

**Estimated Time:** 30 minutes

---

### 14. BUG-043: TOCTOU Race Condition in Token Write
**Severity:** MEDIUM
**Impact:** Token theft via race between directory check and file write
**File:** `src/auth.ts` (`saveTokens()` — reads v2 file, merges account, writes back)

**Fix Required:**
```typescript
// Use atomic directory creation
async function ensureTokenDir(): Promise<string> {
  const dir = path.join(os.homedir(), '.config', 'google-workspace-mcp');

  // Single atomic operation
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  // Verify directory exists and is a directory
  const stats = await fs.stat(dir);
  if (!stats.isDirectory()) {
    throw new Error(`Token directory path exists but is not a directory: ${dir}`);
  }

  return dir;
}

// Combined with atomic save from BUG-042
// Note: saveTokens() does read-modify-write on the v2 multi-account file.
// Atomic write protects all accounts stored in the file.
```

**Estimated Time:** 15 minutes

---

### 15. BUG-048: Memory Exhaustion via Large Payloads
**Severity:** MEDIUM  
**Impact:** DoS via memory exhaustion

**Fix Required:**
```typescript
// Add request size limits
const MAX_QUERY_LENGTH = 2000;
const MAX_BODY_LENGTH = 10 * 1024 * 1024; // 10MB

export async function handleCreateDraft(params: CreateDraftParams) {
  if (params.body && params.body.length > MAX_BODY_LENGTH) {
    throw new Error(`Body exceeds maximum length of ${MAX_BODY_LENGTH} bytes`);
  }
  // ... rest of implementation
}

export async function handleListThreads(params: ListThreadsParams) {
  if (params.query && params.query.length > MAX_QUERY_LENGTH) {
    throw new Error(`Query exceeds maximum length of ${MAX_QUERY_LENGTH} bytes`);
  }
  // ... rest of implementation
}
```

**Estimated Time:** 20 minutes

---

### 16. BUG-049: Control Character Injection
**Severity:** MEDIUM  
**Impact:** Internal system attacks via control characters

**Fix Required:**
```typescript
function sanitizeInput(str: string): string {
  // Remove ASCII control characters except \r, \n, \t
  return str.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

// Apply to all user inputs
Subject: sanitizeInput(subject),
To: sanitizeInput(to),
Body: sanitizeInput(body),
```

**Estimated Time:** 15 minutes

---

### 17. BUG-050: Homograph/Unicode Spoofing
**Severity:** MEDIUM  
**Impact:** Phishing attacks via lookalike domains

**Attack Scenario:**
```javascript
// Legitimate: @gmail.com
// Spoofed:     @gmail®.com, @gmaıl.com, @g⭕⭕gle.com
```

**Fix Required:**
```typescript
import punycode from 'punycode/';

function detectHomographDomain(email: string): boolean {
  const [, domain] = email.split('@');
  if (!domain) return false;
  
  try {
    // Convert to ASCII Punycode
    const asciiDomain = punycode.toASCII(domain);
    
    // Check for mixed scripts
    const hasNonAscii = /[^\x00-\x7F]/.test(domain);
    
    return hasNonAscii;
  } catch {
    return true; // Detected as suspicious
  }
}

// Warn on homograph detection
if (detectHomographDomain(email)) {
  console.warn(`Warning: Email contains potential homograph domain: ${email}`);
}
```

**Estimated Time:** 25 minutes

---

## Proposed Remediation Timeline

### Week 1: CRITICAL Fixes Only
- **Day 1-2:** BUG-044 (OAuth CSRF), BUG-045 (Token Logging), BUG-046 (Credential Exposure)
- **Day 3:** BUG-034 (HTML Entity XSS)
- **Day 4:** BUG-047 (Refresh Token Replay)
- **Day 5:** BUG-040 (Null Byte Injection), BUG-033 (Stack Overflow)

### Week 2-3: HIGH Priority Fixes
- **Week 2:** BUG-035 (ID Injection), BUG-036 (Quote Bypass), BUG-037 (Signature Bypass)
- **Week 3:** BUG-038 (Email Extraction), BUG-039 (Header Injection)

### Week 4-6: MEDIUM Priority Fixes
- **Week 4:** BUG-042 (Symlink), BUG-043 (TOCTOU), BUG-048 (Memory Exhaustion)
- **Week 5:** BUG-049 (Control Characters)
- **Week 6:** BUG-050 (Homograph Spoofing) + Security hardening review

### Post-Remediation: Security Hardening
- Regular security audits (quarterly)
- Dependency updates
- Log monitoring for suspicious activity
- Token rotation policy

---

## Testing Strategy

### Before Each Fix:
1. Create reproduction test for vulnerability
2. Verify exploit works

### After Each Fix:
1. Run reproduction test - should fail
2. Create unit test for fix
3. Integration test with real API mock
4. Add to CI pipeline

### Security Test Suite:
```bash
npm run test:security  # Run all security tests
npm run test:injection  # Run injection tests  
npm run test:auth  # Run OAuth security tests
```

---

## Compliance Impact

**Before Fixes:**
- ❌ OWASP Top 10 A01:2021 FAILED (Broken Access Control)
- ❌ OWASP ASVS V2.8.1 FAILED (CSRF Protection)
- ❌ OAuth 2.0 Security BCP FAILED (Token Binding)
- ❌ GDPR Article 32 AT RISK (Security of Processing)
- ❌ SOC 2 AT RISK (Security Measures)

**After All Fixes:**
- ✅ OWASP Top 10 A01:2021 PASSED
- ✅ OWASP ASVS V2.8.1 PASSED
- ✅ OAuth 2.0 Security BCP PASSED
- ✅ GDPR Article 32 COMPLIANT
- ✅ SOC 2 COMPLIANT

---

## Immediate Actions Required (Today)

1. **Add OAuth state parameter** - CSRF protection
2. **Remove token logging** - Audit all console.log statements
3. **Sanitize error messages** - Review all try-catch blocks
4. **Add null byte validation** - Verify all path operations
5. **Add array depth limits** - Check all array processing

**Estimated total time for CRITICAL fixes:** 6-8 hours

**Recommendation:** Deploy changes immediately after CI passes. Do NOT deploy to production until all CRITICAL fixes complete.
