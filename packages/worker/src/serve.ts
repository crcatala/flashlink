import type { Context } from 'hono';
import { CODE_REGEX } from '@flashlink/core';
import type { Env } from './env.ts';
import {
  contentDisposition,
  errorResponse,
  isActiveContent,
  parseRange,
  rateLimited,
  sanitizeContentType,
  withCharset,
  withinLimit,
} from './http.ts';
import { registryStub } from './stub.ts';

type AppContext = Context<{ Bindings: Env }>;

/**
 * Public fetch path: GET|HEAD /<code>[/anything].
 * Order matters for cost: validate -> rate limit -> one registry call -> stream from R2.
 */
export async function serveLink(c: AppContext): Promise<Response> {
  const code = c.req.param('code');
  // Cheap rejection: malformed codes never reach the rate limiters or the Durable Object.
  if (!code || !CODE_REGEX.test(code)) return errorResponse(404, 'not_found', 'No such link.');

  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (!(await withinLimit(c.env.LIMIT_IP, ip))) return rateLimited();
  if (!(await withinLimit(c.env.LIMIT_GLOBAL, 'global'))) {
    return errorResponse(503, 'rate_limited', 'Service is busy. Try again shortly.', {
      'Retry-After': '30',
    });
  }

  const isHead = c.req.method === 'HEAD';
  const rangeHeader = c.req.header('Range') ?? null;
  const resolved = await registryStub(c.env).resolve(code, !isHead, rangeHeader);
  switch (resolved.status) {
    case 'notfound':
      return errorResponse(404, 'not_found', 'No such link.');
    case 'expired':
      return errorResponse(410, 'gone', 'This link has expired.');
    case 'exhausted':
      return errorResponse(410, 'gone', 'This link has reached its download limit.');
  }

  const { link, r2Key } = resolved;
  const contentType = withCharset(sanitizeContentType(link.contentType));
  const headers = new Headers({
    'Content-Type': contentType,
    'Content-Disposition': contentDisposition(link.filename),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if (isActiveContent(contentType)) headers.set('Content-Security-Policy', 'sandbox');

  const range = parseRange(rangeHeader, link.size);
  if (range === 'unsatisfiable') {
    headers.set('Content-Range', `bytes */${link.size}`);
    return new Response(null, { status: 416, headers });
  }

  if (isHead) {
    headers.set('Content-Length', String(range ? range.end - range.start + 1 : link.size));
    return new Response(null, { status: range ? 206 : 200, headers });
  }

  const object = await c.env.BUCKET.get(
    r2Key,
    range ? { range: { offset: range.start, length: range.end - range.start + 1 } } : undefined,
  );
  if (!object) return errorResponse(404, 'not_found', 'No such link.');

  if (range) {
    headers.set('Content-Range', `bytes ${range.start}-${range.end}/${link.size}`);
    headers.set('Content-Length', String(range.end - range.start + 1));
    return new Response(object.body, { status: 206, headers });
  }
  headers.set('Content-Length', String(object.size));
  return new Response(object.body, { status: 200, headers });
}
