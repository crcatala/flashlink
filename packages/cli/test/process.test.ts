import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const REPO = path.resolve(import.meta.dirname, '..', '..', '..');

/** What the checkout (not a build stamp) says, for a run from source. */
function git(...args: string[]): string {
  const r = spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout.trim();
}
const sha = () => git('rev-parse', '--short', 'HEAD');
const date = () => git('show', '-s', '--format=%cs', 'HEAD');
// A test run in a checkout with edits in it builds from a dirty tree.
const dirty = git('status', '--porcelain') === '' ? '' : '-dirty';

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-proc-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs the real entry point, so parse-time failures (which never reach a command) are covered. */
function fl(args: string[]) {
  const env = {
    ...process.env,
    FLASHLINK_CONFIG_DIR: path.join(dir, 'config'),
    FLASHLINK_DATA_DIR: path.join(dir, 'data'),
    FLASHLINK_ENDPOINT: 'http://127.0.0.1:1',
    FLASHLINK_TOKEN: 'secret-token',
  };
  const res = spawnSync(process.execPath, ['--import', 'tsx', ENTRY, ...args], {
    env,
    encoding: 'utf8',
    input: '',
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

describe('--json parse failures', () => {
  it('reports an unknown option as one cli_error line on stdout, nothing on stderr', () => {
    const res = fl(['up', '--json', '--bogus', 'x']);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toEqual({
      error: 'cli_error',
      message: "unknown option '--bogus'",
    });
  });

  it('reports an invalid option value the same way', () => {
    const res = fl(['up', '--json', '-d', 'abc', 'x']);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toMatchObject({ error: 'cli_error' });
    expect(JSON.parse(res.stdout).message).toContain('must be a positive integer');
  });

  it('does not treat --json after `--` as a flag', () => {
    const res = fl(['up', '--bogus', '--', '--json']);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain("unknown option '--bogus'");
  });
});

describe('parse failures without --json', () => {
  it('still print commander usage errors on stderr and exit 1', () => {
    const res = fl(['up', '--bogus', 'x']);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain("unknown option '--bogus'");
    expect(res.stderr).toContain('(run with --help for usage)');
  });

  it('exit 0 for --help and --version', () => {
    const help = fl(['up', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: fl up');
    const version = fl(['--version']);
    expect(version.status).toBe(0);
    // The release standard's line: name, version, the commit and that commit's date.
    expect(version.stdout).toBe(`fl ${pkg.version} (${sha()}${dirty} ${date()})\n`);
    expect(fl(['-V']).stdout).toBe(version.stdout);
  });

  it('has an update command that only reports with --check', () => {
    const help = fl(['update', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('--check');
    expect(help.stdout).toContain('--force');
    // 0: up to date, 1: an update is available, 2: could not tell (for example no network).
    const check = fl(['update', '--check']);
    expect([0, 1, 2]).toContain(check.status);
    expect(check.stdout + check.stderr).toMatch(/fl/);
    expect(check.stderr).not.toContain('Error:');
  });
});

describe('--json with an unreadable config', () => {
  it('reports it as JSON', () => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'config.json'), '{bad');
    const res = fl(['up', '--json', path.join(dir, 'x.txt')]);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toMatchObject({ error: 'error' });
  });
});
