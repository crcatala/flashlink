import { spawn } from 'node:child_process';

export const NOTIFICATION_TITLE = 'r2-fastlink';

/** Absolute path: Finder Quick Actions run with a minimal PATH. */
const OSASCRIPT = '/usr/bin/osascript';

/** Runs a command; resolves true when it exits 0. Injectable so tests never spawn osascript. */
export type Runner = (command: string, args: string[]) => Promise<boolean>;

/**
 * Escape text for use inside an AppleScript double-quoted string literal.
 * File names and URLs are untrusted input; never interpolate them raw.
 */
export function escapeAppleScript(text: string): string {
  return text.replace(/[\\"\n\r\t]|[\u0000-\u001f\u007f]/g, (ch) => {
    switch (ch) {
      case '\\':
        return '\\\\';
      case '"':
        return '\\"';
      case '\n':
        return '\\n';
      case '\r':
        return '\\r';
      case '\t':
        return '\\t';
      default:
        return ' '; // other control characters have no useful rendering
    }
  });
}

export function notificationScript(subtitle: string, body: string): string {
  return (
    `display notification "${escapeAppleScript(body)}" ` +
    `with title "${NOTIFICATION_TITLE}" subtitle "${escapeAppleScript(subtitle)}"`
  );
}

const spawnRunner: Runner = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const timer = setTimeout(() => {
      child.kill();
      resolve(false);
    }, 5000);
    child.on('error', () => {
      clearTimeout(timer);
      resolve(false);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0);
    });
  });

/** Best-effort macOS notification. Returns false (silently) elsewhere or if osascript fails. */
export async function sendNotification(
  subtitle: string,
  body: string,
  platform: NodeJS.Platform = process.platform,
  run: Runner = spawnRunner,
): Promise<boolean> {
  if (platform !== 'darwin') return false;
  return run(OSASCRIPT, ['-e', notificationScript(subtitle, body)]);
}
