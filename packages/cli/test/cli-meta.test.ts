import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildInfo,
  compareVersions,
  detectInstall,
  formatVersion,
  gitCloneUrl,
  isCheckout,
  packageMeta,
  readStamp,
  updateSteps,
  versionLine,
  type PackageMeta,
} from '../../../src/cli-meta.ts';

const root = path.resolve(import.meta.dirname, '..', '..', '..');

describe('formatVersion (the --version line)', () => {
  const full = { version: '1.4.2', commit: 'a1b2c3d4e5f6', date: '2026-10-27' };

  it('prints the name, the version, the short commit and that commit date', () => {
    expect(formatVersion('fl', full)).toBe('fl 1.4.2 (a1b2c3d 2026-10-27)');
  });

  it('marks uncommitted builds and keeps the date', () => {
    expect(formatVersion('fl', { ...full, dirty: true })).toBe(
      'fl 1.4.2 (a1b2c3d-dirty 2026-10-27)',
    );
  });

  it('drops the date when only a commit is known, and the parentheses when neither is', () => {
    expect(formatVersion('fl', { version: '1.4.2', commit: 'a1b2c3d4e5f6' })).toBe(
      'fl 1.4.2 (a1b2c3d)',
    );
    expect(formatVersion('fl', { version: '1.4.2' })).toBe('fl 1.4.2');
  });

  it('versionLine uses an explicit build (a standalone binary) instead of package.json or git', () => {
    expect(versionLine('fl', full)).toBe('fl 1.4.2 (a1b2c3d 2026-10-27)');
  });
});

describe('packageMeta, in this checkout', () => {
  it('finds the published package (the repository root) and its checkout', () => {
    const meta = packageMeta();
    expect(meta.root).toBe(root);
    expect(meta.name).toBe('flashlink');
    expect(meta.isPrivate).toBe(false);
    expect(meta.checkout).toBe(root);
    expect(isCheckout(meta.root)).toBe(true);
  });

  it('reads git (not the stamp) for a run from source, so a stale build cannot hide commits', () => {
    const meta = packageMeta();
    const info = buildInfo(meta, path.join(meta.root, 'src'));
    const head = spawnSync('git', ['rev-parse', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).stdout.trim();
    expect(info.commit).toBe(head);
    expect(info.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(info.version).toBe(meta.version);
  });

  it('reads dist/build-info.json for an installed copy (no checkout)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-stamp-'));
    try {
      fs.mkdirSync(path.join(dir, 'dist'));
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'flashlink' }));
      fs.writeFileSync(
        path.join(dir, 'dist', 'build-info.json'),
        JSON.stringify({ version: '1.0.0', commit: 'b'.repeat(40), date: '2026-01-01' }),
      );
      expect(readStamp(dir)).toEqual({
        version: '1.0.0',
        commit: 'b'.repeat(40),
        date: '2026-01-01',
      });
      const meta = packageMeta(dir);
      expect(meta.checkout).toBeUndefined();
      expect(buildInfo(meta)).toMatchObject({ version: '1.0.0', commit: 'b'.repeat(40) });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('install methods', () => {
  it('recognizes a checkout, npx, mise, bun, pnpm and npm global installs', () => {
    expect(detectInstall('/src/flashlink', true)).toBe('checkout');
    expect(detectInstall('/home/x/.npm/_npx/abc/node_modules/flashlink', false)).toBe('npx');
    expect(detectInstall('/home/x/.local/share/mise/installs/npm-flashlink/0.0.3/lib', false)).toBe(
      'mise',
    );
    expect(detectInstall('/home/x/.bun/install/global/node_modules/flashlink', false)).toBe('bun');
    expect(detectInstall('/home/x/.local/share/pnpm/global/5/node_modules/flashlink', false)).toBe(
      'pnpm',
    );
    expect(detectInstall('/usr/lib/node_modules/flashlink', false, '/usr/lib/node_modules')).toBe(
      'npm',
    );
    expect(detectInstall('/opt/somewhere/flashlink', false)).toBe('unknown');
  });

  it('updates a clone by pulling and rebuilding it with the repository package manager', () => {
    const meta: PackageMeta = {
      root,
      name: 'flashlink',
      version: '1.0.0',
      isPrivate: false,
      checkout: root,
    };
    expect(updateSteps('checkout', meta)).toEqual([
      { cmd: 'git', args: ['pull', '--ff-only', 'origin', 'main'], cwd: root },
      { cmd: 'pnpm', args: ['install'], cwd: root },
      { cmd: 'pnpm', args: ['run', 'build'], cwd: root },
    ]);
  });

  it('reinstalls a registry install from npm, pnpm or bun, and says nothing for an unknown one', () => {
    const meta: PackageMeta = {
      root: '/usr/lib/node_modules/flashlink',
      name: 'flashlink',
      version: '1.0.0',
      isPrivate: false,
    };
    expect(updateSteps('npm', meta)).toEqual([
      { cmd: 'npm', args: ['install', '-g', 'flashlink@latest'] },
    ]);
    expect(updateSteps('pnpm', meta)).toEqual([
      { cmd: 'pnpm', args: ['add', '-g', 'flashlink@latest'] },
    ]);
    expect(updateSteps('bun', meta)).toEqual([
      { cmd: 'bun', args: ['add', '-g', 'flashlink@latest'] },
    ]);
    expect(updateSteps('mise', meta)).toEqual([
      { cmd: 'mise', args: ['upgrade', '--bump', 'npm:flashlink'] },
    ]);
    expect(updateSteps('unknown', meta)).toBeNull();
  });

  it('reinstalls an unpublished package from its repository, never by name', () => {
    const meta: PackageMeta = {
      root: '/usr/lib/node_modules/x',
      name: 'x',
      version: '1.0.0',
      isPrivate: true,
      repositoryUrl: 'github:someone/x',
    };
    expect(gitCloneUrl(meta.repositoryUrl!)).toBe('https://github.com/someone/x.git');
    expect(updateSteps('npm', meta)).toEqual([
      { cmd: 'npm', args: ['install', '-g', 'git+https://github.com/someone/x.git'] },
    ]);
  });
});

describe('compareVersions (registry latest vs installed)', () => {
  it('orders numeric parts, and sorts a prerelease before its release', () => {
    expect(compareVersions('1.2.3', '1.10.0')).toBeLessThan(0);
    expect(compareVersions('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0-alpha', '1.0.0')).toBeLessThan(0);
    expect(compareVersions('1.0.0', '1.0.0-rc.1')).toBeGreaterThan(0);
  });
});
