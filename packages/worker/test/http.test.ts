import { describe, expect, it } from 'vitest';
import { generateCode } from '../src/code.ts';
import { parseLimits } from '../src/config.ts';
import {
  contentDisposition,
  isActiveContent,
  parseRange,
  sanitizeContentType,
  sanitizeFilename,
  withCharset,
  withinLimit,
} from '../src/http.ts';
import { CODE_REGEX } from '@r2-fastlink/core';

describe('generateCode', () => {
  it('produces valid 8-char base58 codes', () => {
    for (let i = 0; i < 500; i++) expect(generateCode()).toMatch(CODE_REGEX);
  });

  it('does not repeat and uses the whole alphabet', () => {
    const seen = new Set<string>();
    const chars = new Set<string>();
    for (let i = 0; i < 3000; i++) {
      const code = generateCode();
      seen.add(code);
      for (const ch of code) chars.add(ch);
    }
    expect(seen.size).toBe(3000);
    expect(chars.size).toBe(58);
  });
});

describe('parseRange', () => {
  it.each([
    ['bytes=0-4', 10, { start: 0, end: 4 }],
    ['bytes=5-', 10, { start: 5, end: 9 }],
    ['bytes=-3', 10, { start: 7, end: 9 }],
    ['bytes=2-100', 10, { start: 2, end: 9 }],
    ['bytes=-100', 10, { start: 0, end: 9 }],
  ])('%s of %d', (header, size, expected) => {
    expect(parseRange(header, size)).toEqual(expected);
  });

  it.each([
    ['bytes=10-', 10],
    ['bytes=5-2', 10],
    ['bytes=-0', 10],
  ])('%s is unsatisfiable', (h, size) => {
    expect(parseRange(h, size)).toBe('unsatisfiable');
  });

  it.each([[null], ['items=0-1'], ['bytes=0-1,3-4'], ['bytes=-'], ['garbage']])(
    'ignores %s',
    (h) => {
      expect(parseRange(h, 10)).toBeNull();
    },
  );
});

describe('sanitizers', () => {
  it('filename: decodes, strips separators and control chars, falls back', () => {
    expect(sanitizeFilename('my%20file.png')).toBe('my file.png');
    expect(sanitizeFilename('..%2F..%2Fetc%2Fpasswd')).toBe('.._.._etc_passwd');
    expect(sanitizeFilename('a"b\u0000c')).toBe('a_b_c');
    expect(sanitizeFilename('')).toBe('file');
    expect(sanitizeFilename('..')).toBe('file');
    expect(sanitizeFilename(null)).toBe('file');
    expect(sanitizeFilename('x'.repeat(500)).length).toBe(200);
  });

  it('content type: keeps valid, rejects junk', () => {
    expect(sanitizeContentType('image/png')).toBe('image/png');
    expect(sanitizeContentType('text/plain; charset=utf-8')).toBe('text/plain; charset=utf-8');
    expect(sanitizeContentType('nonsense')).toBe('application/octet-stream');
    expect(sanitizeContentType('text/html\r\nSet-Cookie: x=1')).toBe('application/octet-stream');
    expect(sanitizeContentType(null)).toBe('application/octet-stream');
  });

  it('adds charset to text types only', () => {
    expect(withCharset('text/plain')).toBe('text/plain; charset=utf-8');
    expect(withCharset('text/plain; charset=latin1')).toBe('text/plain; charset=latin1');
    expect(withCharset('image/png')).toBe('image/png');
  });

  it('flags active content', () => {
    expect(isActiveContent('text/html; charset=utf-8')).toBe(true);
    expect(isActiveContent('image/svg+xml')).toBe(true);
    expect(isActiveContent('image/png')).toBe(false);
    expect(isActiveContent('application/pdf')).toBe(false);
  });

  it('content-disposition has ascii fallback and utf-8 name', () => {
    expect(contentDisposition('plain.txt')).toBe(
      `inline; filename="plain.txt"; filename*=UTF-8''plain.txt`,
    );
    const d = contentDisposition('héllo wörld.png');
    expect(d).toContain('filename="h_llo w_rld.png"');
    expect(d).toContain("filename*=UTF-8''h%C3%A9llo%20w%C3%B6rld.png");
  });
});

describe('withinLimit', () => {
  it('passes when there is no limiter, and fails open on errors', async () => {
    expect(await withinLimit(undefined, 'k')).toBe(true);
    const broken = {
      limit: async () => {
        throw new Error('boom');
      },
    };
    expect(await withinLimit(broken, 'k')).toBe(true);
  });
  it('reflects the limiter outcome', async () => {
    expect(await withinLimit({ limit: async () => ({ success: false }) }, 'k')).toBe(false);
    expect(await withinLimit({ limit: async () => ({ success: true }) }, 'k')).toBe(true);
  });
});

describe('parseLimits', () => {
  it('uses defaults for missing or invalid vars and caps file size', () => {
    const d = parseLimits({});
    expect(d.maxFileBytes).toBe(50 * 1024 * 1024);
    expect(d.maxTtlSeconds).toBe(7 * 86400);
    expect(d.defaultTtlSeconds).toBe(3600);
    expect(parseLimits({ MAX_FILE_BYTES: 'abc' }).maxFileBytes).toBe(50 * 1024 * 1024);
    expect(parseLimits({ MAX_FILE_BYTES: String(10 ** 12) }).maxFileBytes).toBe(100 * 1024 * 1024);
    expect(
      parseLimits({ DEFAULT_TTL_SECONDS: '999999999', MAX_TTL_SECONDS: '60' }).defaultTtlSeconds,
    ).toBe(60);
  });
});
