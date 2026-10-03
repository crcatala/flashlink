import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const macosDir = path.resolve(import.meta.dirname, '..', '..', '..', 'macos');
const wrapper = path.join(macosDir, 'r2fl-quick.sh');
const WORKFLOWS = ['Share via r2-fastlink', 'Share via r2-fastlink (default lifetime)'];

let dir: string;

// A fake `r2fl`: answers `config get defaultTtl`, and records the arguments of `up` (NUL separated
// so that a newline inside an argument stays visible).
const FAKE_R2FL = `#!/bin/sh
if [ "$1" = config ] && [ "$2" = get ] && [ "$3" = defaultTtl ]; then
  [ "\${FAKE_CONFIG_EXIT:-0}" = 0 ] || { [ -z "\${FAKE_CONFIG_ERR-}" ] || echo "$FAKE_CONFIG_ERR" >&2; exit "$FAKE_CONFIG_EXIT"; }
  printf '%s\\n' "\${FAKE_DEFAULT_TTL-1h}"
  exit 0
fi
for a in "$@"; do printf '%s\\0' "$a"; done >> "$FAKE_LOG/r2fl.args"
printf '\\n' >> "$FAKE_LOG/r2fl.args"
exit "\${FAKE_UP_EXIT:-0}"
`;

// A fake `osascript`: logs every argument (one call per line group), and when asked to run the
// picker prints $FAKE_PICK.
const FAKE_OSASCRIPT = `#!/bin/sh
for a in "$@"; do printf '%s\\0' "$a"; done >> "$FAKE_LOG/osascript.args"
printf '\\n' >> "$FAKE_LOG/osascript.args"
case "$*" in
  *"choose from list"*)
    [ "\${FAKE_OSA_EXIT:-0}" = 0 ] || exit "$FAKE_OSA_EXIT"
    printf '%s\\n' "\${FAKE_PICK-}"
    ;;
esac
`;

// Stands in for `/bin/zsh -l`: drops -l and runs the -c script with sh, so "$@" handling is real.
const FAKE_SHELL = `#!/bin/sh
[ "$1" = -l ] || { echo "fake-shell: expected -l first" >&2; exit 64; }
shift
exec /bin/sh "$@"
`;

function write(file: string, content: string, mode = 0o755): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-macos-'));
  write(path.join(dir, 'bin', 'r2fl'), FAKE_R2FL);
  write(path.join(dir, 'fake-osascript'), FAKE_OSASCRIPT);
  write(path.join(dir, 'fake-shell'), FAKE_SHELL);
  fs.mkdirSync(path.join(dir, 'log'));
});

afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

function run(
  script: string,
  args: string[],
  env: Record<string, string> = {},
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync('/bin/sh', [script, ...args], {
    encoding: 'utf8',
    env: {
      PATH: `${path.join(dir, 'bin')}:${process.env.PATH}`,
      HOME: path.join(dir, 'home'),
      FAKE_LOG: path.join(dir, 'log'),
      R2FL_QUICK_SHELL: path.join(dir, 'fake-shell'),
      R2FL_QUICK_OSASCRIPT: path.join(dir, 'fake-osascript'),
      ...env,
    },
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

/** Calls recorded in a log: one array of arguments per call. */
function calls(name: string): string[][] {
  const file = path.join(dir, 'log', name);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter((line, i, all) => line !== '' || i < all.length - 1)
    .filter((line) => line !== '')
    .map((line) => line.split('\0').slice(0, -1));
}

const upCalls = () => calls('r2fl.args');
const osaCalls = () => calls('osascript.args');
const pickerCalls = () => osaCalls().filter((c) => c.join(' ').includes('choose from list'));
const notifications = () => osaCalls().filter((c) => c.join(' ').includes('display notification'));

describe('r2fl-quick --no-prompt', () => {
  it('passes awkward file names to r2fl intact, after --', () => {
    const files = [
      'plain.txt',
      'with space.png',
      `it's "quoted".txt`,
      '-rf',
      '--json',
      '$HOME `id` $(id).txt',
      'semi;colon & amp.txt',
      'café 日本語 📄.png',
      '*.txt',
      '',
    ];
    const r = run(wrapper, ['--no-prompt', ...files]);
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--', ...files]]);
    expect(pickerCalls()).toEqual([]);
  });

  it('asks nothing and uses no --ttl, so the configured default applies', () => {
    run(wrapper, ['--no-prompt', 'a.txt']);
    expect(upCalls()[0]).not.toContain('--ttl');
    expect(osaCalls()).toEqual([]);
  });

  it('propagates the exit code of r2fl', () => {
    for (const code of [1, 2, 3]) {
      fs.rmSync(path.join(dir, 'log'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'log'));
      const r = run(wrapper, ['--no-prompt', 'a.txt'], { FAKE_UP_EXIT: String(code) });
      expect(r.status).toBe(code);
      // r2fl itself reports failures through --notify; the wrapper adds nothing.
      expect(notifications()).toEqual([]);
    }
  });

  it('posts its own notification when the login shell cannot find r2fl or node (127)', () => {
    const r = run(wrapper, ['--no-prompt', 'a.txt'], { FAKE_UP_EXIT: '127' });
    expect(r.status).toBe(127);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toContain('Could not run r2fl');
  });

  it('fails with usage when given no files', () => {
    const r = run(wrapper, []);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('usage');
    expect(upCalls()).toEqual([]);
  });
});

describe('r2fl-quick lifetime picker', () => {
  const cases: [string, string][] = [
    ['15 minutes', '15m'],
    ['1 hour', '1h'],
    ['1 day', '1d'],
    ['7 days', '7d'],
  ];

  it.each(cases)('picking "%s" uploads with --ttl %s', (pick, ttl) => {
    const r = run(wrapper, ['my file.txt', '-x'], { FAKE_PICK: pick });
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--ttl', ttl, '--', 'my file.txt', '-x']]);
  });

  it('lists the standard items with the configured default first and preselected', () => {
    run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour', FAKE_DEFAULT_TTL: '1d' });
    const [call] = pickerCalls();
    // The script comes first as -e options; the list arguments follow: default, then the items.
    const list = call!.slice(call!.lastIndexOf('end run') + 1);
    expect(list).toEqual(['1 day', '15 minutes', '1 hour', '1 day', '7 days']);
  });

  it('preselects 1 hour for the default config', () => {
    run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour' });
    const [call] = pickerCalls();
    expect(call!.slice(call!.lastIndexOf('end run') + 1)[0]).toBe('1 hour');
  });

  it('adds a non-standard default (45m) to the list, preselects it, and uploads with it', () => {
    const r = run(wrapper, ['a.txt'], { FAKE_PICK: '45m', FAKE_DEFAULT_TTL: '45m' });
    expect(r.status).toBe(0);
    const [call] = pickerCalls();
    expect(call!.slice(call!.lastIndexOf('end run') + 1)).toEqual([
      '45m',
      '15 minutes',
      '1 hour',
      '1 day',
      '7 days',
      '45m',
    ]);
    expect(upCalls()).toEqual([['up', '--notify', '--ttl', '45m', '--', 'a.txt']]);
  });

  it('takes the last line of the default, ignoring login-shell noise', () => {
    run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour', FAKE_DEFAULT_TTL: 'Welcome back!\n2h' });
    const [call] = pickerCalls();
    expect(call!.slice(call!.lastIndexOf('end run') + 1)[0]).toBe('2h');
  });

  it('trims whitespace around the default, which r2fl accepts (" 15m")', () => {
    run(wrapper, ['a.txt'], { FAKE_PICK: '15 minutes', FAKE_DEFAULT_TTL: '  15m \t' });
    const [call] = pickerCalls();
    expect(call!.slice(call!.lastIndexOf('end run') + 1)[0]).toBe('15 minutes');
  });

  it.each(['-evil', 'soon', '1 h', '', '(not set)', '15m; id'])(
    'refuses to guess a lifetime when the default is %j',
    (bad) => {
      const r = run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour', FAKE_DEFAULT_TTL: bad });
      expect(r.status).toBe(1);
      expect(pickerCalls()).toEqual([]);
      expect(upCalls()).toEqual([]);
      expect(notifications()).toHaveLength(1);
      expect(notifications()[0]).toContain('Invalid default lifetime');
    },
  );

  it('keeps the AppleScript fixed: config text and file names travel only as arguments', () => {
    run(wrapper, ['"; do shell script "x".txt'], { FAKE_PICK: '1 hour', FAKE_DEFAULT_TTL: '45m' });
    const a = pickerCalls()[0]!;
    const source = a.filter((_, i) => i > 0 && a[i - 1] === '-e').join('\n');
    expect(source).not.toContain('45m');
    expect(source).not.toContain('do shell script');
    run(wrapper, ['other.txt'], { FAKE_PICK: '1 hour', FAKE_DEFAULT_TTL: '3h' });
    const b = pickerCalls()[1]!;
    const sourceB = b.filter((_, i) => i > 0 && b[i - 1] === '-e').join('\n');
    expect(sourceB).toBe(source);
  });

  it.each(['', 'false'])('cancelling (%j) uploads nothing, says nothing and exits 0', (pick) => {
    const r = run(wrapper, ['a.txt'], { FAKE_PICK: pick });
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([]);
    expect(notifications()).toEqual([]);
  });

  it('reports a failing picker instead of uploading with a guessed lifetime', () => {
    const r = run(wrapper, ['a.txt'], { FAKE_OSA_EXIT: '1' });
    expect(r.status).toBe(1);
    expect(upCalls()).toEqual([]);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toContain('Could not show the lifetime picker');
  });

  it('shows what r2fl said when it ran but failed (corrupt config), not a PATH hint', () => {
    const message = 'error: Expected property name or } in JSON at position 2';
    const r = run(wrapper, ['a.txt'], { FAKE_CONFIG_EXIT: '1', FAKE_CONFIG_ERR: message });
    expect(r.status).toBe(1);
    expect(pickerCalls()).toEqual([]);
    expect(upCalls()).toEqual([]);
    expect(notifications()).toHaveLength(1);
    expect(notifications()[0]).toContain(message);
    expect(notifications()[0]!.join(' ')).not.toContain('not found');
  });

  it('reports a missing r2fl before showing any picker', () => {
    const r = run(wrapper, ['a.txt'], { FAKE_CONFIG_EXIT: '127' });
    expect(r.status).toBe(1);
    expect(pickerCalls()).toEqual([]);
    expect(upCalls()).toEqual([]);
    expect(notifications()[0]).toContain('Could not run r2fl');
  });
});

describe('install.sh and uninstall.sh', () => {
  const install = path.join(macosDir, 'install.sh');
  const uninstall = path.join(macosDir, 'uninstall.sh');

  function files(root: string): string[] {
    if (!fs.existsSync(root)) return [];
    return fs
      .readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((e) => !e.isDirectory())
      .map((e) => path.relative(root, path.join(e.parentPath, e.name)))
      .sort();
  }

  it('refuses to run outside macOS', () => {
    if (process.platform === 'darwin') return;
    const r = run(install, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('macOS only');
    expect(files(path.join(dir, 'home'))).toEqual([]);
  });

  it('installs both workflows and the wrapper under $HOME, and uninstall removes them all', () => {
    const home = path.join(dir, 'home');
    write(path.join(home, 'unrelated.txt'), 'keep me', 0o644);
    write(path.join(home, 'Library', 'Services', 'Other.workflow', 'Contents', 'Info.plist'), 'x');
    const before = files(home);

    const i = run(install, [], { R2FL_INSTALL_ANY_OS: '1' });
    expect(i.status).toBe(0);
    const added = files(home).filter((f) => !before.includes(f));
    expect(added).toEqual(
      [
        '.local/bin/r2fl-quick',
        ...WORKFLOWS.flatMap((w) => [
          `Library/Services/${w}.workflow/Contents/Info.plist`,
          `Library/Services/${w}.workflow/Contents/document.wflow`,
        ]),
      ].sort(),
    );
    const installed = path.join(home, '.local', 'bin', 'r2fl-quick');
    expect(fs.statSync(installed).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(installed, 'utf8')).toBe(fs.readFileSync(wrapper, 'utf8'));
    // Found by the (fake) login shell, so no warning.
    expect(i.stderr).not.toContain('WARNING');

    // Installing again over an existing install works (an upgrade).
    expect(run(install, [], { R2FL_INSTALL_ANY_OS: '1' }).status).toBe(0);

    const u = run(uninstall, []);
    expect(u.status).toBe(0);
    expect(files(home)).toEqual(before);
    // Running it again is harmless.
    expect(run(uninstall, []).status).toBe(0);
  });

  it('warns, but still installs, when a login shell cannot find r2fl', () => {
    const r = run(install, [], {
      R2FL_INSTALL_ANY_OS: '1',
      // No fake r2fl on PATH: the login shell cannot resolve it.
      PATH: '/usr/bin:/bin',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('WARNING');
    expect(fs.existsSync(path.join(dir, 'home', '.local', 'bin', 'r2fl-quick'))).toBe(true);
  });
});

describe('workflow bundles', () => {
  const read = (name: string, file: string) =>
    fs.readFileSync(path.join(macosDir, `${name}.workflow`, 'Contents', file), 'utf8');
  const commandOf = (name: string) =>
    /<key>COMMAND_STRING<\/key>\s*<string>([^<]*)<\/string>/.exec(read(name, 'document.wflow'))![1];

  it('puts the right menu item name in each Info.plist', () => {
    for (const name of WORKFLOWS) {
      expect(read(name, 'Info.plist')).toContain(`<string>${name}</string>`);
      expect(read(name, 'Info.plist')).toContain('com.apple.finder');
    }
  });

  it('runs the installed wrapper without hardcoding a home directory, token or endpoint', () => {
    expect(commandOf(WORKFLOWS[0]!)).toBe('"$HOME/.local/bin/r2fl-quick" "$@"');
    expect(commandOf(WORKFLOWS[1]!)).toBe('"$HOME/.local/bin/r2fl-quick" --no-prompt "$@"');
    for (const name of WORKFLOWS) {
      const wflow = read(name, 'document.wflow');
      expect(wflow).not.toMatch(/\/Users\/|\/home\/|https?:\/\/(?!www\.apple\.com)|token/i);
      // Receives files and folders from Finder; the shell action gets them as arguments (1).
      expect(wflow).toContain('com.apple.Automator.fileSystemObject');
      expect(wflow).toMatch(
        /<key>inputMethod<\/key>\s*<integer>1<\/integer>\s*<key>shell<\/key>\s*<string>\/bin\/zsh<\/string>/,
      );
    }
  });
});
