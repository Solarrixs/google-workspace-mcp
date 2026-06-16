import { execFile } from 'child_process';

function escapeOsascript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function notify(title: string, message: string, sound: string = 'Glass'): void {
  if (process.platform !== 'darwin') {
    console.log(`[Notification] ${title}: ${message}`);
    return;
  }

  const escapedTitle = escapeOsascript(title);
  const escapedMessage = escapeOsascript(message);
  const script = `display notification "${escapedMessage}" with title "${escapedTitle}" sound name "${sound}"`;

  execFile('osascript', ['-e', script], (err) => {
    if (err) {
      console.error('Notification failed:', err.message);
    }
  });
}

export function notifyDraftCreated(email: { from: string; subject: string; accountAlias: string }): void {
  notify(
    `Draft Created (${email.accountAlias})`,
    `Re: ${email.subject}\nFrom: ${email.from}`
  );
}

export function notifyNudgeDrafted(nudge: { recipientEmail: string; originalSubject: string; accountAlias: string }): void {
  notify(
    `Follow-up Drafted (${nudge.accountAlias})`,
    `Nudge: ${nudge.originalSubject}\nTo: ${nudge.recipientEmail}`
  );
}

export function notifyError(message: string): void {
  notify('Email Watcher Error', message, 'Basso');
}
