import { Hono, type Context } from 'hono';
import { CODE_REGEX, type RefreshResult, type UploadResult } from '@r2-fastlink/core';
import { isAuthorized } from './auth.ts';
import { parseLimits } from './config.ts';
import type { Env } from './env.ts';
import {
  errorResponse,
  jsonResponse,
  rateLimited,
  sanitizeContentType,
  sanitizeFilename,
  statusForError,
  withinLimit,
} from './http.ts';
import { registryStub } from './stub.ts';

export const api = new Hono<{ Bindings: Env }>();

// Per-IP limit first (bounds token guessing), then authentication. The global breaker is
// deliberately not applied here: only the public fetch path is exposed to anonymous floods.
api.use('*', async (c, next) => {
  const ip = c.req.header('CF-Connecting-IP') ?? 'unknown';
  if (!(await withinLimit(c.env.LIMIT_IP, ip))) return rateLimited();

  const token = c.env.UPLOAD_TOKEN;
  if (!token) {
    return errorResponse(500, 'not_configured', 'UPLOAD_TOKEN is not configured on the server.');
  }
  if (!(await isAuthorized(c.req.raw, token))) {
    return errorResponse(401, 'unauthorized', 'Missing or invalid token.', {
      'WWW-Authenticate': 'Bearer',
    });
  }
  await next();
});

function baseUrl(env: Env, requestUrl: string): string {
  return (env.PUBLIC_BASE_URL ?? new URL(requestUrl).origin).replace(/\/+$/, '');
}

async function handleUpload(c: Context<{ Bindings: Env }>, code?: string) {
  const limits = parseLimits(c.env);

  const lengthHeader = c.req.header('Content-Length');
  const size = lengthHeader === undefined ? NaN : Number(lengthHeader);
  if (!Number.isInteger(size) || size < 0) {
    return errorResponse(411, 'length_required', 'A Content-Length header is required.');
  }
  if (size === 0) return errorResponse(400, 'empty_file', 'Cannot upload an empty file.');
  if (size > limits.maxFileBytes) {
    return errorResponse(
      413,
      'file_too_large',
      `File is ${size} bytes; the limit is ${limits.maxFileBytes}.`,
    );
  }

  const ttlHeader = c.req.header('X-TTL-Seconds');
  const ttlSeconds = ttlHeader === undefined ? limits.defaultTtlSeconds : Number(ttlHeader);
  const maxDownloadsHeader = c.req.header('X-Max-Downloads');
  const maxDownloads = maxDownloadsHeader === undefined ? null : Number(maxDownloadsHeader);
  const filename = sanitizeFilename(c.req.header('X-Filename'));
  const contentType = sanitizeContentType(c.req.header('Content-Type'));
  const body = c.req.raw.body;
  if (!body) return errorResponse(400, 'empty_file', 'Cannot upload an empty file.');

  const registry = registryStub(c.env);
  const allocated = await registry.allocate({
    filename,
    contentType,
    size,
    ttlSeconds,
    maxDownloads,
    code,
  });
  if (!allocated.ok) {
    return errorResponse(statusForError(allocated.error), allocated.error, allocated.message);
  }

  try {
    const stored = await c.env.BUCKET.put(allocated.r2Key, body, {
      httpMetadata: { contentType },
      customMetadata: { filename },
    });
    if (stored.size !== size) throw new Error(`size mismatch: ${stored.size} != ${size}`);
  } catch (err) {
    console.error('upload failed', err);
    await c.env.BUCKET.delete(allocated.r2Key).catch(() => {});
    await registry.abort(allocated.code);
    return errorResponse(500, 'upload_failed', 'Upload failed; nothing was stored.');
  }

  const link = await registry.commit(allocated.code);
  if (!link) return errorResponse(500, 'upload_failed', 'Upload could not be committed.');

  const base = baseUrl(c.env, c.req.url);
  const result: UploadResult = {
    ...link,
    url: `${base}/${link.code}`,
    urlWithName: `${base}/${link.code}/${encodeURIComponent(link.filename)}`,
  };
  return jsonResponse(result, code ? 200 : 201);
}

api.post('/links/lookup', async (c) => {
  const body = await c.req.json<{ codes?: unknown }>().catch(() => ({}) as { codes?: unknown });
  const codes = body.codes;
  if (!Array.isArray(codes) || codes.length > 100 || !codes.every((x) => typeof x === 'string')) {
    return errorResponse(400, 'bad_request', 'Body must be {"codes": string[]} (max 100).');
  }
  return jsonResponse({ links: await registryStub(c.env).lookup(codes as string[]) });
});

api.post('/links', (c) => handleUpload(c));

api.put('/links/:code', (c) => {
  const code = c.req.param('code');
  if (!CODE_REGEX.test(code)) return errorResponse(400, 'bad_request', 'Invalid code.');
  return handleUpload(c, code);
});

api.get('/links/:code', async (c) => {
  const code = c.req.param('code');
  const link = CODE_REGEX.test(code) ? await registryStub(c.env).get(code) : null;
  return link ? jsonResponse(link) : errorResponse(404, 'not_found', 'No such link.');
});

api.post('/links/:code/refresh', async (c) => {
  const code = c.req.param('code');
  if (!CODE_REGEX.test(code)) return errorResponse(404, 'not_found', 'No such link.');
  const body = await c.req
    .json<{ ttlSeconds?: unknown }>()
    .catch(() => ({}) as { ttlSeconds?: unknown });
  const ttl = body.ttlSeconds;
  if (ttl !== undefined && ttl !== null && typeof ttl !== 'number') {
    return errorResponse(400, 'bad_request', 'ttlSeconds must be a number.');
  }
  const result = await registryStub(c.env).refresh(code, ttl ?? undefined);
  if (!result.ok) {
    return errorResponse(statusForError(result.error), result.error, result.message);
  }
  const out: RefreshResult = { ...result.link, url: `${baseUrl(c.env, c.req.url)}/${code}` };
  return jsonResponse(out);
});

api.post('/links/:code/revoke', async (c) => {
  const code = c.req.param('code');
  if (!CODE_REGEX.test(code)) return errorResponse(404, 'not_found', 'No such link.');
  const result = await registryStub(c.env).revoke(code);
  return result.ok
    ? jsonResponse(result.link)
    : errorResponse(statusForError(result.error), result.error, result.message);
});

api.delete('/links/:code', async (c) => {
  const code = c.req.param('code');
  const purged = CODE_REGEX.test(code) && (await registryStub(c.env).purge(code));
  return purged
    ? new Response(null, { status: 204 })
    : errorResponse(404, 'not_found', 'No such link.');
});

api.get('/status', async (c) => jsonResponse(await registryStub(c.env).status()));

api.notFound(() => errorResponse(404, 'not_found', 'Unknown API route.'));
