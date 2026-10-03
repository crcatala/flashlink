import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { CliError } from './errors.ts';
import { formatBytes } from './format.ts';
import { findSecrets, type SecretFinding } from './secrets.ts';
import { MAX_ENTRIES, MAX_ZIP_BYTES, ZipWriter } from './zip.ts';

/** Always left out unless the folder you pass is itself one of these. */
export const DEFAULT_EXCLUDES = ['.git', 'node_modules'];

/**
 * The uncompressed size at which we give up before reading anything, as a multiple of the file
 * cap. Text zips to a fraction of its size, but the whole zip is built in memory.
 */
export const RAW_SIZE_FACTOR = 20;

export interface FolderOptions {
  exclude: string[];
  /** Respect .gitignore when the folder is inside a git repository. */
  gitignore: boolean;
  maxBytes: number;
  /** Also scan every member for secrets (the secret warning's rules). */
  scanSecrets: boolean;
}

export interface FolderZip {
  bytes: Buffer;
  /** Name of the folder (also the folder every entry lives under inside the zip). */
  name: string;
  files: number;
  rawBytes: number;
  /** Symlinks (and special files) that were left out. */
  skipped: number;
  secrets: { file: string; findings: SecretFinding[] }[];
}

type Matcher = (relPath: string) => boolean;

/** Translate one glob segment: `*` (not `/`), `**` (anything), `?`. Everything else is literal. */
function globToRegExp(glob: string): string {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        i++;
        if (glob[i + 1] === '/') {
          i++;
          out += '(?:.*/)?'; // `**/` also matches nothing: a/**/b matches a/b
        } else out += '.*';
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[\\^$.|+(){}[\]]/g, '\\$&');
  }
  return out;
}

/**
 * Gitignore-style patterns, matched against the path relative to the folder:
 * no `/` in the pattern → matches a file or folder of that name at any depth; a `/` inside it
 * anchors it to the folder; a trailing `/` matches folders only. Matching a folder excludes
 * everything under it.
 */
export function compileExcludes(patterns: string[]): Matcher {
  const rules = patterns
    .map((raw) => raw.trim().replace(/^\.\//, ''))
    .filter(Boolean)
    .map((raw) => {
      const dirOnly = raw.endsWith('/');
      const body = raw.replace(/\/+$/, '').replace(/^\//, '');
      const anchored = raw.replace(/\/+$/, '').includes('/');
      return { dirOnly, anchored, re: new RegExp(`^${globToRegExp(body)}$`) };
    });
  return (relPath) => {
    const segments = relPath.split('/');
    for (let i = 1; i <= segments.length; i++) {
      const isDir = i < segments.length;
      const prefix = segments.slice(0, i).join('/');
      for (const rule of rules) {
        if (rule.dirOnly && !isDir) continue;
        if (rule.re.test(rule.anchored ? prefix : segments[i - 1]!)) return true;
      }
    }
    return false;
  };
}

/** Is `dir` inside a git work tree? A cheap look for `.git` first, so no `git` is started needlessly. */
function insideGitRepo(dir: string): boolean {
  for (let d = dir; ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, '.git'))) return true;
    if (path.dirname(d) === d) return false;
  }
}

/** Tracked plus untracked-but-not-ignored files below `dir`; undefined if git cannot say. */
function gitFileList(dir: string): string[] | undefined {
  if (!insideGitRepo(dir)) return undefined;
  try {
    const out = execFileSync(
      'git',
      ['-C', dir, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
      { encoding: 'buffer', stdio: ['ignore', 'pipe', 'ignore'], timeout: 30_000 },
    );
    return out
      .toString('utf8')
      .split('\0')
      .filter(Boolean)
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch {
    return undefined; // git missing, not a work tree, or too slow: fall back to a plain walk
  }
}

function walk(root: string, isExcluded: Matcher): string[] {
  const found: string[] = [];
  const visit = (rel: string): void => {
    const entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const entry of entries) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (isExcluded(child)) continue;
      if (entry.isDirectory()) visit(child);
      else found.push(child); // files, symlinks and specials: sorted out when read
    }
  };
  visit('');
  return found;
}

/** Zip a folder in memory. Throws CliError for everything a person can fix. */
export function zipFolder(dir: string, opts: FolderOptions): FolderZip {
  const root = path.resolve(dir);
  const realRoot = fs.realpathSync(root);
  const name = path.basename(root) || 'folder';
  const isExcluded = compileExcludes([...DEFAULT_EXCLUDES, ...opts.exclude]);

  let candidates: string[] | undefined;
  if (opts.gitignore) candidates = gitFileList(root)?.filter((rel) => !isExcluded(rel));
  try {
    candidates ??= walk(root, isExcluded);
  } catch (err) {
    throw new CliError(`Cannot read the folder: ${(err as Error).message}`);
  }

  // Decide what goes in. A symlink is followed only to a regular file that really lives inside
  // the folder; anything else (links out of the folder, links to folders, sockets) is skipped.
  const files: { rel: string; abs: string; size: number }[] = [];
  let skipped = 0;
  let rawBytes = 0;
  for (const rel of candidates) {
    const abs = path.join(root, rel);
    let stat: fs.Stats;
    try {
      const link = fs.lstatSync(abs);
      if (link.isSymbolicLink()) {
        const target = fs.realpathSync(abs);
        if (target !== realRoot && !target.startsWith(realRoot + path.sep)) throw new Error('out');
        stat = fs.statSync(abs);
      } else stat = link;
    } catch {
      skipped++; // broken link, link out of the folder, or deleted since `git ls-files`
      continue;
    }
    if (!stat.isFile()) {
      skipped++;
      continue;
    }
    files.push({ rel, abs, size: stat.size });
    rawBytes += stat.size;
  }

  if (files.length === 0) {
    throw new CliError(
      'Nothing to zip: no files are left after the exclusions.',
      opts.gitignore ? 'Files ignored by .gitignore are left out; see --no-gitignore.' : undefined,
    );
  }
  if (files.length > MAX_ENTRIES) {
    throw new CliError(
      `${files.length} files is too many for one zip (at most ${MAX_ENTRIES}).`,
      'Narrow it down with --exclude.',
    );
  }
  const rawLimit = Math.min(opts.maxBytes * RAW_SIZE_FACTOR, MAX_ZIP_BYTES);
  if (rawBytes > rawLimit) {
    throw new CliError(
      `The folder holds ${formatBytes(rawBytes)} of files (${files.length}), too much to zip ` +
        `against the ${formatBytes(opts.maxBytes)} limit.`,
      'Leave things out with --exclude, or raise the limit with `r2fl config set maxFileBytes <size>`.',
    );
  }

  const zip = new ZipWriter();
  const secrets: FolderZip['secrets'] = [];
  for (const file of files) {
    let data: Buffer;
    try {
      data = fs.readFileSync(file.abs);
    } catch (err) {
      throw new CliError(`Cannot read ${file.rel}: ${(err as NodeJS.ErrnoException).message}`);
    }
    const stat = fs.statSync(file.abs);
    zip.add(`${name}/${file.rel}`, data, stat.mtime, 0o100000 | (stat.mode & 0o777));
    if (opts.scanSecrets) {
      const findings = findSecrets(file.rel, data);
      if (findings.length > 0) secrets.push({ file: file.rel, findings });
    }
    // Stop as soon as the zip is over the cap instead of compressing the rest for nothing.
    if (zip.bytes > opts.maxBytes) {
      throw new CliError(
        `The zip is over the ${formatBytes(opts.maxBytes)} limit (already ${formatBytes(zip.bytes)} ` +
          `after ${zip.count} of ${files.length} files).`,
        'Leave things out with --exclude, or raise the limit with `r2fl config set maxFileBytes <size>` (the server enforces its own cap too).',
      );
    }
  }
  const bytes = zip.finish();
  if (bytes.length > opts.maxBytes) {
    throw new CliError(
      `The zip is ${formatBytes(bytes.length)}, over the ${formatBytes(opts.maxBytes)} limit.`,
      'Leave things out with --exclude, or raise the limit with `r2fl config set maxFileBytes <size>` (the server enforces its own cap too).',
    );
  }
  return { bytes, name, files: files.length, rawBytes, skipped, secrets };
}
