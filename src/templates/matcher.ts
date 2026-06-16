import type { ReplyTemplate } from './loader.js';

export function filterTemplates(
  templates: ReplyTemplate[],
  context: { labels: string[]; subject: string },
  maxTemplates: number
): ReplyTemplate[] {
  const lowSubject = context.subject.toLowerCase();
  const lowLabels = context.labels.map((l) => l.toLowerCase());

  const scored = templates.map((t) => {
    let score = 0;

    // Match by label
    if (t.match_labels?.some((ml) => lowLabels.includes(ml.toLowerCase()))) {
      score += 2;
    }

    // Match by subject keyword
    if (t.match_subject_keywords?.some((kw) => lowSubject.includes(kw.toLowerCase()))) {
      score += 1;
    }

    return { template: t, score };
  });

  // If any matched, return only matched (sorted by score desc)
  const matched = scored.filter((s) => s.score > 0);
  if (matched.length > 0) {
    matched.sort((a, b) => b.score - a.score);
    return matched.slice(0, maxTemplates).map((s) => s.template);
  }

  // No match — return all (capped)
  return templates.slice(0, maxTemplates);
}
