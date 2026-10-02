import { formatDuration } from '@r2-fastlink/core';
import { CliError } from './errors.ts';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value >= 10 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** Parse sizes like `50MB`, `512k`, `1.5GB`, or plain bytes. Units are powers of 1024. */
export function parseSize(input: string): number {
  const match = /^(\d+(?:\.\d+)?)\s*([kmgt]?)b?$/i.exec(input.trim());
  if (!match) throw new CliError(`Invalid size "${input}" (try 50MB, 512KB).`);
  const power = ['', 'k', 'm', 'g', 't'].indexOf(match[2]!.toLowerCase());
  const bytes = Math.floor(Number(match[1]) * 1024 ** power);
  if (bytes < 1) throw new CliError(`Invalid size "${input}": must be at least 1 byte.`);
  return bytes;
}

/** "34m left" for a future time, "expired 2h ago" for a past one. */
export function timeLeft(expiresAtIso: string, now = Date.now()): string {
  const diff = Math.round((Date.parse(expiresAtIso) - now) / 1000);
  return diff > 0 ? `${formatDuration(diff)} left` : `expired ${formatDuration(-diff)} ago`;
}

/** Local wall-clock time, e.g. "14:32" (with the date if it isn't today). */
export function clock(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  return d.toDateString() === now.toDateString()
    ? time
    : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

/** Left-align rows into columns separated by two spaces. */
export function table(rows: string[][]): string {
  const widths = rows[0]!.map((_, col) =>
    Math.max(...rows.map((r) => visibleLength(r[col] ?? ''))),
  );
  return rows
    .map((r) =>
      r
        .map((cell, col) => (col === r.length - 1 ? cell : pad(cell, widths[col]!)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n');
}

// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;]*m/g;
const visibleLength = (s: string) => s.replace(ANSI, '').length;
const pad = (s: string, width: number) => s + ' '.repeat(Math.max(0, width - visibleLength(s)));

export function truncate(text: string, max: number): string {
  const chars = Array.from(text);
  return chars.length <= max ? text : `${chars.slice(0, max - 1).join('')}…`;
}

export function createStyle(enabled: boolean) {
  const wrap = (open: number, close: number) => (s: string) =>
    enabled ? `\u001b[${open}m${s}\u001b[${close}m` : s;
  return {
    bold: wrap(1, 22),
    dim: wrap(2, 22),
    red: wrap(31, 39),
    green: wrap(32, 39),
    yellow: wrap(33, 39),
    cyan: wrap(36, 39),
  };
}
export type Style = ReturnType<typeof createStyle>;
