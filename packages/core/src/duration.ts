const UNIT_SECONDS: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };

/**
 * Parse a duration like `30s`, `15m`, `2h`, `1d`, `1h30m` into seconds.
 * A bare number is interpreted as seconds. Throws on invalid input.
 */
export function parseDuration(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isInteger(input) || input <= 0) throw new Error(`Invalid duration: ${input}`);
    return input;
  }
  const text = input.trim().toLowerCase();
  if (/^\d+$/.test(text)) return assertPositive(Number(text), input);
  if (!/^(\d+[smhdw])+$/.test(text)) {
    throw new Error(`Invalid duration "${input}" (try 30m, 2h, 1d)`);
  }
  let total = 0;
  for (const [, n, unit] of text.matchAll(/(\d+)([smhdw])/g)) {
    total += Number(n) * UNIT_SECONDS[unit!]!;
  }
  return assertPositive(total, input);
}

function assertPositive(seconds: number, original: string | number): number {
  if (!Number.isSafeInteger(seconds) || seconds <= 0) {
    throw new Error(`Invalid duration "${original}": must be greater than zero`);
  }
  return seconds;
}

/** Format seconds as a compact human string, e.g. `1h 30m`, `45s`. */
export function formatDuration(totalSeconds: number): string {
  let rest = Math.max(0, Math.round(totalSeconds));
  if (rest === 0) return '0s';
  const parts: string[] = [];
  for (const [unit, size] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
    if (parts.length === 2) break;
  }
  return parts.join(' ');
}
