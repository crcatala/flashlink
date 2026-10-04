import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './paths.ts';

export const NOTIFICATION_TITLE = 'flashlink';

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

/** Absolute path, for the same reason. */
const OPEN = '/usr/bin/open';

/**
 * Where macos/install.sh builds the notifier applet: `<data dir>/notify/flashlink.app`, with a
 * `pending` folder beside it (the applet finds that folder from its own location).
 */
export function notifyDir(env: Record<string, string | undefined> = process.env): string {
  return path.join(dataDir(env), 'notify');
}

let counter = 0;

/**
 * Post through the installed notifier applet. Notifications from plain osascript belong to Script
 * Editor, so a click on one opens Script Editor; the applet's own do nothing when clicked. Returns
 * false (nothing left behind) when the applet is not installed or cannot be started.
 */
async function viaApplet(
  dir: string,
  subtitle: string,
  body: string,
  run: Runner,
): Promise<boolean> {
  const app = path.join(dir, 'flashlink.app');
  if (!fs.existsSync(app)) return false;
  // One line each: the applet splits on line breaks. Control characters have no useful rendering.
  const oneLine = (text: string) => text.replace(/[\u0000-\u001f\u007f]+/g, ' ');
  const pendingDir = path.join(dir, 'pending');
  const name = `${Date.now()}-${process.pid}-${counter++}`;
  const file = path.join(pendingDir, name);
  try {
    // The message holds a link that grants access to the upload: owner only, like history.json.
    fs.mkdirSync(pendingDir, { recursive: true, mode: 0o700 });
    fs.chmodSync(pendingDir, 0o700);
    // Written under a dot name (which the applet's listing skips) and renamed, so the applet can
    // never read half a message.
    const tmp = path.join(pendingDir, `.${name}.tmp`);
    fs.writeFileSync(tmp, `${oneLine(subtitle)}\n${oneLine(body)}\n`, { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    return false;
  }
  // -g: stay in the background, -j: launch hidden.
  if (await run(OPEN, ['-g', '-j', app])) return true;
  fs.rmSync(file, { force: true });
  return false;
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

/**
 * Best-effort macOS notification, through the notifier applet when installed, else osascript.
 * Returns false (silently) elsewhere or if both fail.
 */
export async function sendNotification(
  subtitle: string,
  body: string,
  platform: NodeJS.Platform = process.platform,
  run: Runner = spawnRunner,
  appletDir: string = notifyDir(),
): Promise<boolean> {
  if (platform !== 'darwin') return false;
  if (await viaApplet(appletDir, subtitle, body, run)) return true;
  return run(OSASCRIPT, ['-e', notificationScript(subtitle, body)]);
}
