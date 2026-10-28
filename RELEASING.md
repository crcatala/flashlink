# Releasing

Releases are cut by hand from a clean `main` with
[release-it](https://github.com/release-it/release-it), wrapped by the canonical
`scripts/release.mjs`. One command bumps the version, moves the changelog's Unreleased section into
the new version, commits, tags `vX.Y.Z`, pushes, and then publishes `flashlink` to npm from the
tagged commit.

This repository is a pnpm monorepo whose npm package is the **repository root**: `packages/cli` is
the CLI's build package (bundled into `packages/cli/dist`, which the root `package.json` ships as
`fl` and `flashlink`). One version covers everything: release-it bumps the root `package.json`, and
`scripts/release-local.mjs sync-version` copies it into `packages/cli/package.json`, which is what
the standalone macOS binaries report.

The release has two halves with different homes:

- **On your machine** (`pnpm release`): checks, version bump, changelog, commit, tag, push, then
  **`npm publish`** of `flashlink`.
- **In CI** (`.github/workflows/release.yml`, triggered by the pushed tag): the **GitHub Release**,
  with the changelog section as its notes and the macOS binaries, installer and `SHA256SUMS`
  attached. release-it's own GitHub step is turned off in `.release-it.json`, which also means **you
  do not need a `GITHUB_TOKEN`**: CI creates the GitHub Release with its own token.

npm is published by hand on purpose: no npm token lives in the repository and CI never publishes, so
the package carries no npm provenance (only CI can produce that).

## Prerequisites

- Push access to `crcatala/flashlink` and a clean checkout on `main` (`git pull --ff-only`).
- An npm account with publish access to `flashlink` (`npm whoami`; `npm login` otherwise). The
  release refuses to start without a login, since the publish only runs after the tag is pushed. If
  the account uses 2FA, npm asks for a one-time password during the publish.
- Node `^22.22.2`, `^24.15.0` or 26+ (what release-it 21 and its changelog plugin declare in
  `engines`; the project itself only needs 22.12+), pnpm, and `pnpm install` done.

## Before releasing

1. Start from an up-to-date `main`:

   ```sh
   git checkout main
   git pull --ff-only
   ```

2. Draft the changelog:

   ```sh
   pnpm release:prep
   ```

   Paste the output into an LLM, review the result, and put it under `## [Unreleased]` in
   `CHANGELOG.md` (Added, Changed, Fixed, Removed, Security; user-facing changes only; write for the
   people who use the CLI, the Worker or the Finder menu). Commit it to `main` and push.

3. Optionally run the checks yourself (`pnpm release` runs them again):

   ```sh
   pnpm verify && pnpm test:package
   ```

## Release

```sh
pnpm release:dry       # preview; changes nothing and skips the hooks
pnpm release           # asks for the version; or: pnpm release -- patch|minor|major
```

In order, `pnpm release`:

1. refuses to start when not logged in to npm or when `HEAD` is already a release;
2. runs, through release-it's `before:init` hook, the project preflight (npm login, version sync,
   no half-finished release), `scripts/check-changelog.sh` (Unreleased has entries) and `pnpm verify`
   (format check, typecheck, tests, build);
3. asks for the version (plain `X.Y.Z` only: `before:bump` runs `release-local.mjs check-version`,
   which refuses a prerelease before anything changes, because CI would reject such a tag);
4. bumps the root `package.json` and `CHANGELOG.md`, then runs `after:bump`: the version is copied
   into `packages/cli/package.json` and `pnpm test:package` packs the tarball, installs it and checks
   `--help` and `--version` for both commands;
5. commits `chore: release vX.Y.Z`, tags `vX.Y.Z`, pushes both;
6. publishes `flashlink` to npm from the tagged commit (`npm publish` in the repository root, which
   runs `prepublishOnly`: `release-local.mjs publish-check` plus `pnpm verify`; npm may ask for a
   one-time password).

Pushing the tag starts the Release workflow. It checks the tag against the version and the changelog,
runs format, typecheck, tests and the build, builds the macOS binaries on a Linux runner, and creates
the GitHub Release.

## Verify the release

- **GitHub:** the Release workflow is green and the release page lists `flashlink-darwin-arm64`,
  `flashlink-darwin-x64`, `flashlink-macos-support.tar.gz`, `install.sh`, `uninstall.sh` and
  `SHA256SUMS`, with the changelog section as the notes.
- **npm:** `npm view flashlink version`, then from a clean directory
  `npx -y flashlink@latest --version` (it prints `fl X.Y.Z (sha7 YYYY-MM-DD)`) and
  `npx -y flashlink@latest --help`.
- **Mac:** `curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/install.sh | sh -s -- --latest`,
  then `~/.local/share/flashlink/bin/fl --version`.

To check what npm would receive without publishing: `npm pack --dry-run` (the tarball holds
`packages/cli/dist`, `dist/build-info.json`, `LICENSE`, the README and `package.json`).

## The first release (0.0.1)

`0.0.1` was the first release. The checklist below is what it needed, kept for forks and for
reference. From here on, `pnpm release patch|minor|major` is all a release needs. Before the first
tag:

- The GitHub repository is named `flashlink` (the installer, the docs and the landing page all use
  `crcatala/flashlink`) and is **public**. The installer's `curl` download and `releases/latest` links
  only work on a public repository.
- The `flashlink` name is still free on npm (`npm view flashlink` should answer E404).
- A clean-account run of `pnpm setup:cloudflare` and `scripts/verify-deployment.mjs` has passed (see
  [`docs/VERIFY_DEPLOYMENT.md`](docs/VERIFY_DEPLOYMENT.md)).

## Recovery

- **Before the commit** (steps 1-4): nothing was changed on the remote. Fix the cause and run
  `pnpm release` again; `git checkout -- .` discards a half-made bump.
- **The GitHub Release:** the workflow's checks and the release itself are separate jobs; re-run the
  failed workflow run from the Actions tab (the tag is unchanged).
- **`npm publish` fails or is refused** (not logged in, wrong one-time password, network): the tag
  and commit are already pushed and CI is running. Fix the cause and run `pnpm release:publish`; do
  not run `pnpm release` again (it would refuse, since `HEAD` is already the release).
  `release:publish` refuses if the version is already on npm, if the tag is not at `HEAD`, or if the
  tag on `origin` points at another commit.
- **Wrong changelog text after a release:** edit `CHANGELOG.md` on `main`; edit the release notes on
  GitHub by hand. Published npm versions are immutable: ship a corrective version rather than
  replace one.
- **You tagged and pushed but want to undo before anyone used it:** `git push origin :refs/tags/vX.Y.Z`,
  `git tag -d vX.Y.Z`, and delete the GitHub Release if it exists. Do not unpublish from npm after the
  first hour without a reason; prefer a new patch version.
- **Check the publish step on its own:** `pnpm release:publish --dry-run` (needs `HEAD` tagged and
  the tag pushed, so after a release; it passes `--dry-run` to `npm publish`).

## The canonical files

`scripts/release.mjs`, `scripts/build-info.mjs`, `scripts/test-package.sh`,
`scripts/prep-release.sh` and `scripts/check-changelog.sh` are byte-identical copies from the shared
release standard: do not edit them (`.prettierignore` keeps `pnpm format:check` from rewriting them).
Project-specific release code lives beside them and is what the hooks and CI call:

- `scripts/release-local.mjs` - the checks and steps above that only this monorepo needs
  (`preflight`, `check-version`, `sync-version`, `notes`, `publish-check`), with
  `scripts/release-lib.mjs` and its tests in `packages/cli/test/release.test.ts`.
- `scripts/check-release-tag.mjs` - CI: the tag must be `v<version>` and both `package.json` versions
  must agree.
- `scripts/test-package.local.sh` - extra package checks, sourced by `scripts/test-package.sh`.
