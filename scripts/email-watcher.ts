import { execFile } from 'child_process';
import { promisify } from 'util';
import { getGmailClient, listAccounts } from '../src/auth.js';
import { loadState, saveState, addProcessedMessageId, isProcessed, addNudgedThreadId } from '../src/watcher/state.js';
import { loadConfig } from '../src/watcher/config.js';
import { seedHistoryId, pollForNewMessages, fetchAndProcessMessage } from '../src/watcher/poll.js';
import { checkForStaleThreads } from '../src/watcher/nudge.js';
import { buildEmailPrompt, buildNudgePrompt } from '../src/watcher/prompt.js';
import { notifyDraftCreated, notifyNudgeDrafted, notifyError } from '../src/watcher/notify.js';
import { loadTemplates } from '../src/templates/loader.js';
import { filterTemplates } from '../src/templates/matcher.js';
import { serializeTemplates } from '../src/templates/serializer.js';

const execFileAsync = promisify(execFile);

function log(msg: string): void {
  const ts = new Date().toISOString();
  console.log(`[${ts}] ${msg}`);
}

async function spawnClaude(prompt: string, model: string, timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileAsync('claude', ['-p', prompt, '--model', model], {
      timeout: timeoutMs,
    });
    return stdout;
  } catch (err: any) {
    if (err.killed) {
      throw new Error(`Claude timed out after ${timeoutMs}ms`);
    }
    throw err;
  }
}

async function pollCycle(): Promise<void> {
  const config = loadConfig();
  const state = loadState();

  // Reload templates each cycle (allows hot-editing)
  const templateFile = loadTemplates();

  const { accounts, default_account } = listAccounts();
  log(`Polling ${accounts.length} account(s): ${accounts.map((a) => a.alias).join(', ')}`);

  for (const account of accounts) {
    const alias = account.alias;
    let gmail;
    try {
      gmail = getGmailClient(alias);
    } catch (err: any) {
      log(`[${alias}] Failed to get Gmail client: ${err.message}`);
      continue;
    }

    // Seed history ID on first run
    if (!state.lastHistoryId[alias]) {
      try {
        state.lastHistoryId[alias] = await seedHistoryId(gmail);
        log(`[${alias}] Seeded history ID: ${state.lastHistoryId[alias]}`);
        saveState(state);
        continue; // Skip first poll — just establish baseline
      } catch (err: any) {
        log(`[${alias}] Failed to seed history ID: ${err.message}`);
        continue;
      }
    }

    // Poll for new messages
    try {
      const { messages, newHistoryId } = await pollForNewMessages(
        gmail,
        state.lastHistoryId[alias]!,
        config
      );

      log(`[${alias}] Found ${messages.length} new message(s)`);

      for (const msg of messages) {
        if (isProcessed(state, msg.id)) {
          log(`[${alias}] Skipping already processed: ${msg.id}`);
          continue;
        }

        const email = await fetchAndProcessMessage(gmail, msg.id, config, alias);
        if (!email) {
          log(`[${alias}] Filtered out: ${msg.id}`);
          addProcessedMessageId(state, msg.id);
          continue;
        }

        log(`[${alias}] Processing: "${email.subject}" from ${email.from}`);

        // Match templates
        const matched = config.templates.enabled
          ? filterTemplates(templateFile.templates, { labels: email.labels, subject: email.subject }, config.templates.max_in_prompt)
          : [];
        const templatesYaml = serializeTemplates(matched, templateFile.variables);

        // Build prompt and spawn Claude
        const prompt = buildEmailPrompt(email, templatesYaml);
        try {
          const result = await spawnClaude(prompt, config.model, config.timeout_ms);
          log(`[${alias}] Claude response for ${msg.id}: ${result.substring(0, 200)}`);
          if (config.notify) {
            notifyDraftCreated(email);
          }
        } catch (err: any) {
          log(`[${alias}] Claude failed for ${msg.id}: ${err.message}`);
          if (config.notify) {
            notifyError(`Failed to process email: ${email.subject}`);
          }
        }

        addProcessedMessageId(state, msg.id);
      }

      state.lastHistoryId[alias] = newHistoryId;
    } catch (err: any) {
      log(`[${alias}] Poll error: ${err.message}`);
    }

    // Nudge detection
    if (config.nudge.enabled) {
      try {
        const candidates = await checkForStaleThreads(gmail, state, config, alias);
        if (candidates.length > 0) {
          log(`[${alias}] Found ${candidates.length} nudge candidate(s)`);
        }

        for (const nudge of candidates) {
          log(`[${alias}] Nudging: "${nudge.originalSubject}" to ${nudge.recipientEmail}`);

          // Match follow-up templates
          const matched = config.templates.enabled
            ? filterTemplates(
                templateFile.templates,
                { labels: [], subject: '_nudge_system_' },
                config.templates.max_in_prompt
              )
            : [];
          const templatesYaml = serializeTemplates(matched, templateFile.variables);

          const prompt = buildNudgePrompt(nudge, templatesYaml);
          try {
            const result = await spawnClaude(prompt, config.model, config.timeout_ms);
            log(`[${alias}] Nudge result: ${result.substring(0, 200)}`);
            if (config.notify) {
              notifyNudgeDrafted(nudge);
            }
          } catch (err: any) {
            log(`[${alias}] Nudge Claude failed: ${err.message}`);
          }

          addNudgedThreadId(state, nudge.threadId);
        }
      } catch (err: any) {
        log(`[${alias}] Nudge check error: ${err.message}`);
      }
    }
  }

  state.lastPollTime = new Date().toISOString();
  saveState(state);
}

async function main(): Promise<void> {
  const config = loadConfig();
  log('Email Watcher starting...');
  log(`Poll interval: ${config.poll_interval_ms / 1000}s`);
  log(`Nudge detection: ${config.nudge.enabled ? 'enabled' : 'disabled'}`);
  log(`Templates: ${config.templates.enabled ? 'enabled' : 'disabled'}`);
  log(`Notifications: ${config.notify ? 'enabled' : 'disabled'}`);

  // Immediate first poll
  await pollCycle();

  // Schedule recurring polls
  setInterval(async () => {
    try {
      await pollCycle();
    } catch (err: any) {
      log(`Poll cycle error: ${err.message}`);
      notifyError(err.message);
    }
  }, config.poll_interval_ms);
}

main().catch((err) => {
  console.error('Email Watcher fatal error:', err);
  notifyError(`Fatal: ${err.message}`);
  process.exit(1);
});
