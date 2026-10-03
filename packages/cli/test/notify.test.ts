import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { escapeAppleScript, notificationScript, sendNotification } from '../src/notify.ts';

let dir: string;
// An applet folder that does not exist: the tests below must not depend on this machine's install.
let none: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-notify-'));
  none = path.join(dir, 'no-applet');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('escapeAppleScript', () => {
  it('escapes quotes and backslashes so text cannot leave the string literal', () => {
    expect(escapeAppleScript('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeAppleScript('C:\\temp\\x')).toBe('C:\\\\temp\\\\x');
    // A trailing backslash must not escape the closing quote.
    expect(escapeAppleScript('end\\')).toBe('end\\\\');
    expect(escapeAppleScript('"; do shell script "rm -rf ~" --')).toBe(
      '\\"; do shell script \\"rm -rf ~\\" --',
    );
  });

  it('escapes newlines, carriage returns and tabs, and blanks other control characters', () => {
    expect(escapeAppleScript('a\nb\r\nc\td')).toBe('a\\nb\\r\\nc\\td');
    expect(escapeAppleScript('a\u0000b\u001bc\u007fd')).toBe('a b c d');
  });

  it('leaves unicode filenames alone', () => {
    expect(escapeAppleScript('café 日本語 📄.png')).toBe('café 日本語 📄.png');
  });
});

describe('notificationScript', () => {
  it('builds a display notification command with escaped parts', () => {
    expect(notificationScript('Link copied', 'https://fl.test/AAAAAAA1')).toBe(
      'display notification "https://fl.test/AAAAAAA1" with title "r2-fastlink" subtitle "Link copied"',
    );
    const script = notificationScript('x"y', 'a\\"b\nc');
    expect(script).toBe(
      'display notification "a\\\\\\"b\\nc" with title "r2-fastlink" subtitle "x\\"y"',
    );
    expect(script).not.toContain('\n');
  });
});

describe('sendNotification', () => {
  it('runs osascript by absolute path with the escaped script on darwin', async () => {
    const calls: [string, string[]][] = [];
    const ok = await sendNotification(
      'Link copied',
      'u"rl',
      'darwin',
      async (cmd, args) => {
        calls.push([cmd, args]);
        return true;
      },
      none,
    );
    expect(ok).toBe(true);
    expect(calls).toEqual([
      ['/usr/bin/osascript', ['-e', notificationScript('Link copied', 'u"rl')]],
    ]);
  });

  it('is a no-op that never runs anything on non-darwin platforms', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      let ran = false;
      const ok = await sendNotification(
        's',
        'b',
        platform,
        async () => {
          ran = true;
          return true;
        },
        none,
      );
      expect(ok).toBe(false);
      expect(ran).toBe(false);
    }
  });

  it('returns false when osascript fails', async () => {
    expect(await sendNotification('s', 'b', 'darwin', async () => false, none)).toBe(false);
  });
});

describe('sendNotification through the notifier applet', () => {
  const app = () => path.join(dir, 'r2-fastlink.app');
  const pending = () => path.join(dir, 'pending');
  const pendingFiles = () => (fs.existsSync(pending()) ? fs.readdirSync(pending()) : []);

  it('queues the message next to the app and opens the app instead of running osascript', async () => {
    fs.mkdirSync(app());
    const calls: [string, string[]][] = [];
    const ok = await sendNotification(
      'Link copied',
      'https://fl.test/AAAAAAA1',
      'darwin',
      async (cmd, args) => {
        calls.push([cmd, args]);
        return true;
      },
      dir,
    );
    expect(ok).toBe(true);
    expect(calls).toEqual([['/usr/bin/open', ['-g', '-j', app()]]]);
    const [name] = pendingFiles();
    expect(fs.readFileSync(path.join(pending(), name!), 'utf8')).toBe(
      'Link copied\nhttps://fl.test/AAAAAAA1\n',
    );
  });

  it('keeps the queue private (the message holds a link) and leaves no temporary file', async () => {
    fs.mkdirSync(app());
    await sendNotification('s', 'https://fl.test/AAAAAAA1', 'darwin', async () => true, dir);
    const [name] = pendingFiles();
    expect(fs.statSync(pending()).mode & 0o777).toBe(0o700);
    expect(fs.statSync(path.join(pending(), name!)).mode & 0o777).toBe(0o600);
    // A dot file would be invisible to the applet's listing; none may remain after the rename.
    expect(fs.readdirSync(pending())).toEqual([name]);
  });

  it('tightens a queue folder that an older install left open', async () => {
    fs.mkdirSync(app());
    fs.mkdirSync(pending(), { mode: 0o755 });
    fs.chmodSync(pending(), 0o755);
    await sendNotification('s', 'b', 'darwin', async () => true, dir);
    expect(fs.statSync(pending()).mode & 0o777).toBe(0o700);
  });

  it('keeps each notification on one line each and leaves text otherwise untouched', async () => {
    fs.mkdirSync(app());
    await sendNotification(
      'a\nb',
      'x"y\\\r\n$(id) café 📄\u0000z',
      'darwin',
      async () => true,
      dir,
    );
    const [name] = pendingFiles();
    expect(fs.readFileSync(path.join(pending(), name!), 'utf8')).toBe(
      'a b\nx"y\\ $(id) café 📄 z\n',
    );
  });

  it('gives every notification its own file', async () => {
    fs.mkdirSync(app());
    for (let i = 0; i < 3; i++)
      await sendNotification('s', `b${i}`, 'darwin', async () => true, dir);
    expect(pendingFiles()).toHaveLength(3);
  });

  it('falls back to osascript, leaving nothing queued, when the app cannot be opened', async () => {
    fs.mkdirSync(app());
    const calls: string[] = [];
    const ok = await sendNotification(
      's',
      'b',
      'darwin',
      async (cmd) => {
        calls.push(cmd);
        return cmd === '/usr/bin/osascript';
      },
      dir,
    );
    expect(ok).toBe(true);
    expect(calls).toEqual(['/usr/bin/open', '/usr/bin/osascript']);
    expect(pendingFiles()).toEqual([]);
  });

  it('does not touch the applet folder when no app is installed', async () => {
    await sendNotification('s', 'b', 'darwin', async () => true, dir);
    expect(pendingFiles()).toEqual([]);
  });
});
