import fs from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { up, upWithContext } from '../src/commands/up.ts';
import { CliError, ReportedError } from '../src/errors.ts';
import { entryStatus } from '../src/history.ts';
import { makeHarness, type Harness } from './harness.ts';

let h: Harness;
beforeEach(() => {
  h = makeHarness();
});
afterEach(() => h.cleanup());

describe('r2fl up', () => {
  it('uploads a file, prints only the URL on stdout, and records history', async () => {
    const file = h.file('notes.txt', 'hello');
    await up([file], {}, h.ctx);

    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.stderr.join('\n')).toContain('notes.txt');
    const stored = h.server.links.get('AAAAAAA1')!;
    expect(Buffer.from(stored.body).toString()).toBe('hello');
    expect(stored.contentType).toBe('text/plain');

    const [entry] = h.ctx.history.list();
    expect(entry).toMatchObject({
      code: 'AAAAAAA1',
      filename: 'notes.txt',
      size: 5,
      sourcePath: file,
      ttlSeconds: 3600,
      state: 'active',
    });
    expect(entry!.sha256).toHaveLength(64);
    expect(entryStatus(entry!, h.server.now)).toBe('live');
  });

  it('sends the global default TTL, and --ttl overrides it', async () => {
    const file = h.file('a.txt', 'a');
    await up([file], {}, h.ctx);
    expect(h.server.requests.at(-1)!.headers.get('X-TTL-Seconds')).toBe('3600');

    h.ctx.config.defaultTtl = '15m';
    await up([file], {}, h.ctx);
    expect(h.server.requests.at(-1)!.headers.get('X-TTL-Seconds')).toBe('900');

    await up([file], { ttl: '2h' }, h.ctx);
    expect(h.server.requests.at(-1)!.headers.get('X-TTL-Seconds')).toBe('7200');
  });

  it('rejects an invalid --ttl before contacting the server', async () => {
    const file = h.file('a.txt', 'a');
    await expect(up([file], { ttl: 'soon' }, h.ctx)).rejects.toThrow(/Invalid duration/);
    expect(h.server.requests).toHaveLength(0);
  });

  it('passes max-downloads and detects content types', async () => {
    const png = h.file('pic.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]));
    await up([png], { maxDownloads: 3 }, h.ctx);
    const req = h.server.requests.at(-1)!;
    expect(req.headers.get('X-Max-Downloads')).toBe('3');
    expect(req.headers.get('Content-Type')).toBe('image/png');
  });

  it('falls back to text/plain or octet-stream for unknown extensions', async () => {
    await up([h.file('Makefile', 'all:\n\techo hi\n')], {}, h.ctx);
    expect(h.server.links.get('AAAAAAA1')!.contentType).toBe('text/plain');
    await up([h.file('blob.zzzz', Buffer.from([1, 0, 2, 0]))], {}, h.ctx);
    expect(h.server.links.get('AAAAAAA2')!.contentType).toBe('application/octet-stream');
  });

  it('percent-encodes unicode filenames', async () => {
    await up([h.file('héllo wörld.txt', 'x')], {}, h.ctx);
    expect(h.server.requests.at(-1)!.headers.get('X-Filename')).toBe(
      encodeURIComponent('héllo wörld.txt'),
    );
    expect(h.server.links.get('AAAAAAA1')!.filename).toBe('héllo wörld.txt');
  });

  it('uploads several files and prints one URL each', async () => {
    await up([h.file('a.txt', 'a'), h.file('b.txt', 'b')], {}, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1', 'https://fl.test/AAAAAAA2']);
    expect(h.clipboard).toEqual(['https://fl.test/AAAAAAA1\nhttps://fl.test/AAAAAAA2']);
  });

  it('--with-name appends the filename', async () => {
    await up([h.file('my pic.png', 'x')], { withName: true }, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1/my%20pic.png']);
  });

  it('--json prints the full result (object for one file, array for many)', async () => {
    await up([h.file('a.txt', 'a')], { json: true }, h.ctx);
    const one = JSON.parse(h.stdout[0]!);
    expect(one).toMatchObject({ code: 'AAAAAAA1', url: 'https://fl.test/AAAAAAA1' });
    expect(h.stderr).toEqual([]);

    h.stdout.length = 0;
    await up([h.file('b.txt', 'b'), h.file('c.txt', 'c')], { json: true }, h.ctx);
    expect(JSON.parse(h.stdout[0]!)).toHaveLength(2);
  });

  it('--json with several files prints one array with per-file errors and nothing on stderr', async () => {
    const good = h.file('good.txt', 'ok');
    const missing = `${h.dir}/missing.txt`;
    await expect(up([missing, good], { json: true }, h.ctx)).rejects.toBeInstanceOf(ReportedError);

    expect(h.stdout).toHaveLength(1);
    const [failed, ok] = JSON.parse(h.stdout[0]!);
    expect(failed).toEqual({ file: missing, error: 'cli_error', message: 'No such file.' });
    expect(ok).toMatchObject({ code: 'AAAAAAA1', filename: 'good.txt' });
    expect(h.stderr).toEqual([]);
  });

  it('--json with several files stays an array when only one succeeds, or none do', async () => {
    const missing = `${h.dir}/missing.txt`;
    await expect(up([missing, `${h.dir}/gone.txt`], { json: true }, h.ctx)).rejects.toThrow(
      /2 of 2 uploads failed/,
    );
    expect(JSON.parse(h.stdout[0]!)).toHaveLength(2);
    expect(h.stderr).toEqual([]);
  });

  it('copies to the clipboard unless disabled', async () => {
    const file = h.file('a.txt', 'a');
    await up([file], {}, h.ctx);
    expect(h.clipboard).toEqual(['https://fl.test/AAAAAAA1']);
    await up([file], { copy: false }, h.ctx);
    expect(h.clipboard).toHaveLength(1);
    h.ctx.config.copy = false;
    await up([file], {}, h.ctx);
    expect(h.clipboard).toHaveLength(1);
  });

  it('reads stdin with a name, and picks a default name otherwise', async () => {
    h.stdin.data = Buffer.from('piped text');
    await up([], { name: 'out.log' }, h.ctx);
    expect(h.server.links.get('AAAAAAA1')).toMatchObject({
      filename: 'out.log',
      contentType: 'text/plain',
    });
    expect(h.ctx.history.find('AAAAAAA1')!.sourcePath).toBeNull();

    await up(['-'], {}, h.ctx);
    expect(h.server.links.get('AAAAAAA2')!.filename).toBe('stdin.txt');
  });

  it('refuses to wait on an interactive terminal with no files', async () => {
    h.stdin.isTTY = true;
    await expect(up([], {}, h.ctx)).rejects.toThrow(/No files given/);
  });

  it('rejects empty files, empty folders and missing files with a labelled message', async () => {
    await expect(up([h.file('empty.txt', '')], {}, h.ctx)).rejects.toThrow(
      /empty\.txt: Empty file/,
    );
    fs.mkdirSync(`${h.dir}/dir`);
    await expect(up([`${h.dir}/dir`], {}, h.ctx)).rejects.toThrow(/dir: Nothing to zip/);
    await expect(up([`${h.dir}/nope.txt`], {}, h.ctx)).rejects.toThrow(/nope\.txt: No such file/);
    h.stdin.data = Buffer.alloc(0);
    await expect(up([], {}, h.ctx)).rejects.toThrow(/stdin: Empty input/);
    expect(h.server.requests).toHaveLength(0);
  });

  it('enforces the client-side size limit before contacting the server', async () => {
    h.ctx.config.maxFileBytes = 10;
    await expect(up([h.file('big.txt', 'x'.repeat(11))], {}, h.ctx)).rejects.toThrow(
      /big\.txt: 11 B exceeds the 10 B limit/,
    );
    h.stdin.data = Buffer.from('x'.repeat(11));
    await expect(up([], {}, h.ctx)).rejects.toThrow(/stdin: 11 B exceeds/);
    expect(h.server.requests).toHaveLength(0);
  });

  it('continues past a failing file, reports it, and still exits non-zero', async () => {
    const good = h.file('good.txt', 'ok');
    await expect(up([`${h.dir}/missing.txt`, good], {}, h.ctx)).rejects.toThrow(
      /1 of 2 uploads failed/,
    );
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.stderr.join('\n')).toContain('missing.txt: No such file');
  });

  it('surfaces server errors such as 413', async () => {
    h.server.failUploadsWith = {
      status: 413,
      error: 'file_too_large',
      message: 'File is too big.',
    };
    await expect(up([h.file('a.txt', 'a')], {}, h.ctx)).rejects.toThrow('File is too big.');
    expect(h.stdout).toEqual([]);
    expect(h.ctx.history.list()).toEqual([]);
  });

  it('rejects --name with several files', async () => {
    await expect(
      up([h.file('a.txt', 'a'), h.file('b.txt', 'b')], { name: 'x.txt' }, h.ctx),
    ).rejects.toThrow(/--name only works/);
  });

  it('reads the file at upload time, not before validation (no stale bytes)', async () => {
    const file = h.file('a.txt', 'v1');
    fs.writeFileSync(file, 'v2');
    await up([file], {}, h.ctx);
    expect(Buffer.from(h.server.links.get('AAAAAAA1')!.body).toString()).toBe('v2');
  });
});

describe('r2fl up --notify when the context cannot be built', () => {
  const broken = () => {
    throw new Error('Unexpected token } in config.json');
  };

  it('posts the failure notification itself and still rethrows', async () => {
    const posted: { subtitle: string; body: string }[] = [];
    const notify = async (subtitle: string, body: string) => {
      posted.push({ subtitle, body });
      return true;
    };
    await expect(upWithContext(['a.txt'], { notify: true }, broken, notify)).rejects.toThrow(
      'Unexpected token',
    );
    expect(posted).toEqual([
      { subtitle: 'Upload failed', body: 'Unexpected token } in config.json' },
    ]);
  });

  it('does not notify without --notify', async () => {
    const notify = async () => {
      throw new Error('should not be called');
    };
    await expect(upWithContext(['a.txt'], {}, broken, notify)).rejects.toThrow('Unexpected');
  });
});

describe('r2fl up --notify', () => {
  it('notifies once with the URL, copies it, and keeps stdout URL-only', async () => {
    const file = h.file('notes.txt', 'hello');
    await up([file], { notify: true }, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.clipboard).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.notifications).toEqual([
      { subtitle: 'Link copied', body: 'https://fl.test/AAAAAAA1' },
    ]);
  });

  it('copies even when the config disables copying, but not with --no-copy', async () => {
    h.ctx.config.copy = false;
    const file = h.file('a.txt', 'a');
    await up([file], { notify: true }, h.ctx);
    expect(h.clipboard).toHaveLength(1);

    await up([file], { notify: true, copy: false }, h.ctx);
    expect(h.clipboard).toHaveLength(1);
    expect(h.notifications.at(-1)).toMatchObject({ subtitle: 'Link ready' });
  });

  it('sends one summarizing notification for several files', async () => {
    const a = h.file('a.txt', 'a');
    const b = h.file('b.txt', 'b');
    await up([a, b], { notify: true }, h.ctx);
    expect(h.notifications).toEqual([
      { subtitle: '2 links copied', body: 'https://fl.test/AAAAAAA1\nhttps://fl.test/AAAAAAA2' },
    ]);
  });

  it('notifies with the error (and hint) on failure, and still throws', async () => {
    const empty = h.file('empty.txt', '');
    await expect(up([empty], { notify: true }, h.ctx)).rejects.toThrow('empty.txt: Empty file.');
    expect(h.notifications).toEqual([{ subtitle: 'Upload failed', body: `${empty}: Empty file.` }]);

    h.server.failUploadsWith = { status: 429, error: 'rate_limited', message: 'Slow down.' };
    const ok = h.file('ok.txt', 'x');
    await expect(up([ok], { notify: true }, h.ctx)).rejects.toThrow('Slow down.');
    expect(h.notifications.at(-1)).toEqual({ subtitle: 'Upload failed', body: 'Slow down.' });
    expect(h.notifications).toHaveLength(2);
  });

  it('notifies about failures that happen before any upload (bad --ttl, not configured)', async () => {
    const file = h.file('a.txt', 'a');
    await expect(up([file], { notify: true, ttl: 'soon' }, h.ctx)).rejects.toThrow();
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]!.subtitle).toBe('Upload failed');
    expect(h.notifications[0]!.body).toMatch(/Invalid duration/);
  });

  it('posts a single failure notification when only some files fail', async () => {
    const good = h.file('good.txt', 'g');
    const empty = h.file('empty.txt', '');
    await expect(up([good, empty], { notify: true }, h.ctx)).rejects.toThrow(
      '1 of 2 uploads failed.',
    );
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.notifications).toEqual([
      { subtitle: 'Upload failed', body: '1 of 2 uploads failed. empty.txt: Empty file.' },
    ]);
  });

  it('does not notify without --notify', async () => {
    const file = h.file('a.txt', 'a');
    await up([file], {}, h.ctx);
    await expect(up([h.file('e.txt', '')], {}, h.ctx)).rejects.toThrow();
    expect(h.notifications).toEqual([]);
  });
});

describe('r2fl up secret warning', () => {
  const AWS = 'AKIAIOSFODNN7EXAMPLE';
  const refusal = /Looks like it contains secrets: AWS access key ID \(line 1\)/;

  it('refuses a file with secrets when nobody can answer, without contacting the server', async () => {
    const file = h.file('config.txt', `key=${AWS}\n`);
    const err = await up([file], {}, h.ctx).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CliError);
    expect((err as CliError).message).toMatch(refusal);
    expect((err as CliError).message).not.toContain(AWS);
    expect((err as CliError).hint).toMatch(/--allow-secrets.*warnSecrets false/);
    expect(h.server.requests).toHaveLength(0);
    expect(h.stdout).toEqual([]);
    expect(h.ctx.history.list()).toHaveLength(0);
  });

  it('refuses by file name alone', async () => {
    await expect(up([h.file('.env', 'A=1\n')], {}, h.ctx)).rejects.toThrow(/\.env file/);
    expect(h.server.requests).toHaveLength(0);
  });

  it('refuses secrets that arrive on stdin', async () => {
    h.stdin.data = Buffer.from(`token=${AWS}`);
    await expect(up([], { name: 'out.txt' }, h.ctx)).rejects.toThrow(refusal);
    expect(h.server.requests).toHaveLength(0);
  });

  it.each([{ allowSecrets: true }, { yes: true }])('uploads when overridden with %j', async (o) => {
    await up([h.file('.env', `key=${AWS}\n`)], o, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
  });

  it('uploads when warnSecrets is off', async () => {
    h.ctx.config.warnSecrets = false;
    await up([h.file('.env', `key=${AWS}\n`)], {}, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
  });

  it('asks on a terminal, shows what matched but not the secret, and uploads on yes', async () => {
    h.stdin.interactive = true;
    const questions: string[] = [];
    h.ctx.prompt = async (q) => {
      questions.push(q);
      return 'y';
    };
    await up([h.file('.env', `key=${AWS}\n`)], {}, h.ctx);

    expect(questions).toEqual(['  Upload anyway? [y/N] ']);
    const shown = h.stderr.join('\n');
    expect(shown).toContain('looks like a .env file');
    expect(shown).toContain('AWS access key ID (line 1)');
    expect(shown).not.toContain(AWS);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
  });

  it.each(['', 'n', 'no', 'maybe'])('does not upload when the answer is %j', async (answer) => {
    h.stdin.interactive = true;
    h.ctx.prompt = async () => answer;
    await expect(up([h.file('.env', 'A=1\n')], {}, h.ctx)).rejects.toThrow(/Not uploaded/);
    expect(h.server.requests).toHaveLength(0);
  });

  it('does not ask when --allow-secrets is given', async () => {
    h.stdin.interactive = true;
    await up([h.file('.env', 'A=1\n')], { allowSecrets: true }, h.ctx); // default prompt throws
    expect(h.stdout).toHaveLength(1);
  });

  it('uploads clean files untouched, and skips the content scan for binary files', async () => {
    await up([h.file('notes.txt', 'hello')], {}, h.ctx);
    await up(
      [h.file('pic.bin', Buffer.concat([Buffer.from([0, 1]), Buffer.from(AWS)]))],
      {},
      h.ctx,
    );
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1', 'https://fl.test/AAAAAAA2']);
  });

  it('with several files, skips only the flagged one and reports it', async () => {
    const flagged = h.file('.env', 'A=1\n');
    const ok = h.file('ok.txt', 'fine');
    await expect(up([flagged, ok], {}, h.ctx)).rejects.toThrow(/1 of 2 uploads failed/);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
    expect(h.stderr.join('\n')).toMatch(/\.env.*\.env file/);
  });

  it('is reported through --notify, so the Quick Action user sees why nothing was uploaded', async () => {
    await expect(up([h.file('.env', 'A=1\n')], { notify: true }, h.ctx)).rejects.toThrow();
    expect(h.notifications).toHaveLength(1);
    expect(h.notifications[0]).toMatchObject({ subtitle: 'Upload failed' });
    expect(h.notifications[0]!.body).toMatch(/secrets.*--allow-secrets/);
  });

  it('still checks the real file name when --name renames the upload', async () => {
    const file = h.file('.env', 'A=1\n');
    await expect(up([file], { name: 'notes.txt' }, h.ctx)).rejects.toThrow(/\.env file/);
    expect(h.server.requests).toHaveLength(0);
    await up([file], { name: 'notes.txt', allowSecrets: true }, h.ctx);
    expect(h.stdout).toEqual(['https://fl.test/AAAAAAA1']);
  });

  it('does not report the same rule twice when the new name matches too', async () => {
    const file = h.file('.env', 'A=1\n');
    const err = (await up([file], { name: 'prod.env' }, h.ctx).catch((e: unknown) => e)) as Error;
    expect(err.message.match(/\.env file/g)).toHaveLength(1);
  });

  it('never prompts in --json mode: stderr stays quiet and the failure is the JSON error', async () => {
    h.stdin.interactive = true; // the default prompt throws, so a prompt would fail the test
    await expect(up([h.file('.env', 'A=1\n')], { json: true }, h.ctx)).rejects.toThrow(/secrets/);
    expect(h.stderr).toEqual([]);
    expect(h.server.requests).toHaveLength(0);
  });

  it('names the reason in the notification when some of several files are refused', async () => {
    const flagged = h.file('.env', 'A=1\n');
    const ok = h.file('ok.txt', 'fine');
    await expect(up([flagged, ok], { notify: true }, h.ctx)).rejects.toThrow(/1 of 2/);
    const failure = h.notifications.find((n) => n.subtitle === 'Upload failed')!;
    expect(failure.body).toMatch(/1 of 2 uploads failed/);
    expect(failure.body).toMatch(/^1 of 2 uploads failed\. \.env: Looks like it contains secrets/);
    expect(failure.body).toMatch(/--allow-secrets/);
  });

  it('keeps the plain summary without --notify (the per-file lines are already on stderr)', async () => {
    const err = (await up([h.file('.env', 'A=1\n'), h.file('ok.txt', 'x')], {}, h.ctx).catch(
      (e: unknown) => e,
    )) as CliError;
    expect(err.message).toBe('1 of 2 uploads failed.');
    expect(err.hint).toBeUndefined();
  });
});
