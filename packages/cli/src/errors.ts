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
