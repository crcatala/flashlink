#!/usr/bin/env node
// Release helpers. See RELEASING.md.
//
//   node scripts/release.mjs release [release-it args]   release-it, then publish to npm (`pnpm release`)
//   node scripts/release.mjs publish [--dry-run]         publish packages/cli to npm from this machine
//   node scripts/release.mjs sync-version <version>      copy the version into packages/cli (release-it hook)
//   node scripts/release.mjs notes <version|tag>         print that version's CHANGELOG section (the release notes)
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { changelogSection, publishProblems, setPackageVersion } from './release-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = path.join(root, 'packages', 'cli');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

function out(cmd, args, opts = {}) {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      ...opts,
    }).trim();
  } catch {
    return null;
  }
}

function publish(dryRun) {
  const cliVersion = JSON.parse(read('packages', 'cli', 'package.json')).version;
  const tag = `v${cliVersion}`;
  const remoteTag = out('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`]);
  const state = {
    cliVersion,
    rootVersion: JSON.parse(read('package.json')).version,
    branch: out('git', ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?',
    clean: out('git', ['status', '--porcelain', '--untracked-files=no']) === '',
    tagsAtHead: (out('git', ['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean),
    tagOnRemote: remoteTag === null ? null : remoteTag !== '',
    // `npm view` exits 1 with E404 for an unpublished version; anything else (network) is "unknown".
    publishedOnNpm: (() => {
      const r = spawnSync('npm', ['view', `r2fl@${cliVersion}`, 'version'], { encoding: 'utf8' });
      if (r.status === 0) return r.stdout.trim() === cliVersion;
      return /E404/.test(r.stderr) ? false : null;
    })(),
    npmUser: out('npm', ['whoami']),
    dryRun,
  };
  const problems = publishProblems(state);
  if (problems.length > 0) {
    fail(`Not publishing r2fl ${cliVersion}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
  }
  console.error(
    `Publishing r2fl ${cliVersion} to npm as ${state.npmUser}${dryRun ? ' (dry run)' : ''}...`,
  );
  // Inherit stdio: npm asks for your one-time password here, if your account uses 2FA for publishing.
  const r = spawnSync('npm', ['publish', '--access', 'public', ...(dryRun ? ['--dry-run'] : [])], {
    cwd: cliDir,
    stdio: 'inherit',
  });
  if (r.status !== 0)
    fail('npm publish failed. Fix the cause and run `pnpm release:publish` again.');
  if (!dryRun) console.error(`Published. Check: npm view r2fl@${cliVersion}`);
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'release': {
    const r = spawnSync('pnpm', ['exec', 'release-it', ...rest], { cwd: root, stdio: 'inherit' });
    if (r.status !== 0) process.exit(r.status ?? 1);
    // A dry run or a help request has nothing to publish.
    if (rest.some((a) => a === '--dry-run' || a === '-d' || a === '--help' || a === '-h')) break;
    publish(false);
    break;
  }
  case 'publish':
    publish(rest.includes('--dry-run'));
    break;
  case 'sync-version': {
    const version = rest[0];
    if (!version) fail('usage: release.mjs sync-version <version>');
    const file = path.join(cliDir, 'package.json');
    fs.writeFileSync(file, setPackageVersion(fs.readFileSync(file, 'utf8'), version));
    console.log(`packages/cli/package.json -> ${version}`);
    break;
  }
  case 'notes': {
    const version = rest[0];
    if (!version) fail('usage: release.mjs notes <version|tag>');
    const section = changelogSection(read('CHANGELOG.md'), version);
    if (!section) fail(`CHANGELOG.md has no entries under "## [${version.replace(/^v/, '')}]".`);
    console.log(section);
    break;
  }
  default:
    fail('usage: release.mjs release|publish|sync-version|notes (see RELEASING.md)');
}
