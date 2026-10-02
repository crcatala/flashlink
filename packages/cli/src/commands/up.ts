import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime';
import { parseDuration, type UploadResult } from '@r2-fastlink/core';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { clock, formatBytes } from '../format.ts';
import type { HistoryEntry } from '../history.ts';

export interface UpOptions {
  ttl?: string;
  maxDownloads?: number;
  name?: string;
  withName?: boolean;
  json?: boolean;
  /** Commander sets this to false for `--no-copy`. */
  copy?: boolean;
  quiet?: boolean;
}

interface Source {
  filename: string;
  bytes: Buffer;
  sourcePath: string | null;
}

export function parseTtl(value: string): number {
  try {
    return parseDuration(value);
  } catch (err) {
    throw new CliError((err as Error).message);
  }
}

/** Looks like text if the first 8 KiB has no NUL bytes. */
function looksLikeText(bytes: Buffer): boolean {
  return !bytes.subarray(0, 8192).includes(0);
}

export function detectContentType(filename: string, bytes: Buffer): string {
  return (
    mime.getType(filename) ?? (looksLikeText(bytes) ? 'text/plain' : 'application/octet-stream')
  );
}

function readSource(file: string, maxBytes: number): Source {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new CliError('No such file.');
  }
  if (stat.isDirectory()) {
    throw new CliError('Is a directory.', 'Zip it first: zip -r archive.zip <dir>');
  }
  if (!stat.isFile()) throw new CliError('Not a regular file.');
  if (stat.size === 0) throw new CliError('Empty file.');
  if (stat.size > maxBytes) {
    throw new CliError(
      `${formatBytes(stat.size)} exceeds the ${formatBytes(maxBytes)} limit.`,
      'Raise it with `r2fl config set maxFileBytes <size>` (the server enforces its own cap too).',
    );
  }
  return {
    filename: path.basename(file),
    bytes: fs.readFileSync(file),
    sourcePath: path.resolve(file),
  };
}

export async function up(files: string[], opts: UpOptions, ctx: Context): Promise<void> {
  const useStdin = files.length === 0 || (files.length === 1 && files[0] === '-');
  if (useStdin && ctx.stdinIsTTY) {
    throw new CliError(
      'No files given.',
      'Usage: r2fl up <file...>   or   cmd | r2fl up --name out.txt',
    );
  }
  if (opts.name && !useStdin && files.length > 1) {
    throw new CliError('--name only works with a single file or stdin.');
  }
  const ttlSeconds = parseTtl(opts.ttl ?? ctx.config.defaultTtl);
  const client = ctx.client();
  const { style } = ctx;

  const results: UploadResult[] = [];
  let failures = 0;
  const targets = useStdin ? ['-'] : files;
  for (const target of targets) {
    try {
      let source: Source;
      if (useStdin) {
        const bytes = await ctx.readStdin();
        if (bytes.length === 0) throw new CliError('Empty input.');
        if (bytes.length > ctx.config.maxFileBytes) {
          throw new CliError(
            `${formatBytes(bytes.length)} exceeds the ${formatBytes(ctx.config.maxFileBytes)} limit.`,
          );
        }
        source = {
          filename: opts.name ?? (looksLikeText(bytes) ? 'stdin.txt' : 'stdin.bin'),
          bytes,
          sourcePath: null,
        };
      } else {
        source = readSource(target, ctx.config.maxFileBytes);
        if (opts.name) source.filename = opts.name;
      }
      const contentType = detectContentType(source.filename, source.bytes);
      const result = await client.upload({
        filename: source.filename,
        contentType,
        body: source.bytes,
        ttlSeconds,
        maxDownloads: opts.maxDownloads,
      });
      results.push(result);
      ctx.history.upsert(toEntry(result, source, ttlSeconds));
      if (!opts.quiet && !opts.json) {
        ctx.err(
          `${style.green('✓')} ${source.filename} ${style.dim(`(${formatBytes(result.size)})`)} ` +
            `${style.dim('· expires')} ${clock(result.expiresAt, new Date(ctx.now()))}`,
        );
      }
    } catch (err) {
      // A single failure is reported once, by the top-level handler.
      const label = target === '-' ? 'stdin' : target;
      if (targets.length === 1) throw labelled(err, label);
      failures++;
      ctx.err(`${style.red('✗')} ${label}: ${(err as Error).message}`);
      if (err instanceof CliError && err.hint) ctx.err(`  ${style.dim(err.hint)}`);
    }
  }

  const urls = results.map((r) => (opts.withName ? r.urlWithName : r.url));
  if (opts.json) {
    ctx.out(JSON.stringify(results.length === 1 ? results[0] : results, null, 2));
  } else {
    for (const url of urls) ctx.out(url);
  }
  if (urls.length > 0 && opts.copy !== false && ctx.config.copy) {
    const copied = await ctx.copy(urls.join('\n'));
    if (copied && !opts.quiet && !opts.json) ctx.err(style.dim('  copied to clipboard'));
  }
  if (failures > 0) {
    throw new CliError(`${failures} of ${targets.length} uploads failed.`);
  }
}

/** Prefix a CLI error with the file it concerns (e.g. "notes.txt: Empty file."). */
function labelled(err: unknown, label: string): unknown {
  return err instanceof CliError ? new CliError(`${label}: ${err.message}`, err.hint) : err;
}

function toEntry(result: UploadResult, source: Source, ttlSeconds: number): HistoryEntry {
  return {
    code: result.code,
    url: result.url,
    filename: result.filename,
    size: result.size,
    contentType: result.contentType,
    sha256: createHash('sha256').update(source.bytes).digest('hex'),
    sourcePath: source.sourcePath,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    ttlSeconds,
    maxDownloads: result.maxDownloads,
    hits: result.hits,
    lastRefreshedAt: null,
    state: 'active',
  };
}
