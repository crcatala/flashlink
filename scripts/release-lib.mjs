// Helpers for scripts/release.mjs (tested in packages/cli/test/release.test.ts).
// Plain ESM, no dependencies.
import { execFileSync } from 'node:child_process';

/** Release versions are plain X.Y.Z: scripts/check-release-tag.mjs (CI) rejects anything else. */
export const RELEASE_VERSION = /^\d+\.\d+\.\d+$/;
export const isReleaseVersion = (v) => RELEASE_VERSION.test(v);

/** Set "version" in a package.json text, keeping the file's formatting. */
export function setPackageVersion(text, version) {
  if (!isReleaseVersion(version)) {
    throw new Error(
      `"${version}" is not a release version like 1.2.3 (prereleases are not supported: CI would reject the tag)`,
    );
  }
  let done = false;
  const out = text.replace(/^(\s*"version"\s*:\s*")[^"]*(")/m, (_m, a, b) => {
    done = true;
    return `${a}${version}${b}`;
  });
  if (!done) throw new Error('package.json has no "version" field');
  return out;
}

/**
 * The body of `## [<version>]` in a Keep a Changelog file (without the heading and without the
 * link references release-it adds at the bottom), or null when missing or empty.
 */
export function changelogSection(markdown, version) {
  const wanted = version.replace(/^v/, '');
  const lines = markdown.split('\n');
  const heading = (l) => /^## \[/.test(l);
  const start = lines.findIndex((l) => heading(l) && l.startsWith(`## [${wanted}]`));
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => i > start && heading(l));
  if (end === -1) end = lines.length;
  const body = lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]:\s+\S+/.test(l))
    .join('\n')
    .trim();
  return body === '' ? null : body;
}

/**
 * What is wrong with publishing to npm right now. `state`:
 *   { cliVersion, rootVersion, branch, clean, tagsAtHead: string[], headCommit: string|null,
 *     remoteTagCommit: string|null|undefined, publishedOnNpm: boolean|null, npmUser: string|null,
 *     dryRun: boolean }
 * `remoteTagCommit` is the commit the tag points to on origin: null = no such tag, undefined = could
 * not ask. Other `null`s mean "could not find out", which is a problem too.
 */
export function publishProblems(state) {
  const tag = `v${state.cliVersion}`;
  const problems = [];
  if (state.cliVersion !== state.rootVersion) {
    problems.push(
      `packages/cli is ${state.cliVersion} but the root package.json is ${state.rootVersion}; they must match (release-it keeps them in sync).`,
    );
  }
  if (!isReleaseVersion(state.cliVersion)) {
    problems.push(`"${state.cliVersion}" is not a release version (plain X.Y.Z).`);
  }
  if (state.branch !== 'main') problems.push(`You are on "${state.branch}", not main.`);
  if (!state.clean) problems.push('The working tree has uncommitted changes.');
  if (!state.tagsAtHead.includes(tag)) {
    problems.push(
      `HEAD is not tagged ${tag}. Publish only the commit \`pnpm release\` tagged (is the release finished?).`,
    );
  }
  if (!state.dryRun) {
    if (state.remoteTagCommit === undefined) {
      problems.push(`Could not ask origin about the tag ${tag}.`);
    } else if (state.remoteTagCommit === null) {
      problems.push(`The tag ${tag} is not on origin yet (git push origin ${tag}).`);
    } else if (state.remoteTagCommit !== state.headCommit) {
      problems.push(
        `The tag ${tag} on origin points to ${state.remoteTagCommit.slice(0, 10)}, but HEAD is ${String(state.headCommit).slice(0, 10)}. npm and the GitHub Release would get different code: fix the tag first.`,
      );
    }
  }
  if (state.publishedOnNpm === true) problems.push(`fl ${state.cliVersion} is already on npm.`);
  if (state.publishedOnNpm === null)
    problems.push('Could not check whether this version is already on npm.');
  if (!state.npmUser) problems.push('You are not logged in to npm (`npm login`).');
  return problems;
}

/** The commit a tag points to, from `git ls-remote --tags` output (peeled for annotated tags). */
export function parseRemoteTagCommit(lsRemoteOutput, tag) {
  let plain = null;
  for (const line of lsRemoteOutput.split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === `refs/tags/${tag}^{}`) return sha;
    if (ref === `refs/tags/${tag}`) plain = sha;
  }
  return plain;
}

function git(cwd, args) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

/** The git half of PublishState, read from the repository in `cwd`. */
export function gitState(cwd, tag) {
  const remote = git(cwd, [
    'ls-remote',
    '--tags',
    'origin',
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]);
  return {
    branch: git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']) ?? '?',
    clean: git(cwd, ['status', '--porcelain', '--untracked-files=no']) === '',
    headCommit: git(cwd, ['rev-parse', 'HEAD']),
    tagsAtHead: (git(cwd, ['tag', '--points-at', 'HEAD']) ?? '').split('\n').filter(Boolean),
    remoteTagCommit: remote === null ? undefined : parseRemoteTagCommit(remote, tag),
  };
}
