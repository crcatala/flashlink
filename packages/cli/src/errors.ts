import { ApiError } from '@r2-fastlink/core';

/** A problem the user can fix; printed as a one-line message without a stack trace. */
export class CliError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message);
    this.name = 'CliError';
  }
}

/** The `--json` failure shape: `{ "error": "<code>", "message": "..." }`. */
export function errorJson(err: unknown): { error: string; message: string } {
  if (err instanceof ApiError) return { error: err.code, message: err.message };
  if (err instanceof CliError) return { error: 'cli_error', message: err.message };
  return { error: 'error', message: err instanceof Error ? err.message : String(err) };
}

/** Thrown after the command has already reported its own failures (e.g. in its JSON output). */
export class ReportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReportedError';
  }
}

/** One-line text for a failure, e.g. for a notification body. */
export function errorText(err: unknown): string {
  if (err instanceof CliError) return err.hint ? `${err.message} ${err.hint}` : err.message;
  return err instanceof Error ? err.message : String(err);
}
