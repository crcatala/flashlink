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
if [ "$1" = --version ]; then
  printf '%s\\n' "\${FAKE_VERSION-0.0.0 (fake123)}"
  exit 0
fi
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

// Stands in for `/bin/zsh -l [-i]`: drops the flags and runs the -c script with sh, so "$@" handling
// is real. Records whether it was interactive. FAKE_ONLY_INTERACTIVE=1 makes a non-interactive run
// find nothing (exit 127), like a PATH that is set up only in ~/.zshrc.
const FAKE_SHELL = `#!/bin/sh
[ "$1" = -l ] || { echo "fake-shell: expected -l first" >&2; exit 64; }
shift
interactive=0
if [ "$1" = -i ]; then interactive=1; shift; fi
[ -z "\${FAKE_LOG-}" ] || echo "$interactive" >> "$FAKE_LOG/shell.calls"
if [ "\${FAKE_ONLY_INTERACTIVE-}" = 1 ] && [ "$interactive" = 0 ]; then exit 127; fi
exec /bin/sh "$@"
`;

function write(file: string, content: string, mode = 0o755): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, { mode });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-macos-'));
  write(path.join(dir, 'bin', 'r2fl'), FAKE_R2FL);
  write(path.join(dir, 'bin', 'node'), '#!/bin/sh\nexit 0\n'); // only has to be found
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

describe('r2fl-quick finding r2fl', () => {
  const bareEnv = (extra: Record<string, string> = {}) => ({
    PATH: '/usr/bin:/bin', // like a Quick Action: the fake r2fl is not on it
    R2FL_CONFIG_DIR: path.join(dir, 'cfg'),
    ...extra,
  });
  const shellCalls = () =>
    fs.existsSync(path.join(dir, 'log', 'shell.calls'))
      ? fs
          .readFileSync(path.join(dir, 'log', 'shell.calls'), 'utf8')
          .trim()
          .split('\n')
      : [];
  const record = (line: string) => write(path.join(dir, 'cfg', 'quick-action-path'), line, 0o644);

  it('finds r2fl and node through the directories recorded by the installer', () => {
    record(`${path.join(dir, 'bin')}\n`);
    const r = run(wrapper, ['--no-prompt', 'a.txt'], bareEnv());
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--', 'a.txt']]);
    expect(shellCalls()).toEqual(['0']); // no need for the interactive retry
  });

  it('uses the recorded directories for the lifetime picker too', () => {
    record(path.join(dir, 'bin'));
    const r = run(wrapper, ['a.txt'], bareEnv({ FAKE_PICK: '1 day' }));
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--ttl', '1d', '--', 'a.txt']]);
  });

  it('retries once in an interactive login shell when the first try finds nothing', () => {
    const r = run(wrapper, ['--no-prompt', 'a.txt'], {
      FAKE_ONLY_INTERACTIVE: '1',
      R2FL_CONFIG_DIR: path.join(dir, 'cfg'),
    });
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--', 'a.txt']]);
    expect(shellCalls()).toEqual(['0', '1']);
  });

  it('says to re-run the installer when nothing finds r2fl', () => {
    const r = run(wrapper, ['--no-prompt', 'a.txt'], bareEnv());
    expect(r.status).toBe(127);
    expect(shellCalls()).toEqual(['0', '1']);
    expect(upCalls()).toEqual([]);
    expect(notifications()[0]!.join(' ')).toContain('Run macos/install.sh again');
  });

  it('--check succeeds only when r2fl and node are both found', () => {
    expect(run(wrapper, ['--check'], bareEnv()).status).toBe(127);
    record(path.join(dir, 'bin'));
    const ok = run(wrapper, ['--check'], bareEnv());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(path.join(dir, 'bin', 'r2fl'));
    expect(ok.stdout).toContain(path.join(dir, 'bin', 'node'));
  });

  it('ignores a missing or empty record and surrounding whitespace', () => {
    record(`  ${path.join(dir, 'bin')}  \n`);
    expect(run(wrapper, ['--check'], bareEnv()).status).toBe(0);
    record('\n');
    expect(run(wrapper, ['--check'], bareEnv()).status).toBe(127);
  });
});

const BUILD = 'r2fl 0.0.0 (fake123), from PATH';

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
    expect(list).toEqual(['1 day', '15 minutes', '1 hour', '1 day', '7 days', BUILD]);
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
      BUILD,
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

  it('shows which build is running as the last list argument, and where it came from', () => {
    run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour', FAKE_VERSION: '1.2.3 (abc1234-dirty)' });
    const [call] = pickerCalls();
    expect(call![call!.length - 1]).toBe('r2fl 1.2.3 (abc1234-dirty), from PATH');
  });

  it('says "standalone" for the installed binary and survives a version that cannot be read', () => {
    const bin = path.join(dir, 'data', 'bin', 'r2fl');
    write(bin, FAKE_R2FL);
    run(wrapper, ['a.txt'], { FAKE_PICK: '1 hour', R2FL_DATA_DIR: path.join(dir, 'data') });
    expect(pickerCalls()[0]!.at(-1)).toBe('r2fl 0.0.0 (fake123), standalone');
    run(wrapper, ['a.txt'], {
      FAKE_PICK: '1 hour',
      FAKE_VERSION: '',
      R2FL_DATA_DIR: path.join(dir, 'data'),
    });
    expect(pickerCalls()[1]!.at(-1)).toBe('r2fl unknown version, standalone');
  });

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

describe('r2fl-quick with the standalone binary', () => {
  // A bare PATH (the fake r2fl is not on it) and no recorded directories: only the binary can work.
  const binPath = () => path.join(dir, 'data', 'bin', 'r2fl');
  const bareEnv = (extra: Record<string, string> = {}) => ({
    PATH: '/usr/bin:/bin',
    R2FL_CONFIG_DIR: path.join(dir, 'cfg'),
    R2FL_DATA_DIR: path.join(dir, 'data'),
    ...extra,
  });
  const shellCalls = () => fs.existsSync(path.join(dir, 'log', 'shell.calls'));
  const install = (content = FAKE_R2FL) => write(binPath(), content);

  it('runs the binary directly: no login shell, no PATH, no node', () => {
    install();
    const r = run(wrapper, ['--no-prompt', 'a b.txt'], bareEnv());
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--', 'a b.txt']]);
    expect(shellCalls()).toBe(false);
  });

  it('uses it for the lifetime picker and the upload', () => {
    install();
    const r = run(wrapper, ['a.txt'], bareEnv({ FAKE_PICK: '7 days' }));
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--ttl', '7d', '--', 'a.txt']]);
    expect(shellCalls()).toBe(false);
  });

  it('is found at R2FL_QUICK_BIN too', () => {
    write(path.join(dir, 'elsewhere', 'r2fl'), FAKE_R2FL);
    const r = run(
      wrapper,
      ['--no-prompt', 'a.txt'],
      bareEnv({ R2FL_QUICK_BIN: path.join(dir, 'elsewhere', 'r2fl') }),
    );
    expect(r.status).toBe(0);
    expect(upCalls()).toHaveLength(1);
  });

  it('does not run the upload a second time when the binary fails', () => {
    install();
    const r = run(wrapper, ['--no-prompt', 'a.txt'], bareEnv({ FAKE_UP_EXIT: '1' }));
    expect(r.status).toBe(1);
    expect(upCalls()).toHaveLength(1);
    expect(shellCalls()).toBe(false);
    expect(notifications()).toEqual([]);
  });

  it('falls back to the login shell when the binary cannot start (127)', () => {
    install('#!/bin/sh\nexit 127\n');
    write(path.join(dir, 'cfg', 'quick-action-path'), path.join(dir, 'bin'), 0o644);
    const r = run(wrapper, ['--no-prompt', 'a.txt'], bareEnv());
    expect(r.status).toBe(0);
    expect(upCalls()).toEqual([['up', '--notify', '--', 'a.txt']]);
    expect(shellCalls()).toBe(true);
  });

  it('ignores a binary that is not executable', () => {
    write(binPath(), FAKE_R2FL, 0o644);
    const r = run(wrapper, ['--no-prompt', 'a.txt'], bareEnv());
    expect(r.status).toBe(127);
    expect(upCalls()).toEqual([]);
  });

  it('--check passes with only the binary, and fails when it does not run', () => {
    install();
    const ok = run(wrapper, ['--check'], bareEnv());
    expect(ok.status).toBe(0);
    expect(ok.stdout).toContain(binPath());
    install('#!/bin/sh\nexit 1\n');
    expect(run(wrapper, ['--check'], bareEnv()).status).toBe(127);
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
        '.config/r2fl/quick-action-path',
        ...WORKFLOWS.flatMap((w) => [
          `Library/Services/${w}.workflow/Contents/Info.plist`,
          `Library/Services/${w}.workflow/Contents/document.wflow`,
        ]),
      ].sort(),
    );
    const installed = path.join(home, '.local', 'bin', 'r2fl-quick');
    expect(fs.statSync(installed).mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(installed, 'utf8')).toBe(fs.readFileSync(wrapper, 'utf8'));
    // Where r2fl and node were found in the installing terminal is recorded for the wrapper.
    expect(fs.readFileSync(path.join(home, '.config', 'r2fl', 'quick-action-path'), 'utf8')).toBe(
      `${path.join(dir, 'bin')}\n`,
    );
    expect(i.stderr).not.toContain('WARNING');
    expect(i.stdout).toContain('found the way a Quick Action will look for them');

    // Installing again over an existing install works (an upgrade).
    expect(run(install, [], { R2FL_INSTALL_ANY_OS: '1' }).status).toBe(0);

    const u = run(uninstall, []);
    expect(u.status).toBe(0);
    expect(files(home)).toEqual(before);
    // Running it again is harmless.
    expect(run(uninstall, []).status).toBe(0);
  });

  it('--binary installs the standalone r2fl under the data dir; uninstall removes only it', () => {
    const home = path.join(dir, 'home');
    write(path.join(dir, 'built', 'r2fl-darwin-arm64'), FAKE_R2FL);
    write(path.join(home, '.local', 'share', 'r2fl', 'history.json'), '[]', 0o644);
    const before = files(home);

    const i = run(install, ['--binary', path.join(dir, 'built', 'r2fl-darwin-arm64')], {
      R2FL_INSTALL_ANY_OS: '1',
    });
    expect(i.status).toBe(0);
    const bin = path.join(home, '.local', 'share', 'r2fl', 'bin', 'r2fl');
    expect(fs.statSync(bin).mode & 0o111).not.toBe(0);
    expect(i.stdout).toContain(`installed: ${bin}`);
    expect(i.stderr).not.toContain('WARNING');

    const u = run(uninstall, []);
    expect(u.status).toBe(0);
    expect(u.stdout).toContain(`removed: ${bin}`);
    expect(files(home)).toEqual(before); // history.json is still there
    expect(fs.existsSync(path.dirname(bin))).toBe(false);
  });

  it('--binary alone is enough: no node or r2fl needed in the terminal', () => {
    write(path.join(dir, 'built', 'r2fl'), FAKE_R2FL);
    const r = run(install, ['--binary', path.join(dir, 'built', 'r2fl')], {
      R2FL_INSTALL_ANY_OS: '1',
      PATH: '/usr/bin:/bin',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('WARNING');
    expect(r.stdout).toContain('found the way a Quick Action will look for them');
  });

  it('removes a binary that does not start and warns', () => {
    write(path.join(dir, 'built', 'r2fl'), '#!/bin/sh\nexit 1\n');
    const r = run(install, ['--binary', path.join(dir, 'built', 'r2fl')], {
      R2FL_INSTALL_ANY_OS: '1',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('does not start');
    expect(fs.existsSync(path.join(dir, 'home', '.local', 'share', 'r2fl', 'bin', 'r2fl'))).toBe(
      false,
    );
  });

  it('rejects a missing --binary file and unknown options without installing anything', () => {
    const missing = run(install, ['--binary', path.join(dir, 'nope')], {
      R2FL_INSTALL_ANY_OS: '1',
    });
    expect(missing.status).toBe(2);
    expect(run(install, ['--bogus'], { R2FL_INSTALL_ANY_OS: '1' }).status).toBe(2);
    expect(files(path.join(dir, 'home'))).toEqual([]);
  });

  it('builds and installs the notifier applet when osacompile exists; uninstall removes it', () => {
    const home = path.join(dir, 'home');
    const applet = path.join(home, '.local', 'share', 'r2fl', 'notify', 'r2-fastlink.app');
    // A fake osacompile: `osacompile -o OUT SOURCE` creates the bundle and keeps the source.
    write(
      path.join(dir, 'bin', 'osacompile'),
      '#!/bin/sh\nmkdir -p "$2/Contents" && cp "$3" "$2/Contents/source.applescript"\n',
    );
    const i = run(install, [], { R2FL_INSTALL_ANY_OS: '1' });
    expect(i.status).toBe(0);
    expect(i.stdout).toContain(`installed: ${applet}`);
    expect(fs.readFileSync(path.join(applet, 'Contents', 'source.applescript'), 'utf8')).toBe(
      fs.readFileSync(path.join(macosDir, 'notify-applet.applescript'), 'utf8'),
    );
    expect(fs.statSync(path.join(applet, '..', 'pending')).isDirectory()).toBe(true);

    expect(run(uninstall, []).status).toBe(0);
    expect(fs.existsSync(path.dirname(applet))).toBe(false);
  });

  it('says so, but still installs, when the notifier cannot be built', () => {
    write(path.join(dir, 'bin', 'osacompile'), '#!/bin/sh\nexit 1\n');
    const r = run(install, [], { R2FL_INSTALL_ANY_OS: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('open Script Editor');
  });

  it('works even though a Quick Action has a bare PATH (the terminal PATH is recorded)', () => {
    const r = run(install, [], { R2FL_INSTALL_ANY_OS: '1' });
    expect(r.status).toBe(0);
    expect(r.stderr).not.toContain('WARNING');
    expect(r.stdout).toContain('recorded:');
  });

  it('warns, records nothing, but still installs, when r2fl is not found in the terminal', () => {
    const r = run(install, [], {
      R2FL_INSTALL_ANY_OS: '1',
      // No fake r2fl on PATH: the login shell cannot resolve it.
      PATH: '/usr/bin:/bin',
    });
    expect(r.status).toBe(0);
    expect(r.stderr).toContain('WARNING');
    expect(fs.existsSync(path.join(dir, 'home', '.local', 'bin', 'r2fl-quick'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'home', '.config', 'r2fl', 'quick-action-path'))).toBe(
      false,
    );
  });
});

describe('scripts/install-macos.sh', () => {
  const script = path.resolve(macosDir, '..', 'scripts', 'install-macos.sh');

  it('refuses to run outside macOS, before building anything', () => {
    if (process.platform === 'darwin') return;
    const r = run(script, []);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('macOS only');
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
