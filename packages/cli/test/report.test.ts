import { ApiError } from '@r2-fastlink/core';
import { describe, expect, it } from 'vitest';
import { CliError, ReportedError, errorJson } from '../src/errors.ts';
import { reportFailure } from '../src/report.ts';

function run(err: unknown, json: boolean) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  reportFailure(err, json, {
    stdout: (t) => stdout.push(t),
    stderr: (t) => stderr.push(t),
    color: false,
  });
  return { stdout: stdout.join(''), stderr: stderr.join('') };
}

describe('--json failures', () => {
  it('prints a parseable {error, message} for a CliError, with nothing on stderr', () => {
    const { stdout, stderr } = run(new CliError('No such file.', 'a hint'), true);
    expect(stdout.endsWith('\n')).toBe(true);
    expect(JSON.parse(stdout)).toEqual({ error: 'cli_error', message: 'No such file.' });
    expect(stderr).toBe('');
  });

  it('uses the server error code for an ApiError', () => {
    const { stdout, stderr } = run(new ApiError(413, 'too_large', 'File is too large.'), true);
    expect(JSON.parse(stdout)).toEqual({ error: 'too_large', message: 'File is too large.' });
    expect(stderr).toBe('');
  });

  it('falls back to a generic code for unexpected errors', () => {
    expect(errorJson(new Error('boom'))).toEqual({ error: 'error', message: 'boom' });
    expect(errorJson('weird')).toEqual({ error: 'error', message: 'weird' });
  });

  it('is a single line so it cannot be confused with a pretty-printed result', () => {
    const { stdout } = run(new CliError('line one\nline two'), true);
    expect(stdout.trimEnd().split('\n')).toHaveLength(1);
    expect(JSON.parse(stdout).message).toBe('line one\nline two');
  });
});

describe('ReportedError', () => {
  it('prints nothing in either mode', () => {
    for (const json of [true, false]) {
      expect(run(new ReportedError('1 of 2 uploads failed.'), json)).toEqual({
        stdout: '',
        stderr: '',
      });
    }
  });
});

describe('human failures', () => {
  it('prints the message and hint to stderr and nothing to stdout', () => {
    const { stdout, stderr } = run(new CliError('Nope.', 'Try this.'), false);
    expect(stdout).toBe('');
    expect(stderr).toBe('error: Nope.\nTry this.\n');
  });

  it('points at `r2fl init` for a 401', () => {
    const { stderr } = run(new ApiError(401, 'unauthorized', 'Missing or invalid token.'), false);
    expect(stderr).toContain('Check your token with `r2fl init`.');
  });
});
