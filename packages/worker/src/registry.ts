import { DurableObject } from 'cloudflare:workers';
import {
  CODE_REGEX,
  formatDuration,
  type ApiErrorCode,
  type LinkInfo,
  type ServerStatus,
} from '@r2-fastlink/core';
import { generateCode } from './code.ts';
import { parseLimits } from './config.ts';
import type { Env } from './env.ts';

/** How long an allocated-but-uncommitted upload may sit before it is reaped. */
const PENDING_TTL_MS = 15 * 60 * 1000;
const MAX_CODE_ATTEMPTS = 5;
const MAX_LOOKUP_CODES = 100;

export interface AllocateInput {
  filename: string;
  contentType: string;
  size: number;
  ttlSeconds: number;
  maxDownloads?: number | null;
  /** Re-create a specific code (used when its object was purged). */
  code?: string;
}

export type AllocateResult =
  { ok: true; code: string; r2Key: string } | { ok: false; error: ApiErrorCode; message: string };

export type ResolveResult =
  | { status: 'ok'; link: LinkInfo; r2Key: string }
  | { status: 'expired' | 'exhausted'; link: LinkInfo }
  | { status: 'notfound' };

export type MutateResult =
  { ok: true; link: LinkInfo } | { ok: false; error: ApiErrorCode; message: string };

interface LinkRow extends Record<string, SqlStorageValue> {
  code: string;
  r2_key: string;
  filename: string;
  content_type: string;
  size: number;
  created_at: number;
  ttl_seconds: number;
  expires_at: number;
  max_downloads: number | null;
  hits: number;
  window_hits: number;
  last_hit_at: number | null;
  state: 'pending' | 'active';
}

const iso = (ms: number) => new Date(ms).toISOString();

/**
 * The single registry Durable Object. It owns all link state (code -> object, expiry,
 * counters) and a sweeper alarm. It never touches file bytes except to delete them.
 *
 * Cost note: there is exactly one instance, it uses no timers or WebSockets, and the alarm
 * is only ever scheduled for the next due cleanup, so it is idle whenever nothing is due.
 */
export class Registry extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS links (
        code TEXT PRIMARY KEY,
        r2_key TEXT NOT NULL,
        filename TEXT NOT NULL,
        content_type TEXT NOT NULL,
        size INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        ttl_seconds INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        max_downloads INTEGER,
        hits INTEGER NOT NULL DEFAULT 0,
        window_hits INTEGER NOT NULL DEFAULT 0,
        last_hit_at INTEGER,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS uploads (day TEXT PRIMARY KEY, count INTEGER NOT NULL);
    `);
  }

  // ---- upload lifecycle -------------------------------------------------------------

  /** Reserve a code and quota for an upload. Row stays `pending` until `commit`. */
  async allocate(input: AllocateInput): Promise<AllocateResult> {
    const limits = parseLimits(this.env);
    const now = Date.now();

    if (!Number.isInteger(input.size) || input.size <= 0) {
      return fail('empty_file', 'Cannot upload an empty file.');
    }
    if (input.size > limits.maxFileBytes) {
      return fail('file_too_large', `File exceeds the ${limits.maxFileBytes} byte limit.`);
    }
    if (
      !Number.isInteger(input.ttlSeconds) ||
      input.ttlSeconds < 1 ||
      input.ttlSeconds > limits.maxTtlSeconds
    ) {
      return fail(
        'ttl_too_long',
        `TTL must be between 1s and ${formatDuration(limits.maxTtlSeconds)}.`,
      );
    }
    const maxDownloads = input.maxDownloads ?? null;
    if (maxDownloads !== null && (!Number.isInteger(maxDownloads) || maxDownloads < 1)) {
      return fail('bad_request', 'maxDownloads must be a positive integer.');
    }

    const today = new Date(now).toISOString().slice(0, 10);
    this.sql.exec('DELETE FROM uploads WHERE day < ?', today);
    const todayCount = this.sql
      .exec<{ count: number }>('SELECT count FROM uploads WHERE day = ?', today)
      .toArray()[0]?.count;
    if ((todayCount ?? 0) >= limits.maxUploadsPerDay) {
      return fail('daily_limit', `Daily upload limit (${limits.maxUploadsPerDay}) reached.`);
    }
    const { total } = this.sql
      .exec<{ total: number }>('SELECT COALESCE(SUM(size), 0) AS total FROM links')
      .one();
    if (total + input.size > limits.maxTotalBytes) {
      return fail('storage_full', 'Total storage limit reached; wait for links to be purged.');
    }

    let code: string | undefined;
    if (input.code !== undefined) {
      if (!CODE_REGEX.test(input.code)) return fail('bad_request', 'Invalid code.');
      if (this.exists(input.code)) return fail('exists', 'That code is already in use.');
      code = input.code;
    } else {
      for (let i = 0; i < MAX_CODE_ATTEMPTS && !code; i++) {
        const candidate = generateCode();
        if (!this.exists(candidate)) code = candidate;
      }
      if (!code) return fail('upload_failed', 'Could not allocate a unique code.');
    }

    const r2Key = `objects/${code}`;
    this.sql.exec(
      `INSERT INTO links (code, r2_key, filename, content_type, size, created_at, ttl_seconds,
         expires_at, max_downloads, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      code,
      r2Key,
      input.filename,
      input.contentType,
      input.size,
      now,
      input.ttlSeconds,
      now + input.ttlSeconds * 1000,
      maxDownloads,
    );
    this.sql.exec(
      `INSERT INTO uploads (day, count) VALUES (?, 1)
       ON CONFLICT(day) DO UPDATE SET count = count + 1`,
      today,
    );
    await this.ensureAlarm();
    return { ok: true, code, r2Key };
  }

  /** Mark an upload complete; the expiry window starts now. */
  async commit(code: string): Promise<LinkInfo | null> {
    const now = Date.now();
    const row = this.row(code, 'pending');
    if (!row) return null;
    this.sql.exec(
      `UPDATE links SET state = 'active', expires_at = ? WHERE code = ?`,
      now + row.ttl_seconds * 1000,
      code,
    );
    await this.ensureAlarm();
    return this.info(this.row(code, 'active')!, now);
  }

  /** Drop a pending row after a failed upload (the Worker deletes any partial object). */
  async abort(code: string): Promise<void> {
    this.sql.exec(`DELETE FROM links WHERE code = ? AND state = 'pending'`, code);
    await this.ensureAlarm();
  }

  // ---- reads ------------------------------------------------------------------------

  /** Resolve a code for serving. With `count`, atomically records the hit. */
  async resolve(code: string, count: boolean): Promise<ResolveResult> {
    const now = Date.now();
    const row = this.row(code, 'active');
    if (!row) return { status: 'notfound' };
    if (now >= row.expires_at) return { status: 'expired', link: this.info(row, now) };
    if (row.max_downloads !== null && row.window_hits >= row.max_downloads) {
      return { status: 'exhausted', link: this.info(row, now) };
    }
    if (count) {
      this.sql.exec(
        `UPDATE links SET hits = hits + 1, window_hits = window_hits + 1, last_hit_at = ?
         WHERE code = ?`,
        now,
        code,
      );
    }
    const updated = this.row(code, 'active')!;
    return { status: 'ok', link: this.info(updated, now), r2Key: updated.r2_key };
  }

  async get(code: string): Promise<LinkInfo | null> {
    const row = this.row(code, 'active');
    return row ? this.info(row, Date.now()) : null;
  }

  async lookup(codes: string[]): Promise<Record<string, LinkInfo | null>> {
    const now = Date.now();
    const out: Record<string, LinkInfo | null> = {};
    for (const code of codes.slice(0, MAX_LOOKUP_CODES)) {
      const row = CODE_REGEX.test(code) ? this.row(code, 'active') : null;
      out[code] = row ? this.info(row, now) : null;
    }
    return out;
  }

  async status(): Promise<ServerStatus> {
    const now = Date.now();
    const limits = parseLimits(this.env);
    const counts = this.sql
      .exec<{ n: number; active: number; bytes: number }>(
        `SELECT COUNT(*) AS n,
                COALESCE(SUM(CASE WHEN expires_at > ? AND state = 'active' THEN 1 ELSE 0 END), 0) AS active,
                COALESCE(SUM(size), 0) AS bytes
         FROM links`,
        now,
      )
      .one();
    const today = new Date(now).toISOString().slice(0, 10);
    const uploadsToday =
      this.sql
        .exec<{ count: number }>('SELECT count FROM uploads WHERE day = ?', today)
        .toArray()[0]?.count ?? 0;
    return {
      limits,
      usage: {
        linkCount: counts.n,
        activeCount: counts.active,
        totalBytes: counts.bytes,
        uploadsToday,
      },
    };
  }

  // ---- mutations --------------------------------------------------------------------

  /** Re-open a link: new expiry window from now, per-window download counter reset. */
  async refresh(code: string, ttlSeconds?: number): Promise<MutateResult> {
    const limits = parseLimits(this.env);
    const now = Date.now();
    const row = this.row(code, 'active');
    if (!row) return fail('not_found', 'No such link (it may have been purged).');
    const ttl = ttlSeconds ?? limits.defaultTtlSeconds;
    if (!Number.isInteger(ttl) || ttl < 1 || ttl > limits.maxTtlSeconds) {
      return fail(
        'ttl_too_long',
        `TTL must be between 1s and ${formatDuration(limits.maxTtlSeconds)}.`,
      );
    }
    this.sql.exec(
      `UPDATE links SET expires_at = ?, ttl_seconds = ?, window_hits = 0 WHERE code = ?`,
      now + ttl * 1000,
      ttl,
      code,
    );
    await this.ensureAlarm();
    return { ok: true, link: this.info(this.row(code, 'active')!, now) };
  }

  /** Expire a link immediately. It can still be refreshed until it is purged. */
  async revoke(code: string): Promise<MutateResult> {
    const now = Date.now();
    if (!this.row(code, 'active')) return fail('not_found', 'No such link.');
    this.sql.exec(`UPDATE links SET expires_at = ? WHERE code = ?`, now, code);
    await this.ensureAlarm();
    return { ok: true, link: this.info(this.row(code, 'active')!, now) };
  }

  /** Delete the object and row right now. Returns false if the code is unknown. */
  async purge(code: string): Promise<boolean> {
    const row = this.row(code);
    if (!row) return false;
    await this.env.BUCKET.delete(row.r2_key);
    this.sql.exec('DELETE FROM links WHERE code = ?', code);
    await this.ensureAlarm();
    return true;
  }

  // ---- sweeper ----------------------------------------------------------------------

  /** Delete objects and rows whose grace period (or pending window) has passed. */
  override async alarm(): Promise<void> {
    const now = Date.now();
    const graceMs = parseLimits(this.env).purgeGraceSeconds * 1000;
    const due = this.sql
      .exec<{ code: string; r2_key: string }>(
        `SELECT code, r2_key FROM links
         WHERE (state = 'active' AND expires_at + ? <= ?)
            OR (state = 'pending' AND created_at + ? <= ?)`,
        graceMs,
        now,
        PENDING_TTL_MS,
        now,
      )
      .toArray();
    for (let i = 0; i < due.length; i += 1000) {
      const batch = due.slice(i, i + 1000);
      await this.env.BUCKET.delete(batch.map((r) => r.r2_key));
      for (const { code } of batch) this.sql.exec('DELETE FROM links WHERE code = ?', code);
    }
    // Alarms don't repeat on their own: reschedule only if something is still pending.
    const next = this.nextDue();
    if (next !== null) await this.ctx.storage.setAlarm(next);
  }

  /** Make sure an alarm exists at or before the next due cleanup; none if nothing is due. */
  private async ensureAlarm(): Promise<void> {
    const next = this.nextDue();
    if (next === null) return;
    const current = await this.ctx.storage.getAlarm();
    if (current === null || next < current) await this.ctx.storage.setAlarm(next);
  }

  private nextDue(): number | null {
    const graceMs = parseLimits(this.env).purgeGraceSeconds * 1000;
    const { next } = this.sql
      .exec<{ next: number | null }>(
        `SELECT MIN(CASE WHEN state = 'active' THEN expires_at + ? ELSE created_at + ? END) AS next
         FROM links`,
        graceMs,
        PENDING_TTL_MS,
      )
      .one();
    return next;
  }

  // ---- helpers ----------------------------------------------------------------------

  private exists(code: string): boolean {
    return this.row(code) !== undefined;
  }

  private row(code: string, state?: 'pending' | 'active'): LinkRow | undefined {
    const rows = state
      ? this.sql.exec<LinkRow>('SELECT * FROM links WHERE code = ? AND state = ?', code, state)
      : this.sql.exec<LinkRow>('SELECT * FROM links WHERE code = ?', code);
    return rows.toArray()[0];
  }

  private info(row: LinkRow, now: number): LinkInfo {
    const exhausted = row.max_downloads !== null && row.window_hits >= row.max_downloads;
    return {
      code: row.code,
      filename: row.filename,
      contentType: row.content_type,
      size: row.size,
      createdAt: iso(row.created_at),
      expiresAt: iso(row.expires_at),
      expired: now >= row.expires_at || exhausted,
      maxDownloads: row.max_downloads,
      hits: row.hits,
      lastHitAt: row.last_hit_at === null ? null : iso(row.last_hit_at),
    };
  }
}

function fail(
  error: ApiErrorCode,
  message: string,
): { ok: false; error: ApiErrorCode; message: string } {
  return { ok: false, error, message };
}
