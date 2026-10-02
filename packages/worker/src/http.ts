import type { ApiErrorBody, ApiErrorCode } from '@r2-fastlink/core';

export function jsonResponse(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...headers },
  });
}

export function errorResponse(
  status: number,
  error: ApiErrorCode,
  message: string,
  headers?: HeadersInit,
): Response {
  const body: ApiErrorBody = { error, message };
  return jsonResponse(body, status, headers);
}

/** Map a registry/API error code to an HTTP status. */
export function statusForError(error: ApiErrorCode): number {
  switch (error) {
    case 'unauthorized':
      return 401;
    case 'not_found':
      return 404;
    case 'exists':
      return 409;
    case 'gone':
      return 410;
    case 'length_required':
      return 411;
    case 'file_too_large':
      return 413;
    case 'storage_full':
      return 507;
    case 'rate_limited':
    case 'daily_limit':
      return 429;
    case 'not_configured':
    case 'upload_failed':
    case 'internal_error':
      return 500;
    default:
      return 400;
  }
}

/** Fail-open rate limit check: a missing or failing limiter never blocks traffic. */
export async function withinLimit(limiter: RateLimit | undefined, key: string): Promise<boolean> {
  if (!limiter) return true;
  try {
    return (await limiter.limit({ key })).success;
  } catch {
    return true;
  }
}

export function rateLimited(): Response {
  return errorResponse(429, 'rate_limited', 'Too many requests. Slow down.', {
    'Retry-After': '60',
  });
}

const CONTENT_TYPE_RE =
  /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+(\s*;\s*[a-z0-9-]+=("[^"\r\n]*"|[^;\s"\r\n]+))*$/i;

/** Accept only a well-formed media type; anything else becomes application/octet-stream. */
export function sanitizeContentType(raw: string | null | undefined): string {
  const value = raw?.trim();
  return value && value.length <= 200 && CONTENT_TYPE_RE.test(value)
    ? value
    : 'application/octet-stream';
}

/** Decode an `X-Filename` header (percent-encoded UTF-8) into a safe display name. */
export function sanitizeFilename(raw: string | null | undefined): string {
  let name = raw ?? '';
  try {
    name = decodeURIComponent(name);
  } catch {
    // keep the raw value
  }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\\/\u0000-\u001f\u007f"]/g, '_').trim();
  name = Array.from(name).slice(0, 200).join('');
  return name === '' || name === '.' || name === '..' ? 'file' : name;
}

export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeRFC5987(filename)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

const ACTIVE_TYPES = new Set([
  'text/html',
  'application/xhtml+xml',
  'image/svg+xml',
  'text/xml',
  'application/xml',
]);

/** Types a browser could execute script from when navigated to directly. */
export function isActiveContent(contentType: string): boolean {
  return ACTIVE_TYPES.has(contentType.split(';')[0]!.trim().toLowerCase());
}

/** Add a charset to text/* types that lack one so agents and browsers decode correctly. */
export function withCharset(contentType: string): string {
  return /^text\//i.test(contentType) && !/charset=/i.test(contentType)
    ? `${contentType}; charset=utf-8`
    : contentType;
}

export type ByteRange = { start: number; end: number };

/**
 * Parse a single-range `Range: bytes=...` header against a known size.
 * Returns null when there is no (usable) range, or 'unsatisfiable' for a 416.
 * Multi-range requests are ignored (served as a full 200), which HTTP permits.
 */
export function parseRange(
  header: string | null,
  size: number,
): ByteRange | 'unsatisfiable' | null {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, first = '', last = ''] = match;
  if (first === '' && last === '') return null;
  let start: number;
  let end: number;
  if (first === '') {
    const suffix = Number(last);
    if (suffix === 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(first);
    end = last === '' ? size - 1 : Math.min(Number(last), size - 1);
    if (start >= size || start > end) return 'unsatisfiable';
  }
  return { start, end };
}
