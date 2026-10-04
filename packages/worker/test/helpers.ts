import { env, exports } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import worker from '../src/index.ts';
import type { Env } from '../src/env.ts';
import type { UploadResult } from '@flashlink/core';

export const TOKEN = 'test-token-test-token-test-token-0123';
export const BASE = 'https://fl.test';

export const allowAll: RateLimit = { limit: async () => ({ success: true }) };

/** Call the Worker with the real bindings, except the rate limiters (see ratelimit.test.ts). */
export function call(path: string, init: RequestInit = {}): Promise<Response> {
  return run(path, { LIMIT_IP: allowAll, LIMIT_GLOBAL: allowAll }, init);
}

/** Call the Worker through its real entrypoint, including the real rate-limit bindings. */
export function callReal(path: string, init: RequestInit = {}): Promise<Response> {
  return exports.default.fetch(new Request(`${BASE}${path}`, init));
}

export interface UploadOpts {
  filename?: string;
  type?: string;
  ttl?: number | string;
  maxDownloads?: number;
  token?: string | null;
  headers?: Record<string, string>;
}

export function upload(body: string | Uint8Array, opts: UploadOpts = {}): Promise<Response> {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  const headers: Record<string, string> = {
    'Content-Type': opts.type ?? 'text/plain',
    'Content-Length': String(bytes.length),
    'X-Filename': encodeURIComponent(opts.filename ?? 'hello.txt'),
    ...opts.headers,
  };
  if (opts.token !== null) headers.Authorization = `Bearer ${opts.token ?? TOKEN}`;
  if (opts.ttl !== undefined) headers['X-TTL-Seconds'] = String(opts.ttl);
  if (opts.maxDownloads !== undefined) headers['X-Max-Downloads'] = String(opts.maxDownloads);
  return call('/api/links', { method: 'POST', headers, body: bytes });
}

export async function uploadOk(body: string | Uint8Array, opts: UploadOpts = {}) {
  const res = await upload(body, opts);
  if (res.status !== 201) throw new Error(`upload failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as UploadResult;
}

export function authed(path: string, init: RequestInit = {}): Promise<Response> {
  return call(path, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers as Record<string, string>) },
  });
}

export function postJson(path: string, body: unknown): Promise<Response> {
  return authed(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function registry() {
  return env.REGISTRY.get(env.REGISTRY.idFromName('registry'));
}

/** Move a link's expiry relative to now (negative = in the past). */
export async function setExpiry(code: string, offsetMs: number): Promise<void> {
  await runInDurableObject(registry(), (_instance, state) => {
    state.storage.sql.exec(
      'UPDATE links SET expires_at = ? WHERE code = ?',
      Date.now() + offsetMs,
      code,
    );
  });
}

export async function rowCount(): Promise<number> {
  return runInDurableObject(
    registry(),
    (_i, state) => state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM links').one().n,
  );
}

/** Clear all registry rows, the alarm, and every R2 object between tests. */
export async function resetState(): Promise<void> {
  await runInDurableObject(registry(), async (_instance, state) => {
    state.storage.sql.exec('DELETE FROM links');
    state.storage.sql.exec('DELETE FROM uploads');
    await state.storage.deleteAlarm();
  });
  let listing = await env.BUCKET.list();
  while (listing.objects.length > 0) {
    await env.BUCKET.delete(listing.objects.map((o) => o.key));
    listing = await env.BUCKET.list();
  }
}

/** A namespace that throws if anything touches it: proves a request never reached the DO. */
export const forbiddenRegistry = new Proxy(
  {},
  {
    get() {
      throw new Error('registry must not be touched');
    },
  },
) as Env['REGISTRY'];

/** Invoke the Worker directly with some bindings replaced (limiters, registry, token...). */
export function run(
  path: string,
  overrides: Partial<Env>,
  init: RequestInit = {},
): Promise<Response> {
  return Promise.resolve(
    worker.fetch(new Request(`${BASE}${path}`, init), { ...env, ...overrides } as Env),
  );
}
