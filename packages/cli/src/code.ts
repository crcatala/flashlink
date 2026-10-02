import { CODE_REGEX } from '@r2-fastlink/core';
import { CliError } from './errors.ts';

/** Accept a bare code or any link URL (`https://host/<code>[/name]`) and return the code. */
export function extractCode(input: string): string {
  const text = input.trim();
  if (CODE_REGEX.test(text)) return text;
  try {
    const first = new URL(text).pathname.split('/').filter(Boolean)[0];
    if (first && CODE_REGEX.test(first)) return first;
  } catch {
    // not a URL
  }
  throw new CliError(`"${input}" is not a link code or URL.`, 'A code looks like k3F9xQ2m.');
}
