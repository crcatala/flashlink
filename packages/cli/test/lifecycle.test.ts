import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refresh } from '../src/commands/refresh.ts';
import { revoke } from '../src/commands/revoke.ts';
import { ls } from '../src/commands/ls.ts';
import { up } from '../src/commands/up.ts';
import { entryStatus } from '../src/history.ts';
import { makeHarness, type Harness } from './harness.ts';

let h: Harness;
let file: string;
beforeEach(async () => {
  h = makeHarness();
  file = h.file('report.txt', 'quarterly numbers');
  await up([file], { ttl: '1h' }, h.ctx);
  h.stdout.length = 0;
  h.stderr.length = 0;
  h.clipboard.length = 0;
});
afterEach(() => h.cleanup());

const hours = (n: number) => n * 3600_000;

describe('fl refresh', () => {
  it('re-opens an expired link under the same URL and updates history', async () => {
    h.server.now += hours(2);
    expect(entryStatus(h.ctx.history.find('AAAAAAA1')!, h.server.now)).toBe('expired');

    await refresh('AAAAAAA1', { ttl: '30m' }, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.clipboard).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.server.requests.at(-1)!.path).toBe('/api/links/AAAAAAA1/refresh');

    const entry = h.ctx.history.find('AAAAAAA1')!;
    expect(entryStatus(entry, h.server.now)).toBe('live');
    expect(Date.parse(entry.expiresAt) - h.server.now).toBe(30 * 60_000);
    expect(entry.lastRefreshedAt).not.toBeNull();
    expect(entry.ttlSeconds).toBe(1800);
  });

  it('accepts a full URL (with filename) and defaults to the configured TTL', async () => {
    await refresh('https://fl.test/AAAAAAA1/report.txt', {}, h.ctx);
    const body = h.server.requests.at(-1)!;
    expect(body.path).toBe('/api/links/AAAAAAA1/refresh');
    expect(Date.parse(h.ctx.history.find('AAAAAAA1')!.expiresAt) - h.server.now).toBe(hours(1));
  });

  it('with no argument refreshes the most recent upload', async () => {
    await up([h.file('second.txt', 'two')], {}, h.ctx);
    h.stdout.length = 0;
    await refresh(undefined, {}, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA2']);
  });

  it('re-uploads the original file under the same code after a purge', async () => {
    h.server.purge('AAAAAAA1');
    await refresh('AAAAAAA1', {}, h.ctx);

    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    const put = h.server.requests.find((r) => r.method === 'PUT')!;
    expect(put.path).toBe('/api/links/AAAAAAA1');
    expect(Buffer.from(h.server.links.get('AAAAAAA1')!.body).toString()).toBe('quarterly numbers');
    expect(h.stderr.join('\n')).toContain('re-uploaded');
    expect(entryStatus(h.ctx.history.find('AAAAAAA1')!, h.server.now)).toBe('live');
  });

  it('will not re-upload if the file changed since upload', async () => {
    h.server.purge('AAAAAAA1');
    fs.writeFileSync(file, 'edited later');
    await expect(refresh('AAAAAAA1', {}, h.ctx)).rejects.toThrow(/has changed/);
    expect(h.server.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('explains when the source file is gone, the upload came from stdin, or it is unknown', async () => {
    h.server.purge('AAAAAAA1');
    fs.rmSync(file);
    await expect(refresh('AAAAAAA1', {}, h.ctx)).rejects.toThrow(/original file is gone/);

    h.stdin.data = Buffer.from('from a pipe');
    await up([], { name: 'p.txt' }, h.ctx);
    h.server.purge('AAAAAAA2');
    await expect(refresh('AAAAAAA2', {}, h.ctx)).rejects.toThrow(/came from stdin/);

    await expect(refresh('ZZZZZZZZ', {}, h.ctx)).rejects.toThrow(/not in your local history/);
  });

  it('rejects garbage targets and empty history', async () => {
    await expect(refresh('not a link', {}, h.ctx)).rejects.toThrow(/not a link code or URL/);
    const fresh = makeHarness();
    await expect(refresh(undefined, {}, fresh.ctx)).rejects.toThrow(/No history yet/);
    fresh.cleanup();
  });
});

describe('fl revoke', () => {
  it('closes a link now and marks history revoked', async () => {
    await revoke('AAAAAAA1', {}, h.ctx);
    const entry = h.ctx.history.find('AAAAAAA1')!;
    expect(entry.state).toBe('revoked');
    expect(entryStatus(entry, h.server.now)).toBe('revoked');
    expect(h.stderr.join('\n')).toContain('fl refresh AAAAAAA1');
  });

  it('--purge deletes from the server and marks history purged', async () => {
    await revoke('AAAAAAA1', { purge: true }, h.ctx);
    expect(h.server.links.has('AAAAAAA1')).toBe(false);
    expect(h.ctx.history.find('AAAAAAA1')!.state).toBe('purged');
  });

  it('reports links the server no longer knows and records them as purged', async () => {
    h.server.purge('AAAAAAA1');
    await expect(revoke('AAAAAAA1', {}, h.ctx)).rejects.toThrow(/no longer exists/);
    expect(h.ctx.history.find('AAAAAAA1')!.state).toBe('purged');
  });
});

describe('fl ls', () => {
  it('shows newest first with live/expired/revoked/purged statuses', async () => {
    await up([h.file('b.txt', 'b')], {}, h.ctx); // AAAAAAA2
    await up([h.file('c.txt', 'c')], {}, h.ctx); // AAAAAAA3
    await up([h.file('d.txt', 'd')], { ttl: '1m' }, h.ctx); // AAAAAAA4
    await revoke('AAAAAAA2', {}, h.ctx);
    await revoke('AAAAAAA3', { purge: true }, h.ctx);
    h.server.now += 5 * 60_000; // AAAAAAA4 expires
    h.stdout.length = 0;

    await ls({}, h.ctx);
    const lines = h.stdout[0]!.split('\n');
    expect(lines[0]).toMatch(/^CODE\s+FILE\s+SIZE\s+STATUS\s+URL$/);
    expect(lines[1]).toMatch(/AAAAAAA4\s+d\.txt\s+1 B\s+expired/);
    expect(lines[2]).toMatch(/AAAAAAA3\s+c\.txt\s+1 B\s+purged/);
    expect(lines[3]).toMatch(/AAAAAAA2\s+b\.txt\s+1 B\s+revoked/);
    expect(lines[4]).toMatch(
      /AAAAAAA1\s+report\.txt\s+17 B\s+live · 55m left\s+https:\/\/fl\.test\/AAAAAAA1/,
    );
  });

  it('filters, limits and emits JSON', async () => {
    await up([h.file('b.txt', 'b')], { ttl: '1m' }, h.ctx);
    h.server.now += 5 * 60_000;
    h.stdout.length = 0;

    await ls({ live: true, json: true }, h.ctx);
    const live = JSON.parse(h.stdout[0]!);
    expect(live.map((e: { code: string }) => e.code)).toEqual(['AAAAAAA1']);
    expect(live[0].status).toBe('live');

    h.stdout.length = 0;
    await ls({ limit: 1 }, h.ctx);
    expect(h.stdout[0]!.split('\n')).toHaveLength(2);
    expect(h.stderr.join('\n')).toContain('1 older entry hidden');
  });

  it('--sync pulls expiry and hit counts from the server and detects purges', async () => {
    await up([h.file('b.txt', 'b')], {}, h.ctx); // AAAAAAA2
    h.server.links.get('AAAAAAA1')!.hits = 7;
    h.server.purge('AAAAAAA2');
    h.stdout.length = 0;
    await ls({ sync: true, json: true }, h.ctx);
    const byCode = Object.fromEntries(
      (JSON.parse(h.stdout[0]!) as { code: string; hits: number; status: string }[]).map((e) => [
        e.code,
        e,
      ]),
    );
    expect(byCode.AAAAAAA1).toMatchObject({ hits: 7, status: 'live' });
    expect(byCode.AAAAAAA2!.status).toBe('purged');
  });

  it('--sync marks download-capped links exhausted (not live), and refresh clears it', async () => {
    h.server.links.get('AAAAAAA1')!.exhausted = true;

    await ls({ sync: true, json: true }, h.ctx);
    const synced = JSON.parse(h.stdout[0]!) as { code: string; status: string }[];
    expect(synced.find((e) => e.code === 'AAAAAAA1')!.status).toBe('exhausted');

    h.stdout.length = 0;
    await ls({ sync: true, live: true }, h.ctx);
    expect(h.stderr.join('\n')).toContain('No live links');

    h.stdout.length = 0;
    await ls({}, h.ctx);
    expect(h.stdout[0]).toMatch(/AAAAAAA1.*exhausted · download limit reached/);

    await refresh('AAAAAAA1', {}, h.ctx);
    expect(entryStatus(h.ctx.history.find('AAAAAAA1')!, h.server.now)).toBe('live');
    h.stdout.length = 0;
    await ls({ sync: true, live: true, json: true }, h.ctx);
    expect(JSON.parse(h.stdout[0]!).map((e: { code: string }) => e.code)).toEqual(['AAAAAAA1']);
  });

  it('a sync that finds the cap cleared server-side flips exhausted back to live', async () => {
    h.server.links.get('AAAAAAA1')!.exhausted = true;
    await ls({ sync: true, json: true }, h.ctx);
    h.server.links.get('AAAAAAA1')!.exhausted = false; // e.g. refreshed from another machine
    h.stdout.length = 0;
    await ls({ sync: true, json: true }, h.ctx);
    expect(JSON.parse(h.stdout[0]!)[0].status).toBe('live');
  });

  it('prints a friendly message when there is no history', async () => {
    const fresh = makeHarness();
    await ls({}, fresh.ctx);
    expect(fresh.stderr.join('\n')).toContain('No history yet');
    fresh.cleanup();
  });
});
