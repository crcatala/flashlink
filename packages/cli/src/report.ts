import { ApiError } from '@r2-fastlink/core';
import { CliError, ReportedError, errorJson } from './errors.ts';

export interface ReportIO {
  stdout(text: string): void;
  stderr(text: string): void;
  color: boolean;
}

/**
 * Print a command failure. With `--json` it is one compact `{"error","message"}` line on
 * stdout and nothing on stderr, so wrappers can parse it; otherwise a human message on stderr.
 * A `ReportedError` prints nothing: the command already described the failure itself.
 * The caller sets the exit code.
 */
export function reportFailure(err: unknown, jsonMode: boolean, io: ReportIO): void {
  if (err instanceof ReportedError) return;
  if (jsonMode) {
    io.stdout(`${JSON.stringify(errorJson(err))}\n`);
    return;
  }
  const red = (s: string) => (io.color ? `\u001b[31m${s}\u001b[39m` : s);
  if (err instanceof CliError) {
    io.stderr(`${red('error:')} ${err.message}\n`);
    if (err.hint) io.stderr(`${err.hint}\n`);
  } else if (err instanceof ApiError) {
    io.stderr(`${red('error:')} ${err.message}\n`);
    if (err.status === 401) io.stderr('Check your token with `r2fl init`.\n');
  } else if (err instanceof Error && err.message === 'Cancelled') {
    io.stderr('\n');
  } else {
    io.stderr(`${red('error:')} ${err instanceof Error ? err.message : String(err)}\n`);
  }
}
