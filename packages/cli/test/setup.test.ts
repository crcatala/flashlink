import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  LIFECYCLE_RULE,
  SetupError,
  findWorkerUrl,
  hasLifecycleRule,
  isAuthenticated,
  parseSecretNames,
  parseSetupArgs,
  parseWranglerNames,
  runSetup,
  summary,
  type SetupIo,
  type SetupOptions,
  type WranglerResult,
} from '../../../scripts/setup-lib.mjs';

const root = path.resolve(import.meta.dirname, '..', '..', '..');
const TOKEN = 'a'.repeat(32) + 'b'.repeat(32);
const URL = 'https://flashlink.someone.workers.dev';
const opts = (o: Partial<SetupOptions> = {}): SetupOptions => ({
  dryRun: false,
  rotateToken: false,
  help: false,
  ...o,
});

/** A fake account: tracks what exists and records every wrangler call. */
function fakeAccount(
  start: {
    loggedIn?: boolean;
    bucket?: boolean;
    secrets?: string[];
    rule?: boolean;
    secretListOutput?: string;
  } = {},
) {
  const state = {
    loggedIn: start.loggedIn ?? true,
    bucket: start.bucket ?? false,
    secrets: [...(start.secrets ?? [])],
    rule: start.rule ?? false,
    deploys: 0,
  };
  const calls: { args: string[]; input?: string }[] = [];
  const logs: string[] = [];
  const errs: string[] = [];
  const out = (stdout: string, code = 0): WranglerResult => ({ code, stdout });
  const io: SetupIo = {
    readWranglerConfig: () =>
      fs.readFileSync(path.join(root, 'packages', 'worker', 'wrangler.jsonc'), 'utf8'),
    randomToken: () => TOKEN,
    log: (l) => logs.push(l),
    err: (l) => errs.push(l),
    async wrangler(args, o) {
      calls.push({ args, input: o.input });
      const cmd = args.slice(0, 3).join(' ');
      if (args[0] === 'whoami')
        return out(
          state.loggedIn ? 'Account: x' : 'You are not authenticated. Please run `wrangler login`.',
        );
      if (cmd === 'r2 bucket info') return out('{}', state.bucket ? 0 : 1);
      if (cmd === 'r2 bucket create') {
        state.bucket = true;
        return out('Created');
      }
      if (args[0] === 'deploy') {
        state.deploys++;
        return out(`Uploaded flashlink\nDeployed flashlink triggers\n  ${URL}\n`);
      }
      if (args[0] === 'secret' && args[1] === 'list')
        return out(
          start.secretListOutput ??
            JSON.stringify(state.secrets.map((name) => ({ name, type: 'secret_text' }))),
        );
      if (args[0] === 'secret' && args[1] === 'put') {
        state.secrets.push(args[2]!);
        return out('Success');
      }
      if (cmd === 'r2 bucket lifecycle' && args[3] === 'list')
        return out(
          state.rule
            ? `Listing lifecycle rules for bucket 'flashlink'...\nname:  ${LIFECYCLE_RULE}\nprefix: objects/`
            : "Listing lifecycle rules for bucket 'flashlink'...\nThere are no lifecycle rules for bucket 'flashlink'.",
        );
      if (cmd === 'r2 bucket lifecycle' && args[3] === 'add') {
        state.rule = true;
        return out('Added');
      }
      throw new Error(`unexpected wrangler call: ${args.join(' ')}`);
    },
  };
  return { io, state, calls, logs, errs };
}

describe('setup: pure helpers', () => {
  it('parses options and rejects unknown ones', () => {
    expect(parseSetupArgs([]).opts).toEqual({ dryRun: false, rotateToken: false, help: false });
    expect(parseSetupArgs(['--dry-run', '--rotate-token']).opts).toMatchObject({
      dryRun: true,
      rotateToken: true,
    });
    expect(parseSetupArgs(['-h']).opts.help).toBe(true);
    expect(() => parseSetupArgs(['--token', 'x'])).toThrow(SetupError);
  });

  it('reads the Worker and bucket names from the real wrangler.jsonc, ignoring comments', () => {
    const real = fs.readFileSync(path.join(root, 'packages', 'worker', 'wrangler.jsonc'), 'utf8');
    expect(parseWranglerNames(real)).toEqual({ worker: 'flashlink', bucket: 'flashlink' });
    expect(
      parseWranglerNames(
        '{\n// "name": "wrong",\n"name": "w", "r2_buckets": [{"bucket_name": "b"}]}',
      ),
    ).toEqual({ worker: 'w', bucket: 'b' });
    expect(() => parseWranglerNames('{}')).toThrow(SetupError);
  });

  it('recognises a logged-out wrangler (real message) and a logged-in one', () => {
    expect(isAuthenticated('You are not authenticated. Please run `wrangler login`.')).toBe(false);
    expect(
      isAuthenticated('Getting User settings...\n👋 You are logged in with an OAuth Token'),
    ).toBe(true);
  });

  it('reads secret names from wrangler JSON, and returns null for anything else', () => {
    expect(parseSecretNames('[{"name":"FLASHLINK_TOKEN","type":"secret_text"}]')).toEqual([
      'FLASHLINK_TOKEN',
    ]);
    expect(parseSecretNames('banner\n[]\n')).toEqual([]);
    expect(parseSecretNames('Error: boom')).toBeNull();
    expect(parseSecretNames('[not json]')).toBeNull();
  });

  it('finds the lifecycle rule by name and not in the "Listing ..." line', () => {
    expect(hasLifecycleRule(`name:  ${LIFECYCLE_RULE}\nprefix: objects/`)).toBe(true);
    expect(
      hasLifecycleRule(`Listing lifecycle rules for bucket '${LIFECYCLE_RULE}'...\nnone`),
    ).toBe(false);
    expect(hasLifecycleRule('name:  expire-strays-old')).toBe(false);
  });

  it('finds the workers.dev URL in deploy output', () => {
    expect(findWorkerUrl(`Deployed\n  ${URL}\nVersion ID: 1`, 'flashlink')).toBe(URL);
    expect(findWorkerUrl('no url here', 'flashlink')).toBeNull();
  });

  it('prints the token only when one was generated, and says when it was kept', () => {
    expect(summary({ url: URL, token: TOKEN, keptToken: false })).toContain(TOKEN);
    const kept = summary({ url: URL, token: null, keptToken: true });
    expect(kept).not.toContain(TOKEN);
    expect(kept).toContain('unchanged');
    expect(kept).toContain(`fl init --endpoint ${URL}`);
    // The init command never carries the token (shell history, process list).
    expect(summary({ url: URL, token: TOKEN, keptToken: false })).not.toMatch(/--token/);
  });
});

describe('runSetup', () => {
  it('does everything on a fresh account, in an order that works (deploy before secret)', async () => {
    const acct = fakeAccount();
    const result = await runSetup(opts(), acct.io);
    expect(acct.state).toMatchObject({
      bucket: true,
      rule: true,
      secrets: ['FLASHLINK_TOKEN'],
      deploys: 1,
    });
    expect(result).toMatchObject({ url: URL, token: TOKEN });
    const order = acct.calls.map((c) => c.args.slice(0, 3).join(' '));
    expect(order.indexOf('deploy')).toBeLessThan(order.indexOf('secret put FLASHLINK_TOKEN'));
    expect(acct.logs.join('\n')).toContain(`fl init --endpoint ${URL}`);
  });

  it('never puts the token in an argument or anywhere but stdin and the final summary', async () => {
    const acct = fakeAccount();
    await runSetup(opts(), acct.io);
    for (const call of acct.calls) {
      expect(call.args.join(' ')).not.toContain(TOKEN);
    }
    const put = acct.calls.find((c) => c.args[0] === 'secret' && c.args[1] === 'put');
    expect(put?.input).toBe(`${TOKEN}\n`);
    expect(acct.errs.join('\n')).not.toContain(TOKEN);
    expect(acct.logs.filter((l) => l.includes(TOKEN))).toHaveLength(1);
  });

  it('is idempotent: a second run reuses everything, keeps the token and prints none', async () => {
    const acct = fakeAccount();
    await runSetup(opts(), acct.io);
    acct.calls.length = 0;
    acct.logs.length = 0;
    const second = await runSetup(opts(), acct.io);
    const names = acct.calls.map((c) => c.args.slice(0, 3).join(' '));
    expect(names).not.toContain('r2 bucket create');
    expect(names).not.toContain('secret put FLASHLINK_TOKEN');
    expect(names.some((n) => n === 'r2 bucket lifecycle')).toBe(true);
    expect(acct.calls.some((c) => c.args[3] === 'add')).toBe(false);
    expect(second.token).toBeNull();
    expect(acct.logs.join('\n')).not.toContain(TOKEN);
    expect(acct.logs.join('\n')).toContain('unchanged');
    expect(acct.state.secrets).toEqual(['FLASHLINK_TOKEN']);
  });

  it('--rotate-token replaces an existing secret and shows the new token', async () => {
    const acct = fakeAccount({ bucket: true, rule: true, secrets: ['FLASHLINK_TOKEN'] });
    const result = await runSetup(opts({ rotateToken: true }), acct.io);
    expect(result.token).toBe(TOKEN);
    expect(acct.calls.some((c) => c.args[1] === 'put')).toBe(true);
  });

  it('stops before changing anything when not logged in', async () => {
    const acct = fakeAccount({ loggedIn: false });
    await expect(runSetup(opts(), acct.io)).rejects.toThrow(/not logged in/);
    expect(acct.calls.map((c) => c.args[0])).toEqual(['whoami']);
  });

  it('never replaces a token it could not read: an unreadable secret list stops setup', async () => {
    const acct = fakeAccount({
      bucket: true,
      secrets: ['FLASHLINK_TOKEN'],
      secretListOutput: 'Error: boom',
    });
    await expect(runSetup(opts(), acct.io)).rejects.toThrow(/secret list/);
    expect(acct.calls.some((c) => c.args[1] === 'put')).toBe(false);
  });

  it('--dry-run makes no wrangler call at all', async () => {
    const acct = fakeAccount();
    const result = await runSetup(opts({ dryRun: true }), acct.io);
    expect(result).toEqual({ dryRun: true });
    expect(acct.calls).toEqual([]);
    expect(acct.logs.join('\n')).toContain('lifecycle rule');
  });
});

describe('scripts/setup.mjs', () => {
  const run = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', 'setup.mjs'), ...args], {
      encoding: 'utf8',
    });

  it('--help and --dry-run work without an account or network', () => {
    expect(run('--help').stdout).toContain('Usage: pnpm setup:cloudflare');
    const dry = run('--dry-run');
    expect(dry.status).toBe(0);
    expect(dry.stdout).toContain('Dry run');
  });

  it('rejects unknown options with exit 1', () => {
    const r = run('--nope');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('Unknown option');
  });

  it('is wired up as `pnpm setup:cloudflare` (not the built-in `pnpm setup`)', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['setup:cloudflare']).toBe('node scripts/setup.mjs');
    expect(pkg.scripts.setup).toBeUndefined();
  });
});
