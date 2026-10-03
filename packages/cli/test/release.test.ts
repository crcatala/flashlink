import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };

const root = path.resolve(import.meta.dirname, '..', '..', '..');

describe('scripts/check-release-tag.mjs', () => {
  const check = (...args: string[]) =>
    spawnSync(process.execPath, [path.join(root, 'scripts', 'check-release-tag.mjs'), ...args], {
      encoding: 'utf8',
    });

  it('accepts the tag that matches the CLI version', () => {
    const r = check(`v${pkg.version}`);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('matches');
  });

  it('refuses a tag for another version, naming the right one', () => {
    const r = check('v99.0.0');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain(`must be v${pkg.version}`);
  });

  it('refuses a tag without the v prefix, or with a suffix', () => {
    expect(check(pkg.version).status).toBe(1);
    expect(check(`v${pkg.version}-rc.1`).status).toBe(1);
  });

  it('needs a tag argument', () => {
    expect(check().status).toBe(2);
  });
});

describe('npm package', () => {
  it('ships only dist (plus the README npm adds) and keeps the r2fl bin', () => {
    expect(pkg.files).toEqual(['dist']);
    expect(pkg.bin).toEqual({ r2fl: './dist/index.js' });
    expect(pkg.engines.node).toBe('>=22.12');
  });

  it('builds and tests before any publish, and publishes publicly with provenance', () => {
    expect(pkg.scripts.prepublishOnly).toBe('pnpm run build && pnpm run test');
    expect(pkg.publishConfig).toEqual({ access: 'public', provenance: true });
  });

  it('points at the repository, for the npm page and for provenance', () => {
    expect(pkg.repository.url).toBe('git+https://github.com/crcatala/r2-fastlink.git');
    expect(pkg.repository.directory).toBe('packages/cli');
  });
});

describe('scripts/package-release.sh', () => {
  const hasBun = spawnSync('bun', ['--version']).status === 0;
  const hasDeps = fs.existsSync(path.join(root, 'packages', 'cli', 'node_modules', 'commander'));

  it.skipIf(!hasBun || !hasDeps)(
    'produces both darwin binaries, the support archive, the scripts and matching checksums',
    () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'r2fl-release-'));
      try {
        const r = spawnSync('sh', [path.join(root, 'scripts', 'package-release.sh'), out], {
          encoding: 'utf8',
        });
        expect(r.status, r.stderr).toBe(0);
        const names = [
          'install.sh',
          'r2fl-darwin-arm64',
          'r2fl-darwin-x64',
          'r2fl-macos-support.tar.gz',
          'uninstall.sh',
        ];
        expect(fs.readdirSync(out).sort()).toEqual([...names, 'SHA256SUMS'].sort());

        // Every file is listed, with its real SHA-256 (what install.sh verifies).
        const sums = Object.fromEntries(
          fs
            .readFileSync(path.join(out, 'SHA256SUMS'), 'utf8')
            .trim()
            .split('\n')
            .map((line) => {
              const [hash, name] = line.split(/\s+/);
              return [name, hash];
            }),
        );
        expect(Object.keys(sums).sort()).toEqual(names);
        for (const name of names) {
          const actual = createHash('sha256')
            .update(fs.readFileSync(path.join(out, name)))
            .digest('hex');
          expect(sums[name], name).toBe(actual);
        }

        // The published installer is the checked-in one, and the archive holds the Quick Action.
        expect(fs.readFileSync(path.join(out, 'install.sh'), 'utf8')).toBe(
          fs.readFileSync(path.join(root, 'macos', 'install.sh'), 'utf8'),
        );
        const list = spawnSync('tar', ['-tzf', path.join(out, 'r2fl-macos-support.tar.gz')], {
          encoding: 'utf8',
        }).stdout;
        expect(list).toContain('macos/r2fl-quick.sh');
        expect(list).toContain('macos/Share via r2-fastlink.workflow/Contents/Info.plist');
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
