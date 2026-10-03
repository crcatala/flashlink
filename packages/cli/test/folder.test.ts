import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { refresh } from '../src/commands/refresh.ts';
import { up } from '../src/commands/up.ts';
import { compileExcludes, zipFolder } from '../src/folder.ts';
import { crc32 } from '../src/zip.ts';
import { makeHarness, type Harness } from './harness.ts';

/** Read a zip through its central directory, like any unzip tool would. */
function readZip(zip: Uint8Array): Map<string, { data: Buffer; mode: number }> {
  const buf = Buffer.from(zip);
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(end).toBeGreaterThan(-1);
  const count = buf.readUInt16LE(end + 10);
  let p = buf.readUInt32LE(end + 16);
  const out = new Map<string, { data: Buffer; mode: number }>();
  for (let i = 0; i < count; i++) {
    expect(buf.readUInt32LE(p)).toBe(0x02014b50);
    const method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const mode = buf.readUInt32LE(p + 38) >>> 16;
    const local = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString('utf8');
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : inflateRawSync(raw);
    expect(crc32(data)).toBe(crc);
    out.set(name, { data, mode });
    p += 46 + nameLen;
  }
  return out;
}

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

function uploadedZip(code = 'AAAAAAA1') {
  return readZip(h.server.links.get(code)!.body);
}

describe('r2fl up <folder>', () => {
  it('uploads <name>.zip as application/zip with the folder contents under <name>/', async () => {
    h.file('proj/readme.md', '# hi\n'.repeat(50));
    h.file('proj/src/a.ts', 'export const a = 1;\n');
    h.file('proj/data.bin', Buffer.from([0, 1, 2, 3, 255, 254]));
    h.file('proj/unicode/héllo wörld.txt', 'ok');
    fs.chmodSync(path.join(h.dir, 'proj/src/a.ts'), 0o755);

    await up([path.join(h.dir, 'proj')], {}, h.ctx);

    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    const stored = h.server.links.get('AAAAAAA1')!;
    expect(stored.filename).toBe('proj.zip');
    expect(stored.contentType).toBe('application/zip');
    const zip = uploadedZip();
    expect([...zip.keys()].sort()).toEqual([
      'proj/data.bin',
      'proj/readme.md',
      'proj/src/a.ts',
      'proj/unicode/héllo wörld.txt',
    ]);
    expect(zip.get('proj/readme.md')!.data.toString()).toBe('# hi\n'.repeat(50));
    expect(zip.get('proj/data.bin')!.data).toEqual(Buffer.from([0, 1, 2, 3, 255, 254]));
    expect(zip.get('proj/src/a.ts')!.mode & 0o777).toBe(0o755);
    expect(zip.get('proj/readme.md')!.mode & 0o777).toBe(0o644);
  });

  it('is a valid archive for the system unzip (extracts to the same files)', async (ctx) => {
    if (spawnSync('unzip', ['-v']).error) return ctx.skip();
    h.file('proj/a.txt', 'alpha\n'.repeat(1000));
    h.file('proj/sub/b.txt', 'beta');
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    const zipFile = path.join(h.dir, 'out.zip');
    fs.writeFileSync(zipFile, h.server.links.get('AAAAAAA1')!.body);
    execFileSync('unzip', ['-q', zipFile, '-d', path.join(h.dir, 'x')]);
    expect(fs.readFileSync(path.join(h.dir, 'x/proj/a.txt'), 'utf8')).toBe('alpha\n'.repeat(1000));
    expect(fs.readFileSync(path.join(h.dir, 'x/proj/sub/b.txt'), 'utf8')).toBe('beta');
    execFileSync('unzip', ['-tq', zipFile]);
  });

  it('records the folder as the source and tells it apart from a file', async () => {
    h.file('proj/a.txt', 'a');
    const dir = path.join(h.dir, 'proj');
    await up([dir], {}, h.ctx);
    const [entry] = h.ctx.history.list();
    expect(entry).toMatchObject({
      filename: 'proj.zip',
      contentType: 'application/zip',
      sourcePath: dir,
      sourceKind: 'dir',
    });
    await up([h.file('f.txt', 'f')], {}, h.ctx);
    expect(h.ctx.history.find('AAAAAAA2')!.sourceKind).toBe('file');
  });

  it('honours --name and always sends application/zip', async () => {
    h.file('proj/a.txt', 'a');
    await up([path.join(h.dir, 'proj')], { name: 'bundle.dat' }, h.ctx);
    const stored = h.server.links.get('AAAAAAA1')!;
    expect(stored.filename).toBe('bundle.dat');
    expect(stored.contentType).toBe('application/zip');
    expect([...uploadedZip().keys()]).toEqual(['proj/a.txt']);
  });

  it('works for "." and a trailing slash (named after the real folder)', async () => {
    h.file('proj/a.txt', 'a');
    const cwd = process.cwd();
    try {
      process.chdir(path.join(h.dir, 'proj'));
      await up(['.'], {}, h.ctx);
      await up([`${path.join(h.dir, 'proj')}/`], {}, h.ctx);
    } finally {
      process.chdir(cwd);
    }
    expect(h.server.links.get('AAAAAAA1')!.filename).toBe('proj.zip');
    expect(h.server.links.get('AAAAAAA2')!.filename).toBe('proj.zip');
    expect([...uploadedZip('AAAAAAA1').keys()]).toEqual(['proj/a.txt']);
  });

  it('mixes files and folders in one run', async () => {
    h.file('proj/a.txt', 'a');
    await up([h.file('f.txt', 'f'), path.join(h.dir, 'proj')], {}, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1', 'https://fl.test/AAAAAAA2']);
  });
});

describe('exclusions', () => {
  it('always leaves out .git and node_modules (at any depth), unless the folder is one itself', async () => {
    h.file('proj/keep.txt', 'k');
    h.file('proj/.git/config', 'x');
    h.file('proj/node_modules/pkg/index.js', 'x');
    h.file('proj/sub/node_modules/pkg/index.js', 'x');
    h.file('proj/sub/ok.txt', 'ok');
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    expect([...uploadedZip().keys()].sort()).toEqual(['proj/keep.txt', 'proj/sub/ok.txt']);

    // Pointing at node_modules itself is the explicit way to include it.
    await up([path.join(h.dir, 'proj/node_modules')], {}, h.ctx);
    expect([...uploadedZip('AAAAAAA2').keys()]).toEqual(['node_modules/pkg/index.js']);
  });

  it('--exclude works with names, anchored paths, folder-only and ** patterns', async () => {
    h.file('p/a.log', '1');
    h.file('p/sub/b.log', '1');
    h.file('p/build/out.js', '1');
    h.file('p/src/build/keep.js', '1');
    h.file('p/docs/a/secret.md', '1');
    h.file('p/docs/b/secret.md', '1');
    h.file('p/keep.txt', '1');
    await up(
      [path.join(h.dir, 'p')],
      { exclude: ['*.log', '/build/', 'docs/**/secret.md'] },
      h.ctx,
    );
    expect([...uploadedZip().keys()].sort()).toEqual(['p/keep.txt', 'p/src/build/keep.js']);
  });

  it('matches like gitignore (unit)', () => {
    const m = compileExcludes(['*.log', '/top', 'a/b', 'dir/', '**/gen', 'x?.txt']);
    expect(m('err.log')).toBe(true);
    expect(m('deep/er/err.log')).toBe(true);
    expect(m('top')).toBe(true);
    expect(m('top/inner.txt')).toBe(true);
    expect(m('sub/top')).toBe(false);
    expect(m('a/b/c.txt')).toBe(true);
    expect(m('z/a/b')).toBe(false);
    expect(m('dir/f')).toBe(true);
    expect(m('deeper/dir/f')).toBe(true);
    expect(m('dir')).toBe(false); // `dir/` only matches folders
    expect(m('gen')).toBe(true);
    expect(m('a/gen/f')).toBe(true);
    expect(m('xy.txt')).toBe(true);
    expect(m('xyz.txt')).toBe(false);
    expect(m('a.log.txt')).toBe(false);
  });

  it('respects .gitignore inside a git repository, and --no-gitignore disables it', async () => {
    const repo = path.join(h.dir, 'repo');
    h.file('repo/.gitignore', 'ignored.txt\nbuild/\n');
    h.file('repo/tracked.txt', 't');
    h.file('repo/untracked.txt', 'u');
    h.file('repo/ignored.txt', 'i');
    h.file('repo/build/out.js', 'b');
    h.file('repo/nested/.gitignore', '*.tmp\n');
    h.file('repo/nested/a.tmp', 'x');
    h.file('repo/nested/a.txt', 'a');
    const git = (...args: string[]) =>
      execFileSync('git', ['-C', repo, '-c', 'user.email=t@t', '-c', 'user.name=t', ...args], {
        stdio: 'ignore',
      });
    git('init', '-q');
    git('add', 'tracked.txt');
    git('commit', '-qm', 'x');

    await up([repo], {}, h.ctx);
    expect([...uploadedZip().keys()].sort()).toEqual([
      'repo/.gitignore',
      'repo/nested/.gitignore',
      'repo/nested/a.txt',
      'repo/tracked.txt',
      'repo/untracked.txt',
    ]);

    await up([repo], { gitignore: false }, h.ctx);
    expect([...uploadedZip('AAAAAAA2').keys()].sort()).toEqual([
      'repo/.gitignore',
      'repo/build/out.js',
      'repo/ignored.txt',
      'repo/nested/.gitignore',
      'repo/nested/a.tmp',
      'repo/nested/a.txt',
      'repo/tracked.txt',
      'repo/untracked.txt',
    ]);
  });

  it('uses only the subfolder when it is inside a repository', async () => {
    const repo = path.join(h.dir, 'repo');
    h.file('repo/top.txt', 't');
    h.file('repo/pkg/a.txt', 'a');
    execFileSync('git', ['-C', repo, 'init', '-q'], { stdio: 'ignore' });
    await up([path.join(repo, 'pkg')], {}, h.ctx);
    expect([...uploadedZip().keys()]).toEqual(['pkg/a.txt']);
  });

  it('ignores .gitignore outside a repository', async () => {
    h.file('plain/.gitignore', 'a.txt\n');
    h.file('plain/a.txt', 'a');
    await up([path.join(h.dir, 'plain')], {}, h.ctx);
    expect([...uploadedZip().keys()].sort()).toEqual(['plain/.gitignore', 'plain/a.txt']);
  });

  it('fails clearly when everything is excluded', async () => {
    h.file('p/a.log', '1');
    await expect(up([path.join(h.dir, 'p')], { exclude: ['*.log'] }, h.ctx)).rejects.toThrow(
      /p: Nothing to zip/,
    );
    expect(h.server.requests).toHaveLength(0);
  });
});

describe('symlinks', () => {
  it('never follows a symlink out of the folder, and skips links to folders', async () => {
    const outside = h.file('outside/secret.txt', 'TOP SECRET');
    h.file('proj/inside.txt', 'inside');
    fs.symlinkSync(outside, path.join(h.dir, 'proj/leak.txt'));
    fs.symlinkSync(path.join(h.dir, 'outside'), path.join(h.dir, 'proj/leakdir'));
    fs.symlinkSync('inside.txt', path.join(h.dir, 'proj/alias.txt'));
    fs.symlinkSync('nowhere', path.join(h.dir, 'proj/broken'));
    fs.symlinkSync('../outside/secret.txt', path.join(h.dir, 'proj/relative-leak.txt'));

    await up([path.join(h.dir, 'proj')], {}, h.ctx);

    const zip = uploadedZip();
    expect([...zip.keys()].sort()).toEqual(['proj/alias.txt', 'proj/inside.txt']);
    expect(zip.get('proj/alias.txt')!.data.toString()).toBe('inside');
    for (const { data } of zip.values()) expect(data.toString()).not.toContain('TOP SECRET');
    expect(h.stderr.join('\n')).toMatch(/left out 4 symlink/);
  });

  it('skips a symlink that loops back to the folder', async () => {
    h.file('proj/a.txt', 'a');
    fs.symlinkSync('.', path.join(h.dir, 'proj/loop'));
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    expect([...uploadedZip().keys()]).toEqual(['proj/a.txt']);
  });
});

describe('size cap', () => {
  it('applies to the zipped size: a big but compressible folder is fine', async () => {
    h.ctx.config.maxFileBytes = 5000;
    h.file('proj/zeros.txt', 'a'.repeat(100_000)); // 100 KB raw, well under 5 KB zipped
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    expect(h.server.links.get('AAAAAAA1')!.size).toBeLessThan(5000);
  });

  it('refuses a zip over the cap, naming the zipped size and the way out', async () => {
    h.ctx.config.maxFileBytes = 2000;
    h.file('proj/noise.bin', Buffer.from(crypto.getRandomValues(new Uint8Array(4000))));
    await expect(up([path.join(h.dir, 'proj')], {}, h.ctx)).rejects.toThrow(
      /proj: The zip is .*over the 2\.0 KB limit/,
    );
    expect(h.server.requests).toHaveLength(0);
  });

  it('stops zipping as soon as the cap is passed', () => {
    h.file('p/a.bin', Buffer.from(crypto.getRandomValues(new Uint8Array(3000))));
    h.file('p/b.bin', Buffer.from(crypto.getRandomValues(new Uint8Array(3000))));
    h.file('p/c.bin', Buffer.from(crypto.getRandomValues(new Uint8Array(3000))));
    expect(() =>
      zipFolder(path.join(h.dir, 'p'), {
        exclude: [],
        gitignore: false,
        maxBytes: 4000,
        scanSecrets: false,
      }),
    ).toThrow(/already .* after 2 of 3 files/);
  });

  it('refuses up front when the raw size is absurd for the cap', async () => {
    h.ctx.config.maxFileBytes = 100;
    h.file('proj/big.txt', 'x'.repeat(5000)); // > 20 x 100
    await expect(up([path.join(h.dir, 'proj')], {}, h.ctx)).rejects.toThrow(/too much to zip/);
  });

  it('writes nothing to the temp directory (the zip lives in memory only)', async () => {
    h.file('proj/a.txt', 'a');
    const spy: string[] = [];
    const orig = fs.writeFileSync;
    fs.writeFileSync = ((f: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      spy.push(String(f));
      return (orig as (...a: unknown[]) => void)(f, ...rest);
    }) as typeof fs.writeFileSync;
    try {
      await up([path.join(h.dir, 'proj')], {}, h.ctx);
    } finally {
      fs.writeFileSync = orig;
    }
    expect(spy.filter((f) => f.endsWith('.zip'))).toEqual([]);
  });
});

describe('secret warning for folders', () => {
  it('refuses a folder containing a sensitive file when nobody can be asked, naming the file', async () => {
    h.file('proj/ok.txt', 'fine');
    h.file('proj/config/.env', 'A=1\n');
    h.file('proj/notes.txt', 'key: AKIAABCDEFGHIJKLMNOP\n');
    await expect(up([path.join(h.dir, 'proj')], {}, h.ctx)).rejects.toThrow(
      /config\/\.env: file name looks like a \.env file; notes\.txt: AWS access key ID \(line 1\)/,
    );
    expect(h.server.requests).toHaveLength(0);
  });

  it('asks at a terminal, lists the files, and uploads on yes', async () => {
    h.file('proj/.env', 'A=1\n');
    h.stdin.interactive = true;
    h.ctx.prompt = async () => 'y';
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    expect(h.stderr.join('\n')).toContain('.env: file name looks like a .env file');
    expect(h.server.links.size).toBe(1);
  });

  it('--allow-secrets uploads it, and a clean folder needs no override', async () => {
    h.file('proj/.env', 'A=1\n');
    await up([path.join(h.dir, 'proj')], { allowSecrets: true }, h.ctx);
    expect(h.server.links.size).toBe(1);
    h.file('clean/a.txt', 'a');
    await up([path.join(h.dir, 'clean')], {}, h.ctx);
    expect(h.server.links.size).toBe(2);
  });

  it('is not fooled by an excluded sensitive file (it is not uploaded, so not flagged)', async () => {
    h.file('proj/.env', 'A=1\n');
    h.file('proj/a.txt', 'a');
    await up([path.join(h.dir, 'proj')], { exclude: ['.env'] }, h.ctx);
    expect([...uploadedZip().keys()]).toEqual(['proj/a.txt']);
  });

  it('summarises many flagged files instead of listing them all', async () => {
    for (let i = 0; i < 8; i++) h.file(`proj/k${i}.pem`, 'x');
    await expect(up([path.join(h.dir, 'proj')], {}, h.ctx)).rejects.toThrow(/and 3 more/);
  });
});

describe('refresh after a purge', () => {
  it('refuses to re-upload a zipped folder, with a clear message and no server write', async () => {
    h.file('proj/a.txt', 'a');
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    h.server.purge('AAAAAAA1');
    await expect(refresh('AAAAAAA1', {}, h.ctx)).rejects.toThrow(
      /purged from the server; it was a zipped folder/,
    );
    expect(h.server.requests.some((r) => r.method === 'PUT')).toBe(false);
  });

  it('still refreshes a live folder link (the server keeps the object)', async () => {
    h.file('proj/a.txt', 'a');
    await up([path.join(h.dir, 'proj')], {}, h.ctx);
    h.stdout.length = 0;
    await refresh('AAAAAAA1', {}, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
  });
});
