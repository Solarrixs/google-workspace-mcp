import type { EmailContext } from './poll.js';
import type { NudgeCandidate } from './nudge.js';

export function buildEmailPrompt(email: EmailContext, templatesYaml: string): string {
  const lines: string[] = [
    'You are an email assistant. A new email has arrived. Decide whether to draft a reply or skip it.',
    '',
    '## Email Details',
    `- **From**: ${email.from}`,
    `- **To**: ${email.to}`,
    `- **Subject**: ${email.subject}`,
    `- **Date**: ${email.date}`,
    `- **Thread ID**: ${email.threadId}`,
    `- **Labels**: ${email.labels.join(', ')}`,
    `- **Account**: ${email.accountAlias}`,
    '',
    '## Email Body',
    '```',
    email.body,
    '```',
    '',
  ];

  if (templatesYaml) {
    lines.push(
      '## Reply Templates',
      'Use the most appropriate template below as a starting point, or go free-form if none fit.',
      '',
      templatesYaml,
      '',
    );
  }

  lines.push(
    '## Instructions',
    '1. Decide: should this email get a reply? If it\'s a newsletter, notification, automated message, or doesn\'t need a response, skip it.',
    '2. If replying, pick the best template variant (if available) or write a free-form reply.',
    '3. Personalize the reply — don\'t send template text verbatim.',
    '4. Use the `create_draft` tool with:',
    `   - \`thread_id\`: "${email.threadId}"`,
    `   - \`to\`: the sender's email address`,
    `   - \`subject\`: "Re: ${email.subject}"`,
    `   - \`account\`: "${email.accountAlias}"`,
    '5. Keep the reply concise and professional.',
    '6. If skipping, explain briefly why.',
  );

  return lines.join('\n');
}

export function buildNudgePrompt(nudge: NudgeCandidate, templatesYaml: string): string {
  const lines: string[] = [
    'You are an email assistant. A sent email has had no reply and may need a follow-up nudge.',
    '',
    '## Original Email Context',
    `- **Recipient**: ${nudge.recipientName} <${nudge.recipientEmail}>`,
    `- **Subject**: ${nudge.originalSubject}`,
    `- **Sent Date**: ${nudge.sentDate}`,
    `- **Days Since Sent**: ${nudge.daysSinceSent}`,
    `- **Thread ID**: ${nudge.threadId}`,
    `- **Account**: ${nudge.accountAlias}`,
    '',
    '## Original Snippet',
    '```',
    nudge.snippet,
    '```',
    '',
  ];

  if (templatesYaml) {
    lines.push(
      '## Follow-up Templates',
      '',
      templatesYaml,
      '',
    );
  }

  lines.push(
    '## Instructions',
    '1. Draft a brief, professional follow-up (2-3 sentences max).',
    '2. Reference the original email naturally — don\'t just say "following up."',
    '3. Don\'t be pushy or desperate.',
    '4. Use the `create_draft` tool with:',
    `   - \`thread_id\`: "${nudge.threadId}"`,
    `   - \`to\`: "${nudge.recipientEmail}"`,
    `   - \`subject\`: "Re: ${nudge.originalSubject}"`,
    `   - \`account\`: "${nudge.accountAlias}"`,
  );

  return lines.join('\n');
}
