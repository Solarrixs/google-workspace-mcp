import * as fs from 'fs';
import * as path from 'path';
import { TOKEN_DIR } from '../auth.js';

const CONFIG_PATH = path.join(TOKEN_DIR, 'watcher-config.json');

export interface NudgeConfig {
  enabled: boolean;
  stale_days: number;
  check_interval_hours: number;
  max_per_cycle: number;
}

export interface TemplateConfig {
  enabled: boolean;
  max_in_prompt: number;
}

export interface WatcherConfig {
  poll_interval_ms: number;
  model: string;
  max_body_length: number;
  timeout_ms: number;
  skip_labels: string[];
  skip_senders: string[];
  nudge: NudgeConfig;
  templates: TemplateConfig;
  notify: boolean;
}

const DEFAULT_CONFIG: WatcherConfig = {
  poll_interval_ms: 900_000,
  model: 'sonnet',
  max_body_length: 3000,
  timeout_ms: 120_000,
  skip_labels: [
    'Is Snoozed',
    'AI/AutoArchived',
    'Muted',
    'AI/Marketing',
    'AI/News',
    'AI/Social',
    'AI/Meeting',
    'AI/Travel',
    'CATEGORY_PROMOTIONS',
    'CATEGORY_SOCIAL',
    'CATEGORY_UPDATES',
  ],
  skip_senders: [],
  nudge: {
    enabled: true,
    stale_days: 5,
    check_interval_hours: 6,
    max_per_cycle: 5,
  },
  templates: {
    enabled: true,
    max_in_prompt: 8,
  },
  notify: true,
};

export function loadConfig(): WatcherConfig {
  let userConfig: Partial<WatcherConfig> = {};
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
      if (raw.trim()) {
        userConfig = JSON.parse(raw);
      }
    }
  } catch {
    // Invalid config — use defaults
  }

  return {
    ...DEFAULT_CONFIG,
    ...userConfig,
    nudge: { ...DEFAULT_CONFIG.nudge, ...(userConfig.nudge || {}) },
    templates: { ...DEFAULT_CONFIG.templates, ...(userConfig.templates || {}) },
    skip_labels: userConfig.skip_labels || DEFAULT_CONFIG.skip_labels,
    skip_senders: userConfig.skip_senders || DEFAULT_CONFIG.skip_senders,
  };
}
