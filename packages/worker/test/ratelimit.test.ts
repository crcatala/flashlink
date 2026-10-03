import { beforeEach, describe, expect, it } from 'vitest';
import { TOKEN, callReal, forbiddenRegistry, resetState, run, uploadOk } from './helpers.ts';

const allow: RateLimit = { limit: async () => ({ success: true }) };
const deny: RateLimit = { limit: async () => ({ success: false }) };
const keysSeen = (calls: string[]): RateLimit => ({
  limit: async ({ key }) => {
    calls.push(key);
    return { success: true };
  },
});

beforeEach(async () => {
  await resetState();
});

describe('rate limiting runs before the Durable Object', () => {
  it('429s a denied IP without touching the registry', async () => {
    const res = await run('/AbCdEfGh', {
      LIMIT_IP: deny,
      LIMIT_GLOBAL: allow,
      REGISTRY: forbiddenRegistry,
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('60');
  });

  it('503s when the global breaker trips, without touching the registry', async () => {
    const res = await run('/AbCdEfGh', {
      LIMIT_IP: allow,
      LIMIT_GLOBAL: deny,
      REGISTRY: forbiddenRegistry,
    });
    expect(res.status).toBe(503);
  });

  it('keys the per-IP limiter on CF-Connecting-IP and the breaker on "global"', async () => {
    const ipKeys: string[] = [];
    const globalKeys: string[] = [];
    await run(
      '/AbCdEfGh',
      { LIMIT_IP: keysSeen(ipKeys), LIMIT_GLOBAL: keysSeen(globalKeys) },
      { headers: { 'CF-Connecting-IP': '203.0.113.9' } },
    );
    expect(ipKeys).toEqual(['203.0.113.9']);
    expect(globalKeys).toEqual(['global']);
  });

  it('does not consult the limiters for malformed codes', async () => {
    const calls: string[] = [];
    const res = await run('/nope', { LIMIT_IP: keysSeen(calls), LIMIT_GLOBAL: keysSeen(calls) });
    expect(res.status).toBe(404);
    expect(calls).toEqual([]);
  });

  it('applies the per-IP limit to /api before authentication', async () => {
    const res = await run(
      '/api/status',
      { LIMIT_IP: deny },
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(429);
  });

  it('does not apply the global breaker to authenticated API calls', async () => {
    const res = await run(
      '/api/status',
      { LIMIT_IP: allow, LIMIT_GLOBAL: deny },
      { headers: { Authorization: `Bearer ${TOKEN}` } },
    );
    expect(res.status).toBe(200);
  });

  it('still serves live links when the limiter bindings are absent', async () => {
    const link = await uploadOk('works');
    const res = await run(`/${link.code}`, { LIMIT_IP: undefined, LIMIT_GLOBAL: undefined });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('works');
  });

  it('reports a missing R2FL_TOKEN as a server error instead of allowing access', async () => {
    const res = await run('/api/status', { R2FL_TOKEN: undefined });
    expect(res.status).toBe(500);
  });

  it('does not accept the old UPLOAD_TOKEN secret name, but says it was renamed', async () => {
    const res = await run('/api/status', {
      R2FL_TOKEN: undefined,
      UPLOAD_TOKEN: 'test-token-test-token-test-token-0123',
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('not_configured');
    expect(body.message).toContain('renamed to R2FL_TOKEN');
  });
});

describe('real rate-limit binding', () => {
  it('eventually returns 429 for a single IP hammering the fetch path', async () => {
    const headers = { 'CF-Connecting-IP': '198.51.100.77' };
    const statuses = new Set<number>();
    for (let i = 0; i < 100; i++) {
      statuses.add((await callReal('/AAAAAAAA', { headers })).status);
    }
    expect(statuses.has(404)).toBe(true);
    expect(statuses.has(429)).toBe(true);
    // A different IP is unaffected.
    const other = await callReal('/AAAAAAAA', { headers: { 'CF-Connecting-IP': '198.51.100.78' } });
    expect(other.status).toBe(404);
  });
});
