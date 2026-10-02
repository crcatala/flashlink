import type { Context } from '../context.ts';
import { formatBytes } from '../format.ts';
import { formatDuration } from '@r2-fastlink/core';
import { configPath, historyPath } from '../paths.ts';

export async function status(opts: { json?: boolean }, ctx: Context): Promise<void> {
  const info = await ctx.client().status();
  if (opts.json) {
    ctx.out(JSON.stringify({ endpoint: ctx.config.endpoint, ...info }, null, 2));
    return;
  }
  const { limits: l, usage: u } = info;
  const { style } = ctx;
  const row = (k: string, v: string) => ctx.out(`${style.dim(k.padEnd(18))}${v}`);
  row('endpoint', ctx.config.endpoint ?? '');
  row('max file size', formatBytes(l.maxFileBytes));
  row('max link lifetime', formatDuration(l.maxTtlSeconds));
  row('storage', `${formatBytes(u.totalBytes)} of ${formatBytes(l.maxTotalBytes)}`);
  row('links', `${u.activeCount} live, ${u.linkCount} stored`);
  row('uploads today', `${u.uploadsToday} of ${l.maxUploadsPerDay}`);
  row('purged after', `${formatDuration(l.purgeGraceSeconds)} past expiry`);
  row('your default ttl', ctx.config.defaultTtl);
  row('config file', configPath(ctx.env));
  row('history file', historyPath(ctx.env));
}
