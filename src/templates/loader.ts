import * as fs from 'fs';
import * as path from 'path';
import { parse as parseYaml } from 'yaml';
import { TOKEN_DIR } from '../auth.js';

const TEMPLATES_PATH = path.join(TOKEN_DIR, 'reply-templates.yaml');
const DEFAULT_TEMPLATES_PATH = path.join(
  new URL('..', import.meta.url).pathname,
  '..',
  'reply-templates.default.yaml'
);

export interface TemplateVariant {
  name: string;
  tone: string;
  body: string;
}

export interface ReplyTemplate {
  id: string;
  name: string;
  description: string;
  match_labels?: string[];
  match_subject_keywords?: string[];
  variants: TemplateVariant[];
}

export interface TemplateFile {
  variables: Record<string, string>;
  templates: ReplyTemplate[];
}

export function loadTemplates(): TemplateFile {
  // Copy default templates if user file doesn't exist
  if (!fs.existsSync(TEMPLATES_PATH)) {
    try {
      if (fs.existsSync(DEFAULT_TEMPLATES_PATH)) {
        fs.mkdirSync(TOKEN_DIR, { recursive: true });
        fs.copyFileSync(DEFAULT_TEMPLATES_PATH, TEMPLATES_PATH);
      }
    } catch {
      // Can't copy defaults — return empty
      return { variables: {}, templates: [] };
    }
  }

  try {
    const raw = fs.readFileSync(TEMPLATES_PATH, 'utf-8');
    const parsed = parseYaml(raw) as TemplateFile;
    if (!parsed || !Array.isArray(parsed.templates)) {
      console.warn('Warning: reply-templates.yaml has invalid format, using empty templates');
      return { variables: {}, templates: [] };
    }
    return {
      variables: parsed.variables || {},
      templates: parsed.templates,
    };
  } catch (e) {
    console.warn('Warning: Failed to parse reply-templates.yaml:', e);
    return { variables: {}, templates: [] };
  }
}
