import type { ReplyTemplate, TemplateFile } from './loader.js';

export function serializeTemplates(
  templates: ReplyTemplate[],
  variables: Record<string, string>
): string {
  if (templates.length === 0) return '';

  const lines: string[] = ['# Available Reply Templates', ''];

  for (const t of templates) {
    lines.push(`## ${t.name}`);
    lines.push(`Description: ${t.description}`);
    lines.push('');

    for (const v of t.variants) {
      lines.push(`### ${v.name} (${v.tone})`);
      let body = v.body;
      // Substitute variables
      for (const [key, value] of Object.entries(variables)) {
        if (value) {
          body = body.replaceAll(`{${key}}`, value);
        }
      }
      lines.push(body);
      lines.push('');
    }
  }

  return lines.join('\n');
}
