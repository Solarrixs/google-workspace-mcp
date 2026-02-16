import type { gmail_v1 } from 'googleapis';

export async function handleListLabels(gmail: gmail_v1.Gmail) {
  const res = await gmail.users.labels.list({ userId: 'me' });
  const labels = (res.data.labels || []).map((label) => ({
    id: label.id,
    name: label.name || label.id,
    type: label.type?.toLowerCase() ?? 'user',
  }));

  return { labels };
}
