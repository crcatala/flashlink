import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ENTRY = fileURLToPath(new URL('../src/index.ts', import.meta.url));

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-proc-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Runs the real entry point, so parse-time failures (which never reach a command) are covered. */
function r2fl(args: string[]) {
  const env = {
    ...process.env,
    R2FL_CONFIG_DIR: path.join(dir, 'config'),
    R2FL_DATA_DIR: path.join(dir, 'data'),
    R2FL_ENDPOINT: 'http://127.0.0.1:1',
    R2FL_TOKEN: 'secret-token',
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
    const res = r2fl(['up', '--json', '--bogus', 'x']);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toEqual({
      error: 'cli_error',
      message: "unknown option '--bogus'",
    });
  });

  it('reports an invalid option value the same way', () => {
    const res = r2fl(['up', '--json', '-d', 'abc', 'x']);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toMatchObject({ error: 'cli_error' });
    expect(JSON.parse(res.stdout).message).toContain('must be a positive integer');
  });

  it('does not treat --json after `--` as a flag', () => {
    const res = r2fl(['up', '--bogus', '--', '--json']);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain("unknown option '--bogus'");
  });
});

describe('parse failures without --json', () => {
  it('still print commander usage errors on stderr and exit 1', () => {
    const res = r2fl(['up', '--bogus', 'x']);
    expect(res.status).toBe(1);
    expect(res.stdout).toBe('');
    expect(res.stderr).toContain("unknown option '--bogus'");
    expect(res.stderr).toContain('(run with --help for usage)');
  });

  it('exit 0 for --help and --version', () => {
    const help = r2fl(['up', '--help']);
    expect(help.status).toBe(0);
    expect(help.stdout).toContain('Usage: r2fl up');
    const version = r2fl(['--version']);
    expect(version.status).toBe(0);
    expect(version.stdout).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('--json with an unreadable config', () => {
  it('reports it as JSON', () => {
    fs.mkdirSync(path.join(dir, 'config'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'config', 'config.json'), '{bad');
    const res = r2fl(['up', '--json', path.join(dir, 'x.txt')]);
    expect(res.status).toBe(1);
    expect(res.stderr).toBe('');
    expect(JSON.parse(res.stdout)).toMatchObject({ error: 'error' });
  });
});
