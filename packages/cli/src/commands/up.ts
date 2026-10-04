import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import mime from 'mime';
import { parseDuration, type UploadResult } from '@flashlink/core';
import type { Context } from '../context.ts';
import { CliError, ReportedError, errorJson, errorText } from '../errors.ts';
import { clock, formatBytes } from '../format.ts';
import { zipFolder } from '../folder.ts';
import type { HistoryEntry } from '../history.ts';
import { sendNotification } from '../notify.ts';
import { checkContent, checkFilename, describeFinding, type SecretFinding } from '../secrets.ts';

export interface UpOptions {
  ttl?: string;
  maxDownloads?: number;
  name?: string;
  withName?: boolean;
  json?: boolean;
  /** Commander sets this to false for `--no-copy`. */
  copy?: boolean;
  quiet?: boolean;
  /** Post a macOS notification with the result (for launchers without a terminal). */
  notify?: boolean;
  /** Skip the secret check's prompt/refusal (`--allow-secrets`, or `-y/--yes`). */
  allowSecrets?: boolean;
  yes?: boolean;
  /** Folder uploads: glob patterns to leave out (repeatable). */
  exclude?: string[];
  /** Folder uploads: commander sets this to false for `--no-gitignore`. */
  gitignore?: boolean;
}

interface Source {
  filename: string;
  bytes: Buffer;
  sourcePath: string | null;
  kind: HistoryEntry['sourceKind'];
  /** Set for folders, which are always zips whatever `--name` says. */
  contentType?: string;
  /** Folder uploads: secret findings per member file, collected while zipping. */
  secrets?: { file: string; findings: SecretFinding[] }[];
  /** Folder uploads: left-out symlinks and special files, to tell the user. */
  skipped?: number;
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

function readSource(file: string, opts: UpOptions, ctx: Context): Source {
  const maxBytes = ctx.config.maxFileBytes;
  let stat: fs.Stats;
  try {
    stat = fs.statSync(file);
  } catch {
    throw new CliError('No such file.');
  }
  if (stat.isDirectory()) {
    const zipped = zipFolder(file, {
      exclude: opts.exclude ?? [],
      gitignore: opts.gitignore !== false,
      maxBytes,
      scanSecrets: ctx.config.warnSecrets && !opts.allowSecrets && !opts.yes,
    });
    return {
      filename: `${zipped.name}.zip`,
      bytes: zipped.bytes,
      sourcePath: path.resolve(file),
      kind: 'dir',
      contentType: 'application/zip',
      secrets: zipped.secrets,
      skipped: zipped.skipped,
    };
  }
  if (!stat.isFile()) throw new CliError('Not a regular file.');
  if (stat.size === 0) throw new CliError('Empty file.');
  if (stat.size > maxBytes) {
    throw new CliError(
      `${formatBytes(stat.size)} exceeds the ${formatBytes(maxBytes)} limit.`,
      'Raise it with `fl config set maxFileBytes <size>` (the server enforces its own cap too).',
    );
  }
  return {
    filename: path.basename(file),
    bytes: fs.readFileSync(file),
    sourcePath: path.resolve(file),
    kind: 'file',
  };
}

/**
 * Entry point from the CLI: the context is built lazily, and building it can fail (unreadable
 * config or history). With no Context there is no `ctx.notify`, so notify directly.
 */
export async function upWithContext(
  files: string[],
  opts: UpOptions,
  getContext: () => Context,
  notify: (subtitle: string, body: string) => Promise<boolean> = sendNotification,
): Promise<void> {
  let ctx: Context;
  try {
    ctx = getContext();
  } catch (err) {
    if (opts.notify) await notify('Upload failed', errorText(err));
    throw err;
  }
  await up(files, opts, ctx);
}

export async function up(files: string[], opts: UpOptions, ctx: Context): Promise<void> {
  try {
    await uploadAll(files, opts, ctx);
  } catch (err) {
    // The error still propagates (stderr/JSON + exit code); the notification is the only
    // feedback a launcher with no terminal gets.
    if (opts.notify) await ctx.notify('Upload failed', errorText(err));
    throw err;
  }
}

async function uploadAll(files: string[], opts: UpOptions, ctx: Context): Promise<void> {
  const useStdin = files.length === 0 || (files.length === 1 && files[0] === '-');
  if (useStdin && ctx.stdinIsTTY) {
    throw new CliError(
      'No files given.',
      'Usage: fl up <file...>   or   cmd | fl up --name out.txt',
    );
  }
  if (opts.name && !useStdin && files.length > 1) {
    throw new CliError('--name only works with a single file or stdin.');
  }
  const ttlSeconds = parseTtl(opts.ttl ?? ctx.config.defaultTtl);
  const client = ctx.client();
  const { style } = ctx;

  const results: UploadResult[] = [];
  // --json with several files: one array in target order, failures as {file, error, message}.
  const entries: (UploadResult | ({ file: string } & ReturnType<typeof errorJson>))[] = [];
  let failures = 0;
  let firstFailure = '';
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
          kind: 'stdin',
        };
      } else {
        source = readSource(target, opts, ctx);
        if (opts.name) source.filename = opts.name;
      }
      if (ctx.config.warnSecrets && !opts.allowSecrets && !opts.yes) {
        await confirmSecrets(source, opts, ctx);
      }
      const contentType = source.contentType ?? detectContentType(source.filename, source.bytes);
      const result = await client.upload({
        filename: source.filename,
        contentType,
        body: source.bytes,
        ttlSeconds,
        maxDownloads: opts.maxDownloads,
      });
      results.push(result);
      entries.push(result);
      ctx.history.upsert(toEntry(result, source, ttlSeconds));
      if (!opts.quiet && !opts.json) {
        ctx.err(
          `${style.green('✓')} ${source.filename} ${style.dim(`(${formatBytes(result.size)})`)} ` +
            `${style.dim('· expires')} ${clock(result.expiresAt, new Date(ctx.now()))}`,
        );
        if (source.skipped) {
          ctx.err(
            style.dim(`  left out ${source.skipped} symlink(s) that do not point to a file inside`),
          );
        }
      }
    } catch (err) {
      // A single failure is reported once, by the top-level handler.
      const label = target === '-' ? 'stdin' : target;
      if (targets.length === 1) throw labelled(err, label);
      if (failures++ === 0) firstFailure = errorText(labelled(err, path.basename(label)));
      if (opts.json) {
        entries.push({ file: label, ...errorJson(err) });
      } else {
        ctx.err(`${style.red('✗')} ${label}: ${(err as Error).message}`);
        if (err instanceof CliError && err.hint) ctx.err(`  ${style.dim(err.hint)}`);
      }
    }
  }

  const urls = results.map((r) => (opts.withName ? r.urlWithName : r.url));
  if (opts.json) {
    ctx.out(JSON.stringify(targets.length === 1 ? entries[0] : entries, null, 2));
  } else {
    for (const url of urls) ctx.out(url);
  }
  // --notify implies a clipboard copy (the notification says so) unless --no-copy.
  const wantCopy = opts.copy !== false && (ctx.config.copy || Boolean(opts.notify));
  let copied = false;
  if (urls.length > 0 && wantCopy) {
    copied = await ctx.copy(urls.join('\n'));
    if (copied && !opts.quiet && !opts.json) ctx.err(style.dim('  copied to clipboard'));
  }
  if (failures > 0) {
    // up() posts the single failure notification; successful links are still on stdout.
    const summary = `${failures} of ${targets.length} uploads failed.`;
    // A notification is all a launcher user sees, so it names the first reason (stderr already
    // lists every one, so the plain summary stays plain there).
    const detail = opts.notify ? firstFailure : '';
    // The JSON array above already carries every failure; a second document would break parsers.
    throw opts.json
      ? new ReportedError(detail ? `${summary} ${detail}` : summary)
      : new CliError(summary, detail || undefined);
  }
  if (opts.notify) {
    const state = copied ? 'copied' : 'ready';
    const subtitle = urls.length === 1 ? `Link ${state}` : `${urls.length} links ${state}`;
    await ctx.notify(subtitle, urls.join('\n'));
  }
}

/**
 * Stop (or ask) when the file looks like it holds secrets. A person at a terminal is asked;
 * scripts and the Quick Action have nobody to ask, so they are refused and told how to override.
 */
async function confirmSecrets(source: Source, opts: UpOptions, ctx: Context): Promise<void> {
  // One entry per file that looks sensitive; a folder has one per member.
  const flagged: { file: string | null; reasons: string[] }[] = [];
  if (source.kind === 'dir') {
    // The zip's own name says nothing; its members were checked while zipping.
    for (const { file, findings } of source.secrets ?? []) {
      flagged.push({ file, reasons: findings.map(describeFinding) });
    }
  } else {
    // `--name` must not rename a flagged file past the check, so look at the real name as well.
    const names = new Set([source.filename]);
    if (source.sourcePath) names.add(path.basename(source.sourcePath));
    const findings: SecretFinding[] = [];
    for (const name of names) {
      for (const f of checkFilename(name))
        if (!findings.some((o) => o.rule === f.rule)) findings.push(f);
    }
    findings.push(...checkContent(source.bytes));
    if (findings.length > 0) flagged.push({ file: null, reasons: findings.map(describeFinding) });
  }
  if (flagged.length === 0) return;
  const override = 'Pass --allow-secrets to upload anyway, or `fl config set warnSecrets false`.';
  const shown = flagged.slice(0, MAX_FLAGGED_SHOWN);
  const more = flagged.length - shown.length;
  const summary = (f: (typeof flagged)[number]) =>
    f.file ? `${f.file}: ${f.reasons.join(', ')}` : f.reasons.join('; ');
  // --json is for programs: it never prompts, and stderr stays quiet (the error is the JSON line).
  if (!ctx.interactive || opts.json) {
    const list = shown.map(summary).join('; ') + (more > 0 ? `; and ${more} more` : '');
    throw new CliError(`Looks like it contains secrets: ${list}.`, override);
  }
  const { style } = ctx;
  ctx.err(`${style.red('!')} ${source.filename} looks like it contains secrets:`);
  for (const f of shown) {
    ctx.err(f.file ? `    ${f.file}: ${f.reasons.join(', ')}` : `    ${f.reasons.join('\n    ')}`);
  }
  if (more > 0) ctx.err(`    …and ${more} more file(s)`);
  ctx.err(style.dim('  Anyone who has the link can read this file until it expires.'));
  const answer = await ctx.prompt('  Upload anyway? [y/N] ');
  if (!/^y(es)?$/i.test(answer)) {
    throw new CliError('Not uploaded.', override);
  }
}

const MAX_FLAGGED_SHOWN = 5;

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
    sourceKind: source.kind,
    createdAt: result.createdAt,
    expiresAt: result.expiresAt,
    ttlSeconds,
    maxDownloads: result.maxDownloads,
    hits: result.hits,
    lastRefreshedAt: null,
    state: 'active',
  };
}
