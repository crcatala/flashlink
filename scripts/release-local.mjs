#!/usr/bin/env node
// Project-specific release steps for this monorepo. The standard machinery is in the canonical
// scripts/release.mjs (preflight, release-it, publish after the tag); this file only holds what is
// specific to flashlink: one version across the published root package and packages/cli, plain
// X.Y.Z only, and the CHANGELOG section CI uses as the GitHub Release notes. See RELEASING.md.
//
//   node scripts/release-local.mjs preflight              release-it before:init hook: an npm login and
//                                                         no half-finished release
//   node scripts/release-local.mjs check-version <version> release-it before:bump hook: plain X.Y.Z only,
//                                                         refused before anything is changed
//   node scripts/release-local.mjs sync-version <version>  release-it after:bump hook: copy the version
//                                                         into packages/cli (the standalone binaries)
//   node scripts/release-local.mjs notes <version|tag>    print that version's CHANGELOG section
//   node scripts/release-local.mjs publish-check          root prepublishOnly: publish only the tagged,
//                                                         synced, not-yet-published commit
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  changelogSection,
  gitState,
  isReleaseVersion,
  publishProblems,
  releaseProblems,
  setPackageVersion,
} from './release-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliDir = path.join(root, 'packages', 'cli');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const readJson = (...p) => JSON.parse(read(...p));
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

function out(cmd, args) {
  try {
    return execFileSync(cmd, args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

// `npm view` exits 1 with E404 for an unpublished version; anything else (network) is "unknown".
function publishedOnNpm(name, version) {
  const r = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8' });
  if (r.status === 0) return r.stdout.trim() === version;
  return /E404/.test(r.stderr) ? false : null;
}

const [command, ...rest] = process.argv.slice(2);
switch (command) {
  case 'preflight': {
    const { version: cliVersion } = readJson('packages', 'cli', 'package.json');
    const { version: rootVersion } = readJson('package.json');
    const problems = releaseProblems({
      cliVersion,
      tagsAtHead: gitState(root, `v${cliVersion}`).tagsAtHead,
      npmUser: out('npm', ['whoami']),
    });
    if (cliVersion !== rootVersion) {
      problems.push(
        `package.json is ${rootVersion} but packages/cli is ${cliVersion}; they must match (the release-it after:bump hook keeps them in sync).`,
      );
    }
    if (problems.length > 0) fail(`Not releasing:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    break;
  }
  case 'check-version': {
    const version = rest[0] ?? '';
    if (!isReleaseVersion(version)) {
      fail(
        `"${version}" is not a release version. Releases are plain X.Y.Z (CI rejects any other tag), so prereleases are not supported; pick a patch, minor or major version.`,
      );
    }
    break;
  }
  case 'sync-version': {
    const version = rest[0];
    if (!version) fail('usage: release-local.mjs sync-version <version>');
    const file = path.join(cliDir, 'package.json');
    fs.writeFileSync(file, setPackageVersion(fs.readFileSync(file, 'utf8'), version));
    console.log(`packages/cli/package.json -> ${version}`);
    break;
  }
  case 'notes': {
    const version = rest[0];
    if (!version) fail('usage: release-local.mjs notes <version|tag>');
    const section = changelogSection(read('CHANGELOG.md'), version);
    if (!section) fail(`CHANGELOG.md has no entries under "## [${version.replace(/^v/, '')}]".`);
    console.log(section);
    break;
  }
  case 'publish-check': {
    const { name, version } = readJson('package.json');
    const { version: cliVersion } = readJson('packages', 'cli', 'package.json');
    const problems = publishProblems({
      cliVersion,
      rootVersion: version,
      ...gitState(root, `v${version}`),
      publishedOnNpm: publishedOnNpm(name, version),
      npmUser: out('npm', ['whoami']),
      dryRun: false,
    });
    if (problems.length > 0) {
      fail(
        `Not publishing ${name}@${version}:\n${problems.map((p) => `  - ${p}`).join('\n')}\n` +
          'Fix this, then run `pnpm release:publish` (the release commit and tag are already pushed).',
      );
    }
    break;
  }
  default:
    fail(
      'usage: release-local.mjs preflight|check-version <version>|sync-version <version>|notes <version|tag>|publish-check (see RELEASING.md)',
    );
}
