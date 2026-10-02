import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FastlinkClient, type LinkInfo } from '@r2-fastlink/core';
import { DEFAULT_CONFIG } from '../src/config.ts';
import type { Context } from '../src/context.ts';
import { createStyle } from '../src/format.ts';
import { History } from '../src/history.ts';

export const ENDPOINT = 'https://fl.test';

interface StoredLink extends LinkInfo {
  body: Uint8Array;
  expiresMs: number;
  /** Simulates the download cap being reached while the time window is still open. */
  exhausted?: boolean;
}

/** A tiny in-memory stand-in for the Worker API, enough to exercise every CLI command. */
export class FakeServer {
  links = new Map<string, StoredLink>();
  requests: { method: string; path: string; headers: Headers }[] = [];
  nextCodes = ['AAAAAAA1', 'AAAAAAA2', 'AAAAAAA3', 'AAAAAAA4'];
  failUploadsWith: { status: number; error: string; message: string } | null = null;
  now = Date.now();

  fetch = async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = new Headers(init.headers);
    this.requests.push({ method, path: url.pathname, headers });
    if (headers.get('Authorization') !== 'Bearer secret-token') {
      return json({ error: 'unauthorized', message: 'Missing or invalid token.' }, 401);
    }
    const p = url.pathname;
    let m: RegExpExecArray | null;

    if (method === 'GET' && p === '/api/status') {
      return json({
        limits: {
          maxFileBytes: 50 * 1024 * 1024,
          maxTtlSeconds: 604800,
          defaultTtlSeconds: 3600,
          maxTotalBytes: 2 * 1024 ** 3,
          maxUploadsPerDay: 200,
          purgeGraceSeconds: 604800,
        },
        usage: {
          linkCount: this.links.size,
          activeCount: this.links.size,
          totalBytes: 10,
          uploadsToday: 1,
        },
      });
    }
    if (
      (method === 'POST' && p === '/api/links') ||
      (method === 'PUT' && (m = /^\/api\/links\/(\w{8})$/.exec(p)))
    ) {
      if (this.failUploadsWith) {
        const f = this.failUploadsWith;
        return json({ error: f.error, message: f.message }, f.status);
      }
      const code = method === 'PUT' ? m![1]! : this.nextCodes.shift()!;
      if (this.links.has(code))
        return json({ error: 'exists', message: 'That code is already in use.' }, 409);
      const body = new Uint8Array(init.body as Uint8Array);
      const ttl = Number(headers.get('X-TTL-Seconds') ?? 3600);
      const link: StoredLink = {
        code,
        filename: decodeURIComponent(headers.get('X-Filename') ?? 'file'),
        contentType: headers.get('Content-Type') ?? 'application/octet-stream',
        size: body.length,
        createdAt: new Date(this.now).toISOString(),
        expiresAt: new Date(this.now + ttl * 1000).toISOString(),
        expired: false,
        maxDownloads: headers.get('X-Max-Downloads')
          ? Number(headers.get('X-Max-Downloads'))
          : null,
        hits: 0,
        lastHitAt: null,
        body,
        expiresMs: this.now + ttl * 1000,
      };
      this.links.set(code, link);
      return json(this.result(link), method === 'PUT' ? 200 : 201);
    }
    if (method === 'POST' && p === '/api/links/lookup') {
      const { codes } = JSON.parse(String(init.body)) as { codes: string[] };
      return json({
        links: Object.fromEntries(
          codes.map((c) => [c, this.links.has(c) ? this.info(this.links.get(c)!) : null]),
        ),
      });
    }
    if ((m = /^\/api\/links\/(\w{8})\/refresh$/.exec(p)) && method === 'POST') {
      const link = this.links.get(m[1]!);
      if (!link) return json({ error: 'not_found', message: 'No such link.' }, 404);
      const { ttlSeconds } = JSON.parse(String(init.body)) as { ttlSeconds?: number };
      link.expiresMs = this.now + (ttlSeconds ?? 3600) * 1000;
      link.exhausted = false;
      return json({ ...this.info(link), url: `${ENDPOINT}/${link.code}` });
    }
    if ((m = /^\/api\/links\/(\w{8})\/revoke$/.exec(p)) && method === 'POST') {
      const link = this.links.get(m[1]!);
      if (!link) return json({ error: 'not_found', message: 'No such link.' }, 404);
      link.expiresMs = this.now;
      return json(this.info(link));
    }
    if ((m = /^\/api\/links\/(\w{8})$/.exec(p)) && method === 'DELETE') {
      return this.links.delete(m[1]!)
        ? new Response(null, { status: 204 })
        : json({ error: 'not_found', message: 'No such link.' }, 404);
    }
    return json({ error: 'not_found', message: 'Unknown API route.' }, 404);
  };

  /** Simulate the server purging a link's object and row. */
  purge(code: string) {
    this.links.delete(code);
  }

  private info(link: StoredLink): LinkInfo {
    const { body: _b, expiresMs, exhausted, ...rest } = link;
    return {
      ...rest,
      expiresAt: new Date(expiresMs).toISOString(),
      expired: this.now >= expiresMs || Boolean(exhausted),
    };
  }

  private result(link: StoredLink) {
    return {
      ...this.info(link),
      url: `${ENDPOINT}/${link.code}`,
      urlWithName: `${ENDPOINT}/${link.code}/${encodeURIComponent(link.filename)}`,
    };
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export interface Harness {
  ctx: Context;
  server: FakeServer;
  dir: string;
  stdout: string[];
  stderr: string[];
  clipboard: string[];
  stdin: { data: Buffer; isTTY: boolean };
  file(name: string, content: string | Buffer): string;
  cleanup(): void;
}

export function makeHarness(overrides: Partial<Context['config']> = {}): Harness {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-test-'));
  const server = new FakeServer();
  const stdout: string[] = [];
  const stderr: string[] = [];
  const clipboard: string[] = [];
  const stdin = { data: Buffer.alloc(0), isTTY: false };
  const env = { R2FL_CONFIG_DIR: path.join(dir, 'config'), R2FL_DATA_DIR: path.join(dir, 'data') };
  const config = { ...DEFAULT_CONFIG, endpoint: ENDPOINT, token: 'secret-token', ...overrides };
  const ctx: Context = {
    config,
    history: new History(path.join(dir, 'data', 'history.json')),
    style: createStyle(false),
    env,
    get stdinIsTTY() {
      return stdin.isTTY;
    },
    now: () => server.now,
    out: (t) => stdout.push(t),
    err: (t) => stderr.push(t),
    client: () => new FastlinkClient(ENDPOINT, 'secret-token', server.fetch as typeof fetch),
    copy: async (t) => {
      clipboard.push(t);
      return true;
    },
    readStdin: async () => stdin.data,
    prompt: async () => {
      throw new Error('unexpected prompt');
    },
  };
  return {
    ctx,
    server,
    dir,
    stdout,
    stderr,
    clipboard,
    stdin,
    file(name, content) {
      const p = path.join(dir, name);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
      return p;
    },
    cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
  };
}
