#!/usr/bin/env node
// Refuses a release tag that does not match the CLI's version (and the root package.json, which
// release-it bumps and copies into the CLI), so the npm package, the release binaries and
// `r2fl --version` can never disagree.
//
//   node scripts/check-release-tag.mjs v0.1.0     (the release workflow passes $GITHUB_REF_NAME)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(
  fs.readFileSync(path.join(root, 'packages', 'cli', 'package.json'), 'utf8'),
);

const tag = process.argv[2];
if (!tag) {
  console.error('usage: check-release-tag.mjs <tag>   (for example v0.1.0)');
  process.exit(2);
}
const rootVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
if (rootVersion !== version) {
  console.error(
    `The root package.json is ${rootVersion} but packages/cli is ${version}; release-it keeps them in sync, so fix whichever was edited by hand.`,
  );
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+$/.test(version)) {
  console.error(
    `packages/cli/package.json has version "${version}", which is not a plain X.Y.Z release version.`,
  );
  process.exit(1);
}
if (tag !== `v${version}`) {
  console.error(
    `Tag ${tag} does not match packages/cli/package.json (version ${version}, so the tag must be v${version}).\n` +
      'Bump the version in a commit, then tag that commit.',
  );
  process.exit(1);
}
console.log(`ok: ${tag} matches packages/cli/package.json`);
