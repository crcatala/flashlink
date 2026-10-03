import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { ApiError } from '@r2-fastlink/core';
import { extractCode } from '../code.ts';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { clock, formatBytes } from '../format.ts';
import { detectContentType, parseTtl } from './up.ts';

export interface RefreshOptions {
  ttl?: string;
  json?: boolean;
  copy?: boolean;
}

/**
 * Re-open a link for another window, keeping the same short URL. If the server has already
 * purged the object, re-upload the original local file (verified by hash) under the same code.
 */
export async function refresh(
  target: string | undefined,
  opts: RefreshOptions,
  ctx: Context,
): Promise<void> {
  const code = target ? extractCode(target) : ctx.history.latest()?.code;
  if (!code) throw new CliError('No history yet; pass a link code or URL.');
  const ttlSeconds = parseTtl(opts.ttl ?? ctx.config.defaultTtl);
  const client = ctx.client();

  let info;
  let reuploaded = false;
  try {
    info = await client.refresh(code, ttlSeconds);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== 'not_found') throw err;
    info = await reupload(code, ttlSeconds, ctx);
    reuploaded = true;
  }

  ctx.history.update(code, {
    expiresAt: info.expiresAt,
    ttlSeconds,
    hits: info.hits,
    lastRefreshedAt: new Date(ctx.now()).toISOString(),
    state: 'active',
  });

  const url = `${client.endpoint}/${code}`;
  if (opts.json) ctx.out(JSON.stringify({ ...info, url, reuploaded }, null, 2));
  else ctx.out(url);
  ctx.err(
    `${ctx.style.green('✓')} ${code} is live again until ${clock(info.expiresAt, new Date(ctx.now()))}` +
      (reuploaded ? ctx.style.dim(' (re-uploaded from the original file)') : ''),
  );
  if (opts.copy !== false && ctx.config.copy && (await ctx.copy(url))) {
    ctx.err(ctx.style.dim('  copied to clipboard'));
  }
}

async function reupload(code: string, ttlSeconds: number, ctx: Context) {
  const entry = ctx.history.find(code);
  const gone = `Link ${code} has been purged from the server`;
  if (!entry) throw new CliError(`${gone}, and it is not in your local history.`);
  if (!entry.sourcePath) {
    throw new CliError(`${gone}; it came from stdin, so it can't be re-uploaded.`);
  }
  if (entry.sourceKind === 'dir') {
    // A zip embeds timestamps and depends on the exclusions used, so it can't be verified as
    // "the same content" the way a file can, and silently sending a different zip is worse.
    throw new CliError(
      `${gone}; it was a zipped folder (${entry.sourcePath}), which can't be re-uploaded safely.`,
      'Upload the folder again with `r2fl up` to get a new link.',
    );
  }
  let bytes: Buffer;
  try {
    bytes = fs.readFileSync(entry.sourcePath);
  } catch {
    throw new CliError(`${gone}, and the original file is gone: ${entry.sourcePath}`);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256) {
    throw new CliError(
      `${gone}, and ${entry.sourcePath} has changed since it was uploaded.`,
      'Upload it again with `r2fl up` to get a new link.',
    );
  }
  ctx.err(
    ctx.style.dim(
      `  ${code} was purged; re-uploading ${entry.filename} (${formatBytes(bytes.length)})…`,
    ),
  );
  return ctx.client().upload({
    code,
    filename: entry.filename,
    contentType: entry.contentType || detectContentType(entry.filename, bytes),
    body: bytes,
    ttlSeconds,
    maxDownloads: entry.maxDownloads ?? undefined,
  });
}
