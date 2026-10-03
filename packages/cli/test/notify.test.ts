import { describe, expect, it } from 'vitest';
import { escapeAppleScript, notificationScript, sendNotification } from '../src/notify.ts';

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
    const ok = await sendNotification('Link copied', 'u"rl', 'darwin', async (cmd, args) => {
      calls.push([cmd, args]);
      return true;
    });
    expect(ok).toBe(true);
    expect(calls).toEqual([
      ['/usr/bin/osascript', ['-e', notificationScript('Link copied', 'u"rl')]],
    ]);
  });

  it('is a no-op that never runs anything on non-darwin platforms', async () => {
    for (const platform of ['linux', 'win32'] as const) {
      let ran = false;
      const ok = await sendNotification('s', 'b', platform, async () => {
        ran = true;
        return true;
      });
      expect(ok).toBe(false);
      expect(ran).toBe(false);
    }
  });

  it('returns false when osascript fails', async () => {
    expect(await sendNotification('s', 'b', 'darwin', async () => false)).toBe(false);
  });
});
