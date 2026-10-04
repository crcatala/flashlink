// Pure helpers for scripts/release.mjs (tested in packages/cli/test/release.test.ts).
// Plain ESM, no dependencies.

/** Set "version" in a package.json text, keeping the file's formatting. */
export function setPackageVersion(text, version) {
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`"${version}" is not a version like 1.2.3`);
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
 *   { cliVersion, rootVersion, branch, clean, tagsAtHead: string[], tagOnRemote: boolean|null,
 *     publishedOnNpm: boolean|null, npmUser: string|null, dryRun: boolean }
 * `null` means "could not find out", which is a problem too (except the remote tag in a dry run).
 */
export function publishProblems(state) {
  const tag = `v${state.cliVersion}`;
  const problems = [];
  if (state.cliVersion !== state.rootVersion) {
    problems.push(
      `packages/cli is ${state.cliVersion} but the root package.json is ${state.rootVersion}; they must match (release-it keeps them in sync).`,
    );
  }
  if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(state.cliVersion)) {
    problems.push(`"${state.cliVersion}" is not a release version.`);
  }
  if (state.branch !== 'main') problems.push(`You are on "${state.branch}", not main.`);
  if (!state.clean) problems.push('The working tree has uncommitted changes.');
  if (!state.tagsAtHead.includes(tag)) {
    problems.push(
      `HEAD is not tagged ${tag}. Publish only the commit \`pnpm release\` tagged (is the release finished?).`,
    );
  }
  if (!state.dryRun && state.tagOnRemote !== true) {
    problems.push(`The tag ${tag} is not on origin yet (git push origin ${tag}).`);
  }
  if (state.publishedOnNpm === true) problems.push(`r2fl ${state.cliVersion} is already on npm.`);
  if (state.publishedOnNpm === null)
    problems.push('Could not check whether this version is already on npm.');
  if (!state.npmUser) problems.push('You are not logged in to npm (`npm login`).');
  return problems;
}
