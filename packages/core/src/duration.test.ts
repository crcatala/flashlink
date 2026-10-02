import { describe, expect, it } from 'vitest';
import { formatDuration, parseDuration } from './duration.ts';

describe('parseDuration', () => {
  it.each([
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['1d', 86400],
    ['1w', 604800],
    ['1h30m', 5400],
    ['90', 90],
    [' 2H ', 7200],
    [120, 120],
  ])('parses %j', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(['', 'abc', '1x', '-5m', '0', '0m', '1.5h', 'm5', 0, -1, 1.5])('rejects %j', (input) => {
    expect(() => parseDuration(input as string)).toThrow();
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [3600, '1h'],
    [5400, '1h 30m'],
    [90061, '1d 1h'],
    [59.6, '1m'],
  ])('formats %d', (input, expected) => {
    expect(formatDuration(input)).toBe(expected);
  });
});
