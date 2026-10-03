#!/usr/bin/env node
// Black-box verification of a running r2-fastlink deployment (real Cloudflare or `wrangler dev`).
//
//   R2FL_TOKEN=<upload token> node scripts/verify-deployment.mjs --endpoint https://<worker-url>
//
// It talks plain HTTP only (Node 22+, no dependencies), uploads a few throwaway files, exercises
// fetch/expiry/refresh/revoke/purge, probes the rate limiter, then purges everything it created.
// Exit code is 1 if any check FAILs. See docs/VERIFY_DEPLOYMENT.md for how to read the report.
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { parseArgs } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';

const HELP = `Usage: R2FL_TOKEN=... node scripts/verify-deployment.mjs --endpoint <url> [options]

  --endpoint <url>        Worker base URL (or env R2FL_ENDPOINT)
  --large-mb <n>          size of the large upload in MiB (default 49, capped below the server limit)
  --skip-large            skip the large upload and the over-limit (413) upload
  --sweeper               also test the sweeper alarm (needs PURGE_GRACE_SECONDS <= 300 on the server)
  --skip-ratelimit        skip the rate-limit probe (it throttles your IP for about a minute)
  --probe-requests <n>    requests sent by the rate-limit probe (default 150)
  --max-rpm <n>           self-imposed request pace for normal checks (default 45, 0 = unlimited);
                          the per-IP limit is 60/min and also covers /api
  -h, --help              show this help

The token is read from the environment only (R2FL_TOKEN) so it never shows up in a process list.`;

const { values: opts } = parseArgs({
  options: {
    endpoint: { type: 'string' },
    'large-mb': { type: 'string', default: '49' },
    'skip-large': { type: 'boolean', default: false },
    sweeper: { type: 'boolean', default: false },
    'skip-ratelimit': { type: 'boolean', default: false },
    'probe-requests': { type: 'string', default: '150' },
    'max-rpm': { type: 'string', default: '45' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

if (opts.help) {
  console.log(HELP);
  process.exit(0);
}

const endpointArg = opts.endpoint ?? process.env.R2FL_ENDPOINT;
const token = process.env.R2FL_TOKEN;
if (!endpointArg || !token) {
  console.error(HELP);
  console.error('\nerror: --endpoint (or R2FL_ENDPOINT) and R2FL_TOKEN are required.');
  process.exit(2);
}
let endpoint;
try {
  endpoint = new URL(endpointArg).origin;
} catch {
  console.error(`error: not a valid URL: ${endpointArg}`);
  process.exit(2);
}

const MIB = 1024 * 1024;
const largeMb = Number(opts['large-mb']);
const probeRequests = Number(opts['probe-requests']);
const maxRpm = Number(opts['max-rpm']);
for (const [name, v] of [
  ['--large-mb', largeMb],
  ['--probe-requests', probeRequests],
  ['--max-rpm', maxRpm],
]) {
  if (!Number.isFinite(v) || v < 0) {
    console.error(`error: ${name} must be a non-negative number`);
    process.exit(2);
  }
}

// ---- HTTP plumbing ---------------------------------------------------------------------

const stats = { requests: 0, throttled: 0, cacheStatuses: new Set() };
const sent = []; // timestamps of paced requests, for the rolling 60 s window
const created = new Set(); // codes to purge at the end

/** Keep normal checks under the per-IP rate limit so that a 429 is a real finding. */
async function pace() {
  if (maxRpm === 0) return;
  for (;;) {
    const now = Date.now();
    while (sent.length && now - sent[0] > 60_000) sent.shift();
    if (sent.length < maxRpm) break;
    await sleep(sent[0] + 60_000 - now + 50);
  }
  sent.push(Date.now());
}

/**
 * One HTTP request, fully buffered. Retries (after Retry-After) when the server rate limits us
 * during normal checks; those are counted so the report can flag unexpected throttling.
 */
async function http(
  url,
  { method = 'GET', headers = {}, body, paced = true, retry = true, track = true } = {},
) {
  for (let attempt = 0; ; attempt++) {
    if (paced) await pace();
    let res;
    let buf;
    try {
      res = await fetch(url, { method, headers, body, duplex: 'half' });
      buf = Buffer.from(await res.arrayBuffer());
    } catch (err) {
      throw new Error(
        `${method} ${new URL(url).pathname} failed: ${err.cause?.code ?? err.cause?.errors?.[0]?.code ?? err.cause?.message ?? err.message}`,
      );
    }
    stats.requests++;
    const cache = res.headers.get('cf-cache-status');
    // Static assets (landing page) are legitimately cacheable; only Worker responses must not be.
    if (cache && track) stats.cacheStatuses.add(cache.toUpperCase());
    const out = {
      status: res.status,
      headers: res.headers,
      buf,
      text: () => buf.toString('utf8'),
      json: () => {
        try {
          return JSON.parse(buf.toString('utf8'));
        } catch {
          return {};
        }
      },
    };
    const throttled =
      res.status === 429 || (res.status === 503 && out.json().error === 'rate_limited');
    if (throttled && retry && attempt < 2) {
      stats.throttled++;
      const wait = Math.min(Number(res.headers.get('retry-after')) || 30, 70);
      console.log(`      (throttled with ${res.status}; waiting ${wait}s before retrying)`);
      await sleep(wait * 1000);
      continue;
    }
    return out;
  }
}

const api = (method, path, { headers, json, body, auth = true } = {}) =>
  http(`${endpoint}/api${path}`, {
    method,
    headers: {
      ...(auth ? { Authorization: `Bearer ${auth === true ? token : auth}` } : {}),
      ...(json === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers,
    },
    body: json === undefined ? body : JSON.stringify(json),
  });

/** A streaming request body (sent chunked, no Content-Length) made of `bytes` in 1 MiB pieces. */
function chunked(bytes) {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, offset + MIB));
      offset += MIB;
    },
  });
}

/** Upload bytes; returns the raw response. Tracks created codes for cleanup. */
async function upload(bytes, { name, type, ttl, maxDownloads, code } = {}) {
  const headers = { 'Content-Type': type ?? 'application/octet-stream' };
  if (name) headers['X-Filename'] = encodeURIComponent(name);
  if (ttl !== undefined) headers['X-TTL-Seconds'] = String(ttl);
  if (maxDownloads !== undefined) headers['X-Max-Downloads'] = String(maxDownloads);
  const res = await api(code ? 'PUT' : 'POST', code ? `/links/${code}` : '/links', {
    headers,
    body: bytes,
  });
  const link = res.json();
  if (link.code) created.add(link.code);
  return res;
}

async function uploadOk(bytes, options) {
  const res = await upload(bytes, options);
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`upload returned ${res.status}: ${res.text().slice(0, 200)}`);
  }
  return res.json();
}

// ---- tiny test framework ---------------------------------------------------------------

const results = [];
const icon = { PASS: 'PASS', FAIL: 'FAIL', WARN: 'WARN', INFO: 'INFO', SKIP: 'SKIP' };

function record(status, name, detail) {
  results.push({ status, name, detail });
  console.log(`${icon[status]}  ${name}${detail ? `: ${detail}` : ''}`);
}

/** Run one check. Return a string (detail), {detail}, or {warn} from `fn`; throw to FAIL. */
async function check(name, fn) {
  try {
    const out = await fn();
    const r = typeof out === 'string' ? { detail: out } : (out ?? {});
    record(r.warn ? 'WARN' : 'PASS', name, r.warn ?? r.detail);
  } catch (err) {
    record('FAIL', name, err.message);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}
function eq(actual, expected, what) {
  if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}
function need(value, what) {
  if (value === undefined) throw new Error(`skipped: ${what} did not complete`);
  return value;
}
const header = (res, name) => res.headers.get(name) ?? '';
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const fmtMiB = (n) => `${(n / MIB).toFixed(1)} MiB`;
const hit = (link, extra) => http(link.url, extra);
const noStore = (res, what) =>
  eq(header(res, 'cache-control'), 'no-store', `${what} Cache-Control`);

// ---- run ---------------------------------------------------------------------------------

console.log(`Verifying ${endpoint}\n`);
const S = {}; // state shared between checks

await check('status endpoint answers with the token (limits and usage)', async () => {
  const res = await api('GET', '/status');
  eq(res.status, 200, 'GET /api/status');
  S.status = res.json();
  S.limits = S.status.limits;
  const l = S.limits;
  return `maxFile=${fmtMiB(l.maxFileBytes)} maxTtl=${l.maxTtlSeconds}s defaultTtl=${l.defaultTtlSeconds}s grace=${l.purgeGraceSeconds}s; baseline ${S.status.usage.linkCount} links, ${fmtMiB(S.status.usage.totalBytes)}, ${S.status.usage.uploadsToday} uploads today`;
});
if (!S.limits) {
  console.log('\nCannot continue without a working /api/status (wrong endpoint or token?).');
  process.exit(1);
}

await check('API rejects missing and wrong tokens with 401', async () => {
  const none = await api('GET', '/status', { auth: false });
  eq(none.status, 401, 'no token');
  eq(none.json().error, 'unauthorized', 'no token error code');
  const wrong = await api('GET', '/status', { auth: 'definitely-not-the-token' });
  eq(wrong.status, 401, 'wrong token');
});

await check('landing page and robots.txt are served', async () => {
  const home = await http(`${endpoint}/`, { track: false });
  eq(home.status, 200, 'GET /');
  assert(header(home, 'content-type').startsWith('text/html'), 'GET / is not text/html');
  const robots = await http(`${endpoint}/robots.txt`, { track: false });
  eq(robots.status, 200, 'GET /robots.txt');
});

// -- uploads of several sizes (checklist items 3 and 4) --

const payloads = {};

await check('upload + fetch a small text file (default Accept-Encoding)', async () => {
  const bytes = Buffer.from('hello from verify-deployment\n');
  const link = await uploadOk(bytes, { name: 'note.txt', type: 'text/plain', ttl: 600 });
  S.text = link;
  assert(/^[1-9A-HJ-NP-Za-km-z]{8}$/.test(link.code), `bad code ${link.code}`);
  eq(link.size, bytes.length, 'reported size');
  eq(link.filename, 'note.txt', 'filename');
  const res = await hit(link);
  eq(res.status, 200, 'GET url');
  eq(res.text(), bytes.toString(), 'body');
  const type = header(res, 'content-type');
  assert(/^text\/plain;\s*charset=utf-8$/i.test(type), `content-type is "${type}"`);
  return `${link.url}`;
});

await check('public URL origin matches the endpoint (PUBLIC_BASE_URL unset or equal)', async () => {
  const link = need(S.text, 'text upload');
  if (new URL(link.url).origin === endpoint) return 'URLs use the endpoint origin';
  return {
    warn: `URLs use ${new URL(link.url).origin} (PUBLIC_BASE_URL?); the fetch checks below use those URLs`,
  };
});

await check('response headers on a served file', async () => {
  const link = need(S.text, 'text upload');
  const res = await hit(link, { headers: { 'Accept-Encoding': 'identity' } });
  eq(res.status, 200, 'GET url');
  noStore(res, '200');
  eq(header(res, 'x-content-type-options'), 'nosniff', 'X-Content-Type-Options');
  eq(header(res, 'referrer-policy'), 'no-referrer', 'Referrer-Policy');
  eq(header(res, 'accept-ranges'), 'bytes', 'Accept-Ranges');
  eq(header(res, 'content-length'), String(link.size), 'Content-Length');
  assert(header(res, 'content-disposition').includes('note.txt'), 'Content-Disposition lacks name');
  assert(header(res, 'x-robots-tag').includes('noindex'), 'X-Robots-Tag lacks noindex');
});

await check('HTML is served with a sandbox CSP', async () => {
  const link = await uploadOk(Buffer.from('<script>1</script>'), {
    name: 'p.html',
    type: 'text/html',
    ttl: 300,
  });
  const res = await hit(link);
  eq(res.status, 200, 'GET url');
  eq(header(res, 'content-security-policy'), 'sandbox', 'Content-Security-Policy');
});

await check('upload + fetch a ~1 MiB binary file; bytes and Content-Length intact', async () => {
  payloads.image = randomBytes(MIB);
  const link = await uploadOk(payloads.image, { name: 'shot.png', type: 'image/png', ttl: 900 });
  S.image = link;
  eq(link.size, payloads.image.length, 'reported size');
  const res = await hit(link, { headers: { 'Accept-Encoding': 'identity' } });
  eq(res.status, 200, 'GET url');
  eq(sha256(res.buf), sha256(payloads.image), 'sha256 of fetched bytes');
  eq(header(res, 'content-length'), String(MIB), 'Content-Length');
  eq(header(res, 'content-type'), 'image/png', 'Content-Type');
});

if (opts['skip-large']) {
  record('SKIP', 'large upload and over-limit upload', '--skip-large');
} else {
  await check('upload + fetch a large file near the size limit', async () => {
    const size = Math.min(Math.round(largeMb * MIB), S.limits.maxFileBytes - 1);
    const bytes = randomBytes(size);
    const t0 = Date.now();
    const link = await uploadOk(bytes, { name: 'large.bin', ttl: 900 });
    const upSecs = (Date.now() - t0) / 1000;
    eq(link.size, size, 'reported size');
    const t1 = Date.now();
    const res = await hit(link, { headers: { 'Accept-Encoding': 'identity' } });
    const downSecs = (Date.now() - t1) / 1000;
    eq(res.status, 200, 'GET url');
    eq(sha256(res.buf), sha256(bytes), 'sha256 of fetched bytes');
    eq(header(res, 'content-length'), String(size), 'Content-Length');
    return `${fmtMiB(size)} up in ${upSecs.toFixed(1)}s (${(size / MIB / upSecs).toFixed(1)} MiB/s), down in ${downSecs.toFixed(1)}s`;
  });

  await check('upload one byte over the limit is refused with 413', async () => {
    const limit = S.limits.maxFileBytes;
    let res;
    try {
      res = await upload(Buffer.alloc(limit + 1), { name: 'toolarge.bin', ttl: 60 });
    } catch (err) {
      // The server may answer and close the connection before the whole body is sent.
      return { warn: `no response read (${err.message}); retry with a smaller server limit` };
    }
    eq(res.status, 413, 'status');
    eq(res.json().error, 'file_too_large', 'error code');
  });

  // The size cap must hold even when the client sends no Content-Length. This is slow on
  // purpose: the whole body is sent before the edge lets the Worker answer.
  await check('chunked upload one byte over the limit is refused with 413', async () => {
    const limit = S.limits.maxFileBytes;
    let res;
    try {
      res = await api('POST', '/links', {
        headers: { 'Content-Type': 'application/octet-stream', 'X-TTL-Seconds': '60' },
        body: chunked(Buffer.alloc(limit + 1)),
      });
    } catch (err) {
      return { warn: `no response read (${err.message})` };
    }
    if (res.json().code) created.add(res.json().code);
    // Real Cloudflare buffers the body and the Worker answers 413. A bare workerd (wrangler dev)
    // passes the missing length through and the Worker answers 411. Either refusal is safe;
    // storing the file (201) would be a cap bypass.
    assert([411, 413].includes(res.status), `status: expected 411 or 413, got ${res.status}`);
    return `refused with ${res.status} ${res.json().error}`;
  });
}

// -- upload validation (checklist item 4: Content-Length) --

await check(
  'upload without Content-Length: refused (411) or length supplied by the edge',
  async () => {
    // A stream body makes Node send Transfer-Encoding: chunked, i.e. no Content-Length.
    const res = await api('POST', '/links', {
      headers: { 'Content-Type': 'text/plain', 'X-TTL-Seconds': '60' },
      body: chunked(Buffer.from('chunked body')),
    });
    const link = res.json();
    if (link.code) created.add(link.code);
    if (res.status === 411) {
      eq(link.error, 'length_required', 'error code');
      return 'the Worker refused it (411)';
    }
    // On real Cloudflare the edge buffers a chunked request body and gives the Worker a
    // Content-Length, so the Worker never sees "no length". That is fine as long as the bytes
    // are stored intact (checked here) and the size cap still holds (checked in the large block).
    eq(res.status, 201, 'status');
    const fetched = await hit(link, { headers: { 'Accept-Encoding': 'identity' } });
    eq(fetched.text(), 'chunked body', 'stored bytes');
    return 'accepted: the edge supplied a Content-Length for the chunked body; stored intact';
  },
);

await check('empty upload is refused with 400', async () => {
  const res = await upload(Buffer.alloc(0), { name: 'empty', ttl: 60 });
  eq(res.status, 400, 'status');
  eq(res.json().error, 'empty_file', 'error code');
});

await check('TTL above the maximum is refused with 400 ttl_too_long', async () => {
  const res = await upload(Buffer.from('x'), { ttl: S.limits.maxTtlSeconds + 1 });
  eq(res.status, 400, 'status');
  eq(res.json().error, 'ttl_too_long', 'error code');
});

// -- fetch semantics (item 5) --

await check('Range: first 100 bytes -> 206 with Content-Range', async () => {
  const link = need(S.image, 'image upload');
  const res = await hit(link, { headers: { Range: 'bytes=0-99', 'Accept-Encoding': 'identity' } });
  eq(res.status, 206, 'status');
  eq(header(res, 'content-range'), `bytes 0-99/${MIB}`, 'Content-Range');
  eq(header(res, 'content-length'), '100', 'Content-Length');
  eq(sha256(res.buf), sha256(payloads.image.subarray(0, 100)), 'sha256 of partial body');
  noStore(res, '206');
});

await check('Range: suffix and open-ended ranges', async () => {
  const link = need(S.image, 'image upload');
  const h = { 'Accept-Encoding': 'identity' };
  const suffix = await hit(link, { headers: { ...h, Range: 'bytes=-10' } });
  eq(suffix.status, 206, 'suffix status');
  eq(sha256(suffix.buf), sha256(payloads.image.subarray(MIB - 10)), 'suffix body');
  const open = await hit(link, { headers: { ...h, Range: `bytes=${MIB - 5}-` } });
  eq(open.status, 206, 'open-ended status');
  eq(sha256(open.buf), sha256(payloads.image.subarray(MIB - 5)), 'open-ended body');
});

await check('Range past the end -> 416 with no-store', async () => {
  const link = need(S.image, 'image upload');
  const res = await hit(link, { headers: { Range: `bytes=${MIB}-` } });
  eq(res.status, 416, 'status');
  eq(header(res, 'content-range'), `bytes */${MIB}`, 'Content-Range');
  noStore(res, '416');
});

/** The link's server-side hit counter; fails loudly instead of comparing two `undefined`s. */
async function hitCount(code) {
  const res = await api('GET', `/links/${code}`);
  eq(res.status, 200, `GET /api/links/${code}`);
  const { hits } = res.json();
  assert(Number.isInteger(hits), `GET /api/links/${code} returned hits=${JSON.stringify(hits)}`);
  return hits;
}

await check('HEAD -> 200 with length, no body, no-store, and no hit counted', async () => {
  const link = need(S.image, 'image upload');
  const before = await hitCount(link.code);
  const res = await hit(link, { method: 'HEAD', headers: { 'Accept-Encoding': 'identity' } });
  eq(res.status, 200, 'status');
  eq(res.buf.length, 0, 'body length');
  eq(header(res, 'content-length'), String(MIB), 'Content-Length');
  eq(header(res, 'content-type'), 'image/png', 'Content-Type');
  noStore(res, 'HEAD');
  const after = await hitCount(link.code);
  eq(after, before, 'hit counter across a HEAD');
});

await check('trailing filename is optional and ignored: /<code>/<name>', async () => {
  const link = need(S.image, 'image upload');
  const res = await http(`${link.url}/anything.png`, { headers: { Range: 'bytes=0-9' } });
  eq(res.status, 206, 'status');
  eq(sha256(res.buf), sha256(payloads.image.subarray(0, 10)), 'body');
});

await check('unknown and malformed codes -> 404 with no-store', async () => {
  const unknown = await http(`${endpoint}/zzzzzzzz`);
  eq(unknown.status, 404, 'unknown code status');
  eq(unknown.json().error, 'not_found', 'unknown code error');
  noStore(unknown, '404 (unknown code)');
  const malformed = await http(`${endpoint}/not-a-code`);
  eq(malformed.status, 404, 'malformed code status');
  noStore(malformed, '404 (malformed code)');
});

// -- lifecycle: expiry, refresh, revoke, purge (item 6) --

await check('5 s TTL link serves, then returns 410 with no-store', async () => {
  const link = await uploadOk(Buffer.from('short-lived\n'), {
    name: 'short.txt',
    type: 'text/plain',
    ttl: 5,
  });
  S.life = link;
  const live = await hit(link);
  eq(live.status, 200, 'status while live');
  await sleep(Math.max(0, new Date(link.expiresAt).getTime() - Date.now()) + 1500);
  const gone = await hit(link);
  eq(gone.status, 410, 'status after expiry');
  eq(gone.json().error, 'gone', 'error code');
  noStore(gone, '410');
});

await check('repeat fetch after expiry is still 410 (no stale cache)', async () => {
  const link = need(S.life, 'short-lived upload');
  for (let i = 0; i < 2; i++) eq((await hit(link)).status, 410, `repeat ${i + 1}`);
  const info = (await api('GET', `/links/${link.code}`)).json();
  eq(info.expired, true, 'API reports expired');
});

await check('refresh re-opens the SAME url', async () => {
  const link = need(S.life, 'short-lived upload');
  const res = await api('POST', `/links/${link.code}/refresh`, { json: { ttlSeconds: 120 } });
  eq(res.status, 200, 'refresh status');
  eq(res.json().url, link.url, 'url after refresh');
  const again = await hit(link);
  eq(again.status, 200, 'GET after refresh');
  eq(again.text(), 'short-lived\n', 'body after refresh');
});

await check('revoke closes the link at once; refresh can re-open it', async () => {
  const link = need(S.life, 'short-lived upload');
  const revoked = await api('POST', `/links/${link.code}/revoke`);
  eq(revoked.status, 200, 'revoke status');
  eq((await hit(link)).status, 410, 'GET after revoke');
  const reopened = await api('POST', `/links/${link.code}/refresh`, { json: { ttlSeconds: 120 } });
  eq(reopened.status, 200, 'refresh after revoke');
  eq((await hit(link)).status, 200, 'GET after re-refresh');
});

await check(
  'purge -> 404, then re-upload under the same code; PUT on a live code -> 409',
  async () => {
    const link = need(S.life, 'short-lived upload');
    const live = await upload(Buffer.from('collision'), { code: link.code, ttl: 60 });
    eq(live.status, 409, 'PUT on an existing code');
    const purged = await api('DELETE', `/links/${link.code}`);
    eq(purged.status, 204, 'purge status');
    eq((await hit(link)).status, 404, 'GET after purge');
    eq((await api('GET', `/links/${link.code}`)).status, 404, 'API GET after purge');
    eq((await api('POST', `/links/${link.code}/refresh`)).status, 404, 'refresh after purge');
    const again = await upload(Buffer.from('back again\n'), {
      name: 'short.txt',
      type: 'text/plain',
      code: link.code,
      ttl: 120,
    });
    eq(again.status, 200, 're-upload status');
    eq(again.json().code, link.code, 'code after re-upload');
    const res = await hit(link);
    eq(res.status, 200, 'GET after re-upload');
    eq(res.text(), 'back again\n', 'body after re-upload');
  },
);

await check('--max-downloads cap closes the link; refresh resets it', async () => {
  const link = await uploadOk(Buffer.from('two only\n'), {
    type: 'text/plain',
    ttl: 300,
    maxDownloads: 2,
  });
  eq((await hit(link)).status, 200, 'download 1');
  eq((await hit(link)).status, 200, 'download 2');
  const third = await hit(link);
  eq(third.status, 410, 'download 3');
  noStore(third, '410 (exhausted)');
  await api('POST', `/links/${link.code}/refresh`, { json: { ttlSeconds: 120 } });
  eq((await hit(link)).status, 200, 'download after refresh');
});

// -- sweeper (item 9, optional) --

if (!opts.sweeper) {
  record('SKIP', 'sweeper purges an expired link after the grace period', 'pass --sweeper to run');
} else if (S.limits.purgeGraceSeconds > 300) {
  record(
    'SKIP',
    'sweeper purges an expired link after the grace period',
    `server PURGE_GRACE_SECONDS=${S.limits.purgeGraceSeconds} is too long; temporarily set it to e.g. 20 (see docs/VERIFY_DEPLOYMENT.md)`,
  );
} else {
  await check('sweeper purges an expired link after the grace period', async () => {
    const link = await uploadOk(Buffer.from('sweep me\n'), { type: 'text/plain', ttl: 1 });
    const due = new Date(link.expiresAt).getTime() + S.limits.purgeGraceSeconds * 1000;
    const deadline = due + 90_000;
    console.log(`      waiting until ${new Date(due).toISOString()} (+ up to 90 s for the alarm)`);
    await sleep(Math.max(0, due - Date.now()));
    while (Date.now() < deadline) {
      if ((await api('GET', `/links/${link.code}`)).status === 404) {
        // 404 only means "no longer active": the sweeper flips a row to `purging` before it
        // deletes the object, and retries a failed R2 delete later. The row itself is removed
        // only after R2 confirmed the delete, so a purge that now answers 404 means it is done.
        // A 204 means the row was still there, i.e. the sweeper had not finished.
        const detectedAfter = Math.round((Date.now() - due) / 1000);
        await sleep(3000);
        const confirm = await api('DELETE', `/links/${link.code}`);
        if (confirm.status === 404) {
          created.delete(link.code);
          return `purged ${detectedAfter}s after it became due (row confirmed gone; R2 itself is not visible from outside)`;
        }
        throw new Error(
          confirm.status === 204
            ? `link went inactive ${detectedAfter}s after it became due but its row was still present 3 s later (sweeper mid-delete or R2 delete failing; check the Worker logs). This run purged it itself`
            : `confirming DELETE returned ${confirm.status}`,
        );
      }
      await sleep(5000);
    }
    throw new Error('link still present 90 s after the grace period');
  });
}

// -- cleanup and server-side accounting --

await check('cleanup: purge everything this run created', async () => {
  let purged = 0;
  const failures = [];
  // Best effort: one failure must not leave the other links behind.
  for (const code of [...created]) {
    try {
      const res = await api('DELETE', `/links/${code}`);
      if (res.status === 204) purged++;
      else if (res.status !== 404) failures.push(`${code}: HTTP ${res.status}`);
      if (res.status === 204 || res.status === 404) created.delete(code);
    } catch (err) {
      failures.push(`${code}: ${err.message}`);
    }
  }
  assert(
    failures.length === 0,
    `${failures.length} link(s) not purged (${purged} were): ${failures.join('; ')}. They expire on their own and the sweeper removes them after the grace period`,
  );
  return `${purged} link(s) purged`;
});

await check('usage returns to baseline after cleanup', async () => {
  const now = (await api('GET', '/status')).json().usage;
  const base = S.status.usage;
  const uploads = now.uploadsToday - base.uploadsToday;
  const detail = `${now.linkCount} links, ${fmtMiB(now.totalBytes)}; this run counted ${uploads} upload(s) against the daily cap of ${S.limits.maxUploadsPerDay}`;
  if (now.linkCount !== base.linkCount || now.totalBytes !== base.totalBytes) {
    return {
      warn: `${detail} (baseline was ${base.linkCount} links, ${fmtMiB(base.totalBytes)}; other clients active?)`,
    };
  }
  return detail;
});

await check('no response was served from the Cloudflare cache', async () => {
  const seen = [...stats.cacheStatuses].sort();
  assert(!seen.includes('HIT'), `cf-cache-status HIT seen (all seen: ${seen.join(', ')})`);
  return seen.length
    ? `cf-cache-status seen: ${seen.join(', ')}`
    : 'no cf-cache-status header (not behind Cloudflare?)';
});

await check('normal use was not throttled', async () => {
  assert(
    stats.throttled === 0,
    `${stats.throttled} request(s) were rate limited at ${maxRpm} req/min; the script paces itself below the 60/min per-IP limit, so this is worth investigating`,
  );
  return `${stats.requests} requests so far, paced to <= ${maxRpm || 'unlimited'}/min`;
});

// -- rate limiting (item 7): LAST, because it throttles this IP for up to a minute --

if (opts['skip-ratelimit']) {
  record('SKIP', 'rate limiter returns 429 for a flood of requests', '--skip-ratelimit');
} else {
  await check('rate limiter returns 429 for a flood of requests from one IP', async () => {
    const batch = 10;
    const counts = {};
    let firstThrottle = null;
    let sample;
    const start = Date.now();
    for (let sentSoFar = 0; sentSoFar < probeRequests; sentSoFar += batch) {
      const n = Math.min(batch, probeRequests - sentSoFar);
      const codes = Array.from({ length: n }, () => randomCode());
      const out = await Promise.all(
        codes.map((c) => http(`${endpoint}/${c}`, { paced: false, retry: false })),
      );
      out.forEach((res, i) => {
        counts[res.status] = (counts[res.status] ?? 0) + 1;
        const throttled =
          res.status === 429 || (res.status === 503 && res.json().error === 'rate_limited');
        if (throttled && firstThrottle === null) {
          firstThrottle = sentSoFar + i + 1;
          sample = res;
        }
      });
      if (firstThrottle !== null && sentSoFar > firstThrottle + 2 * batch) break;
    }
    const summary = Object.entries(counts)
      .map(([s, n]) => `${s} x${n}`)
      .join(', ');
    const secs = ((Date.now() - start) / 1000).toFixed(1);
    if (firstThrottle === null) {
      return {
        warn: `no 429 in ${probeRequests} requests over ${secs}s (${summary}). Cloudflare's binding is lenient by design, so this WARN is expected on a real account; see docs/VERIFY_DEPLOYMENT.md (rate limiting) for a stricter check`,
      };
    }
    eq(sample.status, 429, 'throttle status (503 means the global breaker tripped first)');
    eq(sample.json().error, 'rate_limited', 'throttle error code');
    assert(header(sample, 'retry-after') !== '', 'throttle response lacks Retry-After');
    noStore(sample, '429');
    return `first 429 at request #${firstThrottle} of ${probeRequests} (${summary}; ${secs}s). Earlier requests in the same 60 s window count towards the limit`;
  });
  console.log('      (this IP may stay throttled on /api and /<code> for up to a minute)');
}

// ---- report ------------------------------------------------------------------------------

const tally = Object.fromEntries(['PASS', 'FAIL', 'WARN', 'SKIP'].map((s) => [s, 0]));
for (const r of results) if (r.status in tally) tally[r.status]++;
console.log(
  `\n${tally.PASS} passed, ${tally.FAIL} failed, ${tally.WARN} warnings, ${tally.SKIP} skipped (${stats.requests} requests)`,
);
for (const r of results.filter((x) => x.status === 'FAIL' || x.status === 'WARN')) {
  console.log(`  ${r.status}  ${r.name}: ${r.detail}`);
}
process.exit(tally.FAIL > 0 ? 1 : 0);

function randomCode() {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  return Array.from({ length: 8 }, () => alphabet[randomInt(alphabet.length)]).join('');
}
