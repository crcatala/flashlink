import { env } from 'cloudflare:workers';
import { runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import type { LinkInfo, ServerStatus } from '@r2-fastlink/core';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  TOKEN,
  authed,
  call,
  forbiddenRegistry,
  postJson,
  registry,
  resetState,
  rowCount,
  run,
  setExpiry,
  upload,
  uploadOk,
} from './helpers.ts';

beforeEach(async () => {
  await resetState();
});

describe('upload and fetch', () => {
  it('uploads a file and serves the same bytes at the short link', async () => {
    const link = await uploadOk('hello world', { filename: 'hello.txt', type: 'text/plain' });
    expect(link.code).toMatch(/^[1-9A-HJ-NP-Za-km-z]{8}$/);
    expect(link.url).toBe(`https://fl.test/${link.code}`);
    expect(link.urlWithName).toBe(`https://fl.test/${link.code}/hello.txt`);
    expect(link.size).toBe(11);
    expect(link.expired).toBe(false);

    const res = await call(`/${link.code}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
    expect(res.headers.get('Content-Type')).toBe('text/plain; charset=utf-8');
    expect(res.headers.get('Content-Length')).toBe('11');
    expect(res.headers.get('Content-Disposition')).toContain('filename="hello.txt"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Robots-Tag')).toContain('noindex');
  });

  it('serves the same file with or without a filename suffix', async () => {
    const link = await uploadOk('abc');
    const a = await call(`/${link.code}/anything-at-all.bin`);
    expect(a.status).toBe(200);
    expect(await a.text()).toBe('abc');
  });

  it('serves binary data intact with its content type', async () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    const link = await uploadOk(bytes, { filename: 'bytes.bin', type: 'application/octet-stream' });
    const res = await call(`/${link.code}`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('sandboxes active content types only', async () => {
    const html = await uploadOk('<script>alert(1)</script>', {
      type: 'text/html',
      filename: 'x.html',
    });
    const png = await uploadOk('not really a png', { type: 'image/png', filename: 'x.png' });
    expect((await call(`/${html.code}`)).headers.get('Content-Security-Policy')).toBe('sandbox');
    expect((await call(`/${png.code}`)).headers.get('Content-Security-Policy')).toBeNull();
  });

  it('sanitizes hostile filenames and content types', async () => {
    const link = await uploadOk('x', {
      filename: '../../etc/pa"ss\nwd',
      type: 'text/html; <script>',
    });
    expect(link.filename).not.toMatch(/[\/\\"\n]/);
    const res = await call(`/${link.code}`);
    expect(res.headers.get('Content-Type')).toBe('application/octet-stream');
  });

  it('HEAD returns headers without a body and does not count a hit', async () => {
    const link = await uploadOk('hello');
    const head = await call(`/${link.code}`, { method: 'HEAD' });
    expect(head.status).toBe(200);
    expect(head.headers.get('Content-Length')).toBe('5');
    expect(await head.text()).toBe('');
    const info = (await (await authed(`/api/links/${link.code}`)).json()) as LinkInfo;
    expect(info.hits).toBe(0);
    await call(`/${link.code}`);
    const after = (await (await authed(`/api/links/${link.code}`)).json()) as LinkInfo;
    expect(after.hits).toBe(1);
    expect(after.lastHitAt).not.toBeNull();
  });
});

describe('range requests', () => {
  it('serves partial content', async () => {
    const link = await uploadOk('0123456789');
    const res = await call(`/${link.code}`, { headers: { Range: 'bytes=2-5' } });
    expect(res.status).toBe(206);
    expect(await res.text()).toBe('2345');
    expect(res.headers.get('Content-Range')).toBe('bytes 2-5/10');
    expect(res.headers.get('Content-Length')).toBe('4');
  });

  it('supports suffix and open-ended ranges', async () => {
    const link = await uploadOk('0123456789');
    const tail = await call(`/${link.code}`, { headers: { Range: 'bytes=-3' } });
    expect(await tail.text()).toBe('789');
    const open = await call(`/${link.code}`, { headers: { Range: 'bytes=8-' } });
    expect(await open.text()).toBe('89');
  });

  it('answers 416 for unsatisfiable ranges', async () => {
    const link = await uploadOk('0123456789');
    const res = await call(`/${link.code}`, { headers: { Range: 'bytes=50-60' } });
    expect(res.status).toBe(416);
    expect(res.headers.get('Content-Range')).toBe('bytes */10');
  });
});

describe('not found and malformed codes', () => {
  it('404s for unknown codes', async () => {
    const res = await call('/AAAAAAAA');
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: 'not_found' });
  });

  it('rejects malformed codes without ever touching the Durable Object', async () => {
    for (const path of [
      '/short',
      '/waytoolongcode',
      '/0OIl0OIl',
      '/abc%20defg',
      '/nope/file.png',
    ]) {
      expect((await run(path, { REGISTRY: forbiddenRegistry })).status).toBe(404);
    }
  });

  it('does not serve static-looking or api paths as links', async () => {
    expect((await call('/api/nothing')).status).toBe(401);
    expect((await authed('/api/nothing')).status).toBe(404);
  });
});

describe('expiry, refresh and revoke', () => {
  it('returns 410 after expiry and the same link works again after refresh', async () => {
    const link = await uploadOk('payload', { ttl: 60 });
    expect((await call(`/${link.code}`)).status).toBe(200);

    await setExpiry(link.code, -1000);
    const gone = await call(`/${link.code}`);
    expect(gone.status).toBe(410);
    expect(await gone.json()).toMatchObject({ error: 'gone' });
    const expired = (await (await authed(`/api/links/${link.code}`)).json()) as LinkInfo;
    expect(expired.expired).toBe(true);

    const refreshed = await postJson(`/api/links/${link.code}/refresh`, { ttlSeconds: 120 });
    expect(refreshed.status).toBe(200);
    const body = (await refreshed.json()) as LinkInfo & { url: string };
    expect(body.code).toBe(link.code);
    expect(body.url).toBe(link.url);
    expect(body.expired).toBe(false);
    const delta = Date.parse(body.expiresAt) - Date.now();
    expect(delta).toBeGreaterThan(110_000);
    expect(delta).toBeLessThanOrEqual(120_000);

    const again = await call(`/${link.code}`);
    expect(again.status).toBe(200);
    expect(await again.text()).toBe('payload');
  });

  it('applies the default TTL (1h) and honors a per-upload TTL', async () => {
    const def = await uploadOk('a');
    expect(Date.parse(def.expiresAt) - Date.now()).toBeGreaterThan(3_590_000);
    const short = await uploadOk('b', { ttl: 30 });
    expect(Date.parse(short.expiresAt) - Date.now()).toBeLessThanOrEqual(30_000);
  });

  it('refresh without a TTL uses the server default', async () => {
    const link = await uploadOk('a', { ttl: 10 });
    const res = await postJson(`/api/links/${link.code}/refresh`, {});
    const body = (await res.json()) as LinkInfo;
    expect(Date.parse(body.expiresAt) - Date.now()).toBeGreaterThan(3_590_000);
  });

  it('rejects TTLs beyond the maximum, on upload and refresh', async () => {
    const tooLong = await upload('x', { ttl: 8 * 86400 });
    expect(tooLong.status).toBe(400);
    expect(await tooLong.json()).toMatchObject({ error: 'ttl_too_long' });
    expect((await upload('x', { ttl: 0 })).status).toBe(400);
    expect((await upload('x', { ttl: 'abc' })).status).toBe(400);

    const link = await uploadOk('x');
    const res = await postJson(`/api/links/${link.code}/refresh`, { ttlSeconds: 8 * 86400 });
    expect(res.status).toBe(400);
  });

  it('revoke expires immediately and is reversible with refresh', async () => {
    const link = await uploadOk('secret');
    const revoked = await authed(`/api/links/${link.code}/revoke`, { method: 'POST' });
    expect(revoked.status).toBe(200);
    expect(((await revoked.json()) as LinkInfo).expired).toBe(true);
    expect((await call(`/${link.code}`)).status).toBe(410);
    expect((await postJson(`/api/links/${link.code}/refresh`, {})).status).toBe(200);
    expect((await call(`/${link.code}`)).status).toBe(200);
  });

  it('refresh and revoke 404 for unknown codes', async () => {
    expect((await postJson('/api/links/AAAAAAAA/refresh', {})).status).toBe(404);
    expect((await authed('/api/links/AAAAAAAA/revoke', { method: 'POST' })).status).toBe(404);
  });
});

describe('download cap', () => {
  it('stops serving after maxDownloads and resets on refresh', async () => {
    const link = await uploadOk('limited', { maxDownloads: 2 });
    expect(link.maxDownloads).toBe(2);
    expect((await call(`/${link.code}`)).status).toBe(200);
    expect((await call(`/${link.code}`)).status).toBe(200);
    const third = await call(`/${link.code}`);
    expect(third.status).toBe(410);
    expect(((await third.json()) as { message: string }).message).toMatch(/download limit/);

    expect((await postJson(`/api/links/${link.code}/refresh`, {})).status).toBe(200);
    expect((await call(`/${link.code}`)).status).toBe(200);
    const info = (await (await authed(`/api/links/${link.code}`)).json()) as LinkInfo;
    expect(info.hits).toBe(3);
  });

  it('rejects an invalid cap', async () => {
    expect((await upload('x', { maxDownloads: 0 })).status).toBe(400);
  });
});

describe('purge, re-create and sweeper', () => {
  it('DELETE removes the object and row immediately', async () => {
    const link = await uploadOk('bye');
    expect((await authed(`/api/links/${link.code}`, { method: 'DELETE' })).status).toBe(204);
    expect((await call(`/${link.code}`)).status).toBe(404);
    expect(await env.BUCKET.head(`objects/${link.code}`)).toBeNull();
    expect((await authed(`/api/links/${link.code}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('PUT re-creates a purged code and refuses an existing one', async () => {
    const link = await uploadOk('first');
    const clash = await authed(`/api/links/${link.code}`, {
      method: 'PUT',
      headers: { 'Content-Length': '3', 'Content-Type': 'text/plain' },
      body: 'two',
    });
    expect(clash.status).toBe(409);

    await authed(`/api/links/${link.code}`, { method: 'DELETE' });
    const recreated = await authed(`/api/links/${link.code}`, {
      method: 'PUT',
      headers: { 'Content-Length': '6', 'Content-Type': 'text/plain', 'X-Filename': 'again.txt' },
      body: 'second',
    });
    expect(recreated.status).toBe(200);
    expect(((await recreated.json()) as LinkInfo).code).toBe(link.code);
    expect(await (await call(`/${link.code}`)).text()).toBe('second');
  });

  it('PUT rejects malformed codes', async () => {
    const res = await authed('/api/links/bad', {
      method: 'PUT',
      headers: { 'Content-Length': '1' },
      body: 'x',
    });
    expect(res.status).toBe(400);
  });

  it('schedules an alarm on upload and the sweeper purges after the grace period', async () => {
    const stub = registry();
    const link = await uploadOk('sweep me');
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).not.toBeNull();

    // Expired but within grace: still stored, still refreshable.
    await setExpiry(link.code, -60_000);
    await runDurableObjectAlarm(stub);
    expect(await rowCount()).toBe(1);
    expect(await env.BUCKET.head(`objects/${link.code}`)).not.toBeNull();
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).not.toBeNull();

    // Past grace: swept, and no alarm left pending (the DO goes idle).
    await setExpiry(link.code, -8 * 86400_000);
    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect(await rowCount()).toBe(0);
    expect(await env.BUCKET.head(`objects/${link.code}`)).toBeNull();
    expect(await runInDurableObject(stub, (_i, s) => s.storage.getAlarm())).toBeNull();
    expect((await call(`/${link.code}`)).status).toBe(404);
  });

  it('reaps stale pending uploads', async () => {
    const stub = registry();
    const alloc = await stub.allocate({
      filename: 'x',
      contentType: 'text/plain',
      size: 10,
      ttlSeconds: 60,
    });
    expect(alloc.ok).toBe(true);
    await runInDurableObject(stub, (_i, s) => {
      s.storage.sql.exec('UPDATE links SET created_at = ?', Date.now() - 20 * 60_000);
    });
    await runDurableObjectAlarm(stub);
    expect(await rowCount()).toBe(0);
  });

  it('pending uploads are invisible and cannot be fetched', async () => {
    const alloc = await registry().allocate({
      filename: 'x',
      contentType: 'text/plain',
      size: 10,
      ttlSeconds: 60,
    });
    if (!alloc.ok) throw new Error('allocate failed');
    expect((await call(`/${alloc.code}`)).status).toBe(404);
    expect((await authed(`/api/links/${alloc.code}`)).status).toBe(404);
  });
});

describe('limits and validation', () => {
  it('rejects files over the size cap before reading the body', async () => {
    const res = await run(
      '/api/links',
      { REGISTRY: forbiddenRegistry },
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Length': '1001' },
        body: new Uint8Array(1001),
      },
    );
    expect(res.status).toBe(413);
    expect(await res.json()).toMatchObject({ error: 'file_too_large' });
  });

  it('accepts a file exactly at the cap', async () => {
    expect((await upload(new Uint8Array(1000))).status).toBe(201);
  });

  it('requires Content-Length and rejects empty bodies', async () => {
    const noLength = await authed('/api/links', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'x',
    });
    expect(noLength.status).toBe(411);
    expect((await upload('')).status).toBe(400);
  });

  it('enforces the total storage cap', async () => {
    for (let i = 0; i < 3; i++) await uploadOk(new Uint8Array(1000));
    const res = await upload(new Uint8Array(10));
    expect(res.status).toBe(507);
    expect(await res.json()).toMatchObject({ error: 'storage_full' });
  });

  it('enforces the daily upload cap', async () => {
    for (let i = 0; i < 6; i++) await uploadOk('x');
    const res = await upload('x');
    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ error: 'daily_limit' });
  });

  it('does not leave a pending row or object when the body is shorter than declared', async () => {
    const res = await authed('/api/links', {
      method: 'POST',
      headers: { 'Content-Length': '50', 'Content-Type': 'text/plain' },
      body: 'short',
    });
    expect(res.ok).toBe(false);
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
  });
});

describe('auth', () => {
  it('rejects missing, malformed and wrong tokens', async () => {
    for (const token of [null, '', 'wrong', 'Bearer x']) {
      const res = await upload('x', { token });
      expect(res.status).toBe(401);
      expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
    }
    expect((await call('/api/status')).status).toBe(401);
    expect((await call('/api/status', { headers: { Authorization: 'Basic abc' } })).status).toBe(
      401,
    );
  });

  it('never reaches the registry when unauthenticated', async () => {
    const res = await run(
      '/api/links',
      { REGISTRY: forbiddenRegistry },
      {
        method: 'POST',
        headers: { Authorization: 'Bearer wrong', 'Content-Length': '1' },
        body: 'x',
      },
    );
    expect(res.status).toBe(401);
  });
});

describe('status and lookup', () => {
  it('reports limits and usage', async () => {
    await uploadOk('hello');
    const live = await uploadOk('world!');
    await setExpiry(live.code, -1000);
    const status = (await (await authed('/api/status')).json()) as ServerStatus;
    expect(status.limits.maxFileBytes).toBe(1000);
    expect(status.limits.maxTtlSeconds).toBe(7 * 86400);
    expect(status.usage).toEqual({ linkCount: 2, activeCount: 1, totalBytes: 11, uploadsToday: 2 });
  });

  it('looks up many codes at once', async () => {
    const a = await uploadOk('a');
    const res = await postJson('/api/links/lookup', { codes: [a.code, 'AAAAAAAA', 'bad'] });
    const { links } = (await res.json()) as { links: Record<string, LinkInfo | null> };
    expect(links[a.code]?.code).toBe(a.code);
    expect(links.AAAAAAAA).toBeNull();
    expect(links.bad).toBeNull();
  });

  it('validates the lookup body', async () => {
    expect((await postJson('/api/links/lookup', { codes: 'x' })).status).toBe(400);
    expect(
      (await postJson('/api/links/lookup', { codes: Array(101).fill('AAAAAAAA') })).status,
    ).toBe(400);
  });
});

describe('cache headers', () => {
  it('marks every response no-store, including errors', async () => {
    const link = await uploadOk('cache me not');
    await setExpiry(link.code, -1000);
    const live = await uploadOk('0123456789');
    const responses: [string, Response][] = [
      ['404 unknown', await call('/AAAAAAAA')],
      ['404 malformed', await call('/nope')],
      ['410 expired', await call(`/${link.code}`)],
      ['416 range', await call(`/${live.code}`, { headers: { Range: 'bytes=50-60' } })],
      ['200 file', await call(`/${live.code}`)],
      ['401 api', await call('/api/status')],
      ['404 api', await authed('/api/nothing')],
      ['200 api', await authed('/api/status')],
      ['201 upload', await upload('x')],
    ];
    for (const [label, res] of responses) {
      expect(res.headers.get('Cache-Control'), label).toBe('no-store');
    }
    expect(responses.map(([, r]) => r.status)).toEqual([404, 404, 410, 416, 200, 401, 404, 200, 201]);
  });

  it('marks rate-limit and busy responses no-store too', async () => {
    const deny: RateLimit = { limit: async () => ({ success: false }) };
    const allow: RateLimit = { limit: async () => ({ success: true }) };
    const limited = await run('/AbCdEfGh', { LIMIT_IP: deny });
    const busy = await run('/AbCdEfGh', { LIMIT_IP: allow, LIMIT_GLOBAL: deny });
    expect([limited.status, busy.status]).toEqual([429, 503]);
    expect(limited.headers.get('Cache-Control')).toBe('no-store');
    expect(busy.headers.get('Cache-Control')).toBe('no-store');
  });
});
