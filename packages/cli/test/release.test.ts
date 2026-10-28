import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import {
  changelogSection,
  gitState,
  isReleaseVersion,
  parseRemoteTagCommit,
  publishProblems,
  releaseProblems,
  setPackageVersion,
  type PublishState,
} from '../../../scripts/release-lib.mjs';

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
    // It must not send people to the old by-hand flow.
    expect(r.stderr).toContain('pnpm release');
    expect(r.stderr).not.toContain('Bump the version in a commit');
  });

  it('refuses a tag without the v prefix, or with a suffix', () => {
    expect(check(pkg.version).status).toBe(1);
    expect(check(`v${pkg.version}-rc.1`).status).toBe(1);
  });

  it('needs a tag argument', () => {
    expect(check().status).toBe(2);
  });
});

/** The published npm package is the repository root; packages/cli is the build package inside it. */
const npmPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as {
  name: string;
  files: string[];
  bin: Record<string, string>;
  engines: { node: string };
  scripts: Record<string, string>;
  publishConfig: Record<string, unknown>;
  repository: { url: string };
  dependencies: Record<string, string>;
};

describe('npm package', () => {
  it('is published from the repository root as flashlink, with the fl and flashlink bins', () => {
    expect(npmPkg.name).toBe('flashlink');
    expect(npmPkg.bin).toEqual({
      fl: './packages/cli/dist/index.js',
      flashlink: './packages/cli/dist/index.js',
    });
    expect(npmPkg.engines.node).toBe('>=22.12');
    expect(npmPkg.dependencies).toEqual({ commander: '^15.0.0', mime: '^4.1.0' });
  });

  it('ships only the built CLI, its build stamp and the LICENSE (never dist/bin or dist/release)', () => {
    expect(npmPkg.files).toEqual([
      'dist/build-info.json',
      'packages/cli/dist',
      'README.md',
      'LICENSE',
    ]);
  });

  it('checks and builds before any publish, and publishes publicly (from a maintainer machine, so no provenance)', () => {
    expect(npmPkg.scripts.prepublishOnly).toBe(
      'node scripts/release-local.mjs publish-check && pnpm run verify',
    );
    expect(npmPkg.scripts.prepack).toBe('pnpm run build');
    expect(npmPkg.publishConfig).toEqual({ access: 'public' });
  });

  it('points at the repository, for the npm page', () => {
    expect(npmPkg.repository.url).toBe('git+https://github.com/crcatala/flashlink.git');
  });

  it('keeps the CLI package private: only the root package is published', () => {
    const cliPkg = JSON.parse(
      fs.readFileSync(path.join(root, 'packages', 'cli', 'package.json'), 'utf8'),
    ) as { name: string; private?: boolean };
    expect(cliPkg.name).toBe('@flashlink/cli');
    expect(cliPkg.private).toBe(true);
  });
});

describe('release tooling', () => {
  const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');
  const rootPkg = JSON.parse(read('package.json')) as {
    version: string;
    scripts: Record<string, string>;
  };

  it('keeps one version: the root package.json and the CLI agree', () => {
    expect(rootPkg.version).toBe(pkg.version);
  });

  it('check-release-tag also refuses when the root and the CLI versions differ', () => {
    // Run the script against a copy of the repo layout with a mismatched root version.
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-tag-'));
    try {
      fs.mkdirSync(path.join(dir, 'scripts'));
      fs.mkdirSync(path.join(dir, 'packages', 'cli'), { recursive: true });
      fs.copyFileSync(
        path.join(root, 'scripts', 'check-release-tag.mjs'),
        path.join(dir, 'scripts', 'check-release-tag.mjs'),
      );
      fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ version: '1.0.0' }));
      fs.writeFileSync(
        path.join(dir, 'packages', 'cli', 'package.json'),
        JSON.stringify({ version: '1.0.1' }),
      );
      const r = spawnSync(
        process.execPath,
        [path.join(dir, 'scripts', 'check-release-tag.mjs'), 'v1.0.1'],
        {
          encoding: 'utf8',
        },
      );
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('root package.json is 1.0.0');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('release-it never publishes to npm or creates the GitHub Release itself', () => {
    const config = JSON.parse(read('.release-it.json')) as {
      npm: { publish: boolean };
      github: { release: boolean };
      git: { requireBranch: string; tagName: string };
      hooks: Record<string, string[]>;
    };
    expect(config.npm.publish).toBe(false);
    expect(config.github.release).toBe(false);
    expect(config.git).toMatchObject({ requireBranch: 'main', tagName: 'v${version}' });
    // The smoke test runs after the bump, so it packs the version being released.
    expect(config.hooks['after:bump']).toEqual([
      'node scripts/release-local.mjs sync-version ${version}',
      'pnpm run test:package',
    ]);
    expect(config.hooks['before:init']).toContain('pnpm run verify');
    expect(config.hooks['before:init']).toContain('bash scripts/check-changelog.sh');
    // The project preflight (npm login, one version, no half-finished release) runs first.
    expect(config.hooks['before:init']![0]).toBe('node scripts/release-local.mjs preflight');
    expect(config.hooks['before:bump']).toEqual([
      'node scripts/release-local.mjs check-version ${version}',
    ]);
  });

  it('wires the maintainer commands', () => {
    expect(rootPkg.scripts).toMatchObject({
      release: 'node scripts/release.mjs release',
      'release:dry': 'node scripts/release.mjs release --dry-run',
      'release:publish': 'node scripts/release.mjs publish',
      'release:prep': 'bash scripts/prep-release.sh',
      'test:package': 'bash scripts/test-package.sh',
    });
    expect(rootPkg.scripts.verify).toBe(
      'pnpm format:check && pnpm typecheck && pnpm test && pnpm build',
    );
    // The build stamps dist/build-info.json, which the published tarball ships.
    expect(rootPkg.scripts.build).toContain('node scripts/build-info.mjs');
  });

  it('marks the canonical release scripts and keeps prettier from rewriting them', () => {
    // These are byte-identical copies from the shared release standard (see RELEASING.md): the
    // audit compares them, so `pnpm format:check` must not reformat them.
    for (const file of [
      'scripts/release.mjs',
      'scripts/build-info.mjs',
      'scripts/test-package.sh',
      'scripts/prep-release.sh',
      'scripts/check-changelog.sh',
    ]) {
      expect(read(file).split('\n').slice(0, 3).join('\n')).toContain(`release-standard: ${file}`);
      expect(read('.prettierignore')).toMatch(new RegExp(`^${file.replace('.', '\\.')}$`, 'm'));
    }
  });

  it('CI creates the GitHub Release from the changelog and has no npm publishing', () => {
    const workflow = read('.github', 'workflows', 'release.yml');
    expect(workflow).toContain('node scripts/release-local.mjs notes "$GITHUB_REF_NAME"');
    expect(workflow).toContain('--notes-file');
    expect(workflow).not.toMatch(/npm publish|NPM_TOKEN|id-token|provenance/);
  });

  describe('scripts/check-changelog.sh and prep-release.sh', () => {
    const sh = (script: string, cwd: string, ...args: string[]) =>
      spawnSync('bash', [path.join(root, 'scripts', script), ...args], { cwd, encoding: 'utf8' });
    const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-rel-'));

    it('check-changelog accepts an Unreleased section with an item', () => {
      const dir = tmp();
      try {
        fs.writeFileSync(
          path.join(dir, 'CHANGELOG.md'),
          '# C\n\n## [Unreleased]\n\n### Fixed\n\n- Something.\n\n## [0.1.0]\n\n### Added\n\n- Old.\n',
        );
        expect(sh('check-changelog.sh', dir).status).toBe(0);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('check-changelog refuses an empty Unreleased section even when older releases have items', () => {
      const dir = tmp();
      try {
        fs.writeFileSync(
          path.join(dir, 'CHANGELOG.md'),
          '# C\n\n## [Unreleased]\n\n## [0.1.0]\n\n### Added\n\n- Old.\n',
        );
        const r = sh('check-changelog.sh', dir);
        expect(r.status).toBe(1);
        expect(r.stderr).toContain('no unreleased user-facing entries');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });

    it('prep-release lists the commits since the last tag with the prompt, without Co-Authored-By', () => {
      const dir = tmp();
      const git = (...a: string[]) =>
        spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...a], {
          cwd: dir,
          encoding: 'utf8',
        });
      try {
        git('init', '-q');
        fs.writeFileSync(path.join(dir, 'a.txt'), '1');
        git('add', '.');
        git('commit', '-q', '-m', 'feat: old thing');
        git('tag', 'v0.1.0');
        fs.writeFileSync(path.join(dir, 'a.txt'), '2');
        git(
          'commit',
          '-q',
          '-am',
          'fix(cli): new thing\n\nBody text.\n\nCo-Authored-By: Someone <s@example.com>',
        );
        const r = sh('prep-release.sh', dir);
        expect(r.status).toBe(0);
        expect(r.stdout).toContain('Changes since: v0.1.0');
        expect(r.stdout).toContain('Changelog prompt');
        expect(r.stdout).toContain('fix(cli): new thing');
        expect(r.stdout).toContain('Body text.');
        expect(r.stdout).not.toContain('feat: old thing');
        expect(r.stdout).not.toMatch(/Co-Authored-By/i);
        expect(sh('prep-release.sh', dir, 'nope').status).toBe(1);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  describe('release versions (plain X.Y.Z only, like the CI tag check)', () => {
    it('accepts X.Y.Z and refuses prereleases, builds and v-prefixes', () => {
      expect(isReleaseVersion('0.1.0')).toBe(true);
      expect(isReleaseVersion('10.20.30')).toBe(true);
      for (const bad of ['0.1.0-rc.1', '0.1.0+build', 'v0.1.0', '0.1', '']) {
        expect(isReleaseVersion(bad), bad).toBe(false);
      }
    });

    const run = (...args: string[]) =>
      spawnSync(process.execPath, [path.join(root, 'scripts', 'release-local.mjs'), ...args], {
        encoding: 'utf8',
      });
    it('`release-local.mjs check-version` (the release-it before:bump hook) refuses a prerelease before anything is changed', () => {
      expect(run('check-version', '0.2.0').status).toBe(0);
      const r = run('check-version', '0.2.0-rc.1');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('prereleases are not supported');
      expect(run('check-version').status).toBe(1);
    });

    it('release-it runs that check before it bumps anything', () => {
      const config = JSON.parse(read('.release-it.json')) as { hooks: Record<string, string[]> };
      expect(config.hooks['before:bump']).toEqual([
        'node scripts/release-local.mjs check-version ${version}',
      ]);
    });
  });

  describe('setPackageVersion', () => {
    const text = '{\n  "name": "x",\n  "version": "0.0.0",\n  "private": true\n}\n';
    it('changes only the version, keeping the formatting', () => {
      expect(setPackageVersion(text, '0.1.0')).toBe(text.replace('0.0.0', '0.1.0'));
    });
    it('rejects a bad version, a prerelease and a file without one', () => {
      expect(() => setPackageVersion(text, 'v1')).toThrow(/not a release version/);
      expect(() => setPackageVersion(text, '0.2.0-rc.1')).toThrow(/prereleases are not supported/);
      expect(() => setPackageVersion('{}', '1.0.0')).toThrow(/no "version"/);
    });
  });

  describe('changelogSection', () => {
    const md = [
      '# Changelog',
      '',
      '## [Unreleased]',
      '',
      '## [0.2.0] - 2026-11-01',
      '',
      '### Fixed',
      '',
      '- A thing.',
      '',
      '## [0.1.0] - 2026-10-04',
      '',
      '### Added',
      '',
      '- First.',
      '',
      '[Unreleased]: https://github.com/x/y/compare/v0.2.0...HEAD',
      '[0.2.0]: https://github.com/x/y/compare/v0.1.0...v0.2.0',
      '[0.1.0]: https://github.com/x/y/releases/tag/v0.1.0',
      '',
    ].join('\n');
    it('returns the body for a version or a tag, without the heading or link references', () => {
      expect(changelogSection(md, '0.2.0')).toBe('### Fixed\n\n- A thing.');
      expect(changelogSection(md, 'v0.1.0')).toBe('### Added\n\n- First.');
    });
    it('returns null for a missing or empty section', () => {
      expect(changelogSection(md, '0.3.0')).toBeNull();
      expect(changelogSection(md, 'Unreleased')).toBeNull();
      expect(changelogSection(md, '0.1')).toBeNull();
    });
  });

  describe('the remote tag (a real repository with a local bare origin)', () => {
    const sh = (cwd: string, ...args: string[]) => {
      const r = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.com', ...args], {
        cwd,
        encoding: 'utf8',
      });
      if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`);
      return r.stdout.trim();
    };
    function setup() {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-remote-'));
      const origin = path.join(dir, 'origin.git');
      const work = path.join(dir, 'work');
      fs.mkdirSync(work);
      sh(dir, 'init', '-q', '--bare', origin);
      sh(work, 'init', '-q', '-b', 'main');
      sh(work, 'remote', 'add', 'origin', origin);
      fs.writeFileSync(path.join(work, 'a.txt'), '1');
      sh(work, 'add', '.');
      sh(work, 'commit', '-q', '-m', 'one');
      return { dir, work };
    }

    it('parses ls-remote output: the peeled commit of an annotated tag, or the plain one', () => {
      const out = `${'1'.repeat(40)}\trefs/tags/v1.0.0\n${'2'.repeat(40)}\trefs/tags/v1.0.0^{}\n`;
      expect(parseRemoteTagCommit(out, 'v1.0.0')).toBe('2'.repeat(40));
      expect(parseRemoteTagCommit(`${'3'.repeat(40)}\trefs/tags/v1.0.0\n`, 'v1.0.0')).toBe(
        '3'.repeat(40),
      );
      expect(parseRemoteTagCommit(`${'3'.repeat(40)}\trefs/tags/v1.0.01\n`, 'v1.0.0')).toBeNull();
      expect(parseRemoteTagCommit('', 'v1.0.0')).toBeNull();
    });

    it('sees an annotated tag pushed from HEAD as the same commit, and a moved local tag as different code', () => {
      const { dir, work } = setup();
      try {
        // release-it style: annotated tag on the release commit, pushed with the branch.
        sh(work, 'tag', '-a', 'v0.1.0', '-m', 'Release 0.1.0');
        sh(work, 'push', '-q', '--follow-tags', 'origin', 'main');
        const head = sh(work, 'rev-parse', 'HEAD');
        let state = gitState(work, 'v0.1.0');
        expect(state).toMatchObject({
          branch: 'main',
          clean: true,
          headCommit: head,
          remoteTagCommit: head,
        });
        expect(state.tagsAtHead).toContain('v0.1.0');
        const base = {
          cliVersion: '0.1.0',
          rootVersion: '0.1.0',
          publishedOnNpm: false,
          npmUser: 'me',
          dryRun: false,
        };
        expect(publishProblems({ ...base, ...state })).toEqual([]);

        // Re-release locally: a new commit and the same tag name moved onto it, not pushed.
        fs.writeFileSync(path.join(work, 'a.txt'), '2');
        sh(work, 'commit', '-q', '-am', 'two');
        sh(work, 'tag', '-f', '-a', 'v0.1.0', '-m', 'Release 0.1.0 again');
        state = gitState(work, 'v0.1.0');
        expect(state.remoteTagCommit).toBe(head);
        expect(state.headCommit).not.toBe(head);
        expect(publishProblems({ ...base, ...state }).join('\n')).toMatch(/different code/);
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000); // real git processes: slower than the 5 s default on some machines

    it('reports a tag that is not on origin, and an origin that cannot be asked', () => {
      const { dir, work } = setup();
      try {
        sh(work, 'tag', '-a', 'v0.1.0', '-m', 'Release 0.1.0');
        sh(work, 'push', '-q', 'origin', 'main');
        expect(gitState(work, 'v0.1.0').remoteTagCommit).toBeNull();
        sh(work, 'remote', 'set-url', 'origin', path.join(dir, 'missing.git'));
        expect(gitState(work, 'v0.1.0').remoteTagCommit).toBeUndefined();
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    }, 30_000); // real git processes: slower than the 5 s default on some machines
  });

  describe('releaseProblems (before release-it changes anything)', () => {
    const ok = { cliVersion: '0.1.0', tagsAtHead: [], npmUser: 'someone' };
    it('has nothing to say when logged in and HEAD is not a release yet', () => {
      expect(releaseProblems(ok)).toEqual([]);
      expect(releaseProblems({ ...ok, tagsAtHead: ['v0.0.9'] })).toEqual([]);
    });
    it('refuses without an npm login, since the publish only runs after the tag is pushed', () => {
      expect(releaseProblems({ ...ok, npmUser: null }).join('\n')).toMatch(/npm login/);
    });
    it('points a rerun after a half-finished release at `pnpm release:publish`', () => {
      const problems = releaseProblems({ ...ok, tagsAtHead: ['v0.1.0'], npmUser: null });
      expect(problems).toHaveLength(1);
      expect(problems[0]).toMatch(/already the v0\.1\.0 release.*pnpm release:publish/);
    });
  });

  describe('publishProblems', () => {
    const ok: PublishState = {
      cliVersion: '0.1.0',
      rootVersion: '0.1.0',
      branch: 'main',
      clean: true,
      tagsAtHead: ['v0.1.0'],
      headCommit: 'a'.repeat(40),
      remoteTagCommit: 'a'.repeat(40),
      publishedOnNpm: false,
      npmUser: 'someone',
      dryRun: false,
    };
    it('has nothing to say when everything is in order', () => {
      expect(publishProblems(ok)).toEqual([]);
    });
    it.each([
      ['a version mismatch', { rootVersion: '0.2.0' }, /must match/],
      ['another branch', { branch: 'feature' }, /not main/],
      ['a dirty tree', { clean: false }, /uncommitted/],
      ['an untagged HEAD', { tagsAtHead: [] }, /not tagged v0\.1\.0/],
      ['a tag for another version', { tagsAtHead: ['v0.0.9'] }, /not tagged v0\.1\.0/],
      ['an unpushed tag', { remoteTagCommit: null }, /not on origin/],
      ['an unreachable origin', { remoteTagCommit: undefined }, /Could not ask origin/],
      [
        'a tag on origin that points to another commit',
        { remoteTagCommit: 'b'.repeat(40) },
        /bbbbbbbbbb, but HEAD is aaaaaaaaaa.*different code/,
      ],
      [
        'a prerelease version',
        {
          cliVersion: '0.2.0-rc.1',
          rootVersion: '0.2.0-rc.1',
          tagsAtHead: ['v0.2.0-rc.1'],
          remoteTagCommit: 'a'.repeat(40),
        },
        /not a release version/,
      ],
      ['an already published version', { publishedOnNpm: true }, /already on npm/],
      ['an unknown npm state', { publishedOnNpm: null }, /Could not check/],
      ['no npm login', { npmUser: null }, /not logged in/],
      [
        'a non-release version',
        { cliVersion: 'x', rootVersion: 'x', tagsAtHead: ['vx'] },
        /not a release version/,
      ],
    ])('refuses %s', (_label, patch, message) => {
      expect(publishProblems({ ...ok, ...patch }).join('\n')).toMatch(message);
    });
    it('a dry run does not need the tag on origin', () => {
      expect(publishProblems({ ...ok, remoteTagCommit: null, dryRun: true })).toEqual([]);
      expect(publishProblems({ ...ok, remoteTagCommit: 'b'.repeat(40), dryRun: true })).toEqual([]);
    });
  });
});

describe('license', () => {
  const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');

  it('is MIT in the root and every package.json', () => {
    for (const dir of ['.', 'packages/core', 'packages/worker', 'packages/cli']) {
      const manifest = JSON.parse(read(dir, 'package.json')) as { license?: string };
      expect(manifest.license, dir).toBe('MIT');
    }
  });

  it('has a LICENSE file naming the holder and year, and the npm package ships it', () => {
    const license = read('LICENSE');
    expect(license).toMatch(/^MIT License\n\nCopyright \(c\) 2026 Christian Catalan\n/);
    // The published package is the repository root, so its LICENSE is the one npm packs.
    expect(npmPkg.files).toContain('LICENSE');
  });
});

describe('scripts/package-release.sh', () => {
  const hasBun = spawnSync('bun', ['--version']).status === 0;
  const hasDeps = fs.existsSync(path.join(root, 'packages', 'cli', 'node_modules', 'commander'));

  it.skipIf(!hasBun || !hasDeps)(
    'produces both darwin binaries, the support archive, the scripts and matching checksums',
    () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'flashlink-release-'));
      try {
        const r = spawnSync('sh', [path.join(root, 'scripts', 'package-release.sh'), out], {
          encoding: 'utf8',
        });
        expect(r.status, r.stderr).toBe(0);
        const names = [
          'install.sh',
          'flashlink-darwin-arm64',
          'flashlink-darwin-x64',
          'flashlink-macos-support.tar.gz',
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
        expect(Object.keys(sums).sort()).toEqual([...names].sort());
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
        const list = spawnSync('tar', ['-tzf', path.join(out, 'flashlink-macos-support.tar.gz')], {
          encoding: 'utf8',
        }).stdout;
        expect(list).toContain('macos/fl-quick.sh');
        expect(list).not.toContain('qa.sh'); // maintainer-only
        expect(list).toContain('macos/Share via flashlink.workflow/Contents/Info.plist');
      } finally {
        fs.rmSync(out, { recursive: true, force: true });
      }
    },
    60_000,
  );
});
