import { ApiError } from '@r2-fastlink/core';
import type { Context } from '../context.ts';
import { formatBytes, table, timeLeft, truncate, clock } from '../format.ts';
import { entryStatus, type EntryStatus } from '../history.ts';

export interface LsOptions {
  limit?: number;
  all?: boolean;
  live?: boolean;
  sync?: boolean;
  json?: boolean;
}

export async function ls(opts: LsOptions, ctx: Context): Promise<void> {
  if (opts.sync) await sync(ctx);

  const now = ctx.now();
  let entries = ctx.history.list().reverse();
  if (opts.live) entries = entries.filter((e) => entryStatus(e, now) === 'live');
  if (!opts.all) entries = entries.slice(0, opts.limit ?? 20);

  if (opts.json) {
    ctx.out(
      JSON.stringify(
        entries.map((e) => ({ ...e, status: entryStatus(e, now) })),
        null,
        2,
      ),
    );
    return;
  }
  if (entries.length === 0) {
    ctx.err(
      opts.live ? 'No live links.' : 'No history yet. Upload something with `r2fl up <file>`.',
    );
    return;
  }

  const { style } = ctx;
  const paint: Record<EntryStatus, (s: string) => string> = {
    live: style.green,
    exhausted: style.yellow,
    expired: style.dim,
    revoked: style.yellow,
    purged: style.dim,
  };
  const rows = [['CODE', 'FILE', 'SIZE', 'STATUS', 'URL'].map((h) => style.bold(h))];
  for (const e of entries) {
    const status = entryStatus(e, now);
    const label =
      status === 'live'
        ? `live · ${timeLeft(e.expiresAt, now)}`
        : status === 'exhausted'
          ? 'exhausted · download limit reached'
          : status === 'purged'
            ? 'purged'
            : `${status} · ${clock(e.expiresAt, new Date(now))}`;
    rows.push([e.code, truncate(e.filename, 32), formatBytes(e.size), paint[status](label), e.url]);
  }
  ctx.out(table(rows));
  const hidden = ctx.history.list().length - entries.length;
  if (hidden > 0 && !opts.all && !opts.live) {
    ctx.err(style.dim(`\n${hidden} older entr${hidden === 1 ? 'y' : 'ies'} hidden (use --all).`));
  }
}

/** Ask the server about every locally-known code and fold the answer into history. */
async function sync(ctx: Context): Promise<void> {
  const codes = ctx.history
    .list()
    .filter((e) => e.state !== 'purged')
    .map((e) => e.code);
  const client = ctx.client();
  try {
    for (let i = 0; i < codes.length; i += 100) {
      ctx.history.applyServerState(await client.lookup(codes.slice(i, i + 100)), ctx.now());
    }
  } catch (err) {
    if (err instanceof ApiError) {
      ctx.err(ctx.style.yellow(`Could not sync with the server: ${err.message}`));
      return;
    }
    throw err;
  }
}
