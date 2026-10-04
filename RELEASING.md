# Releasing

This project uses [release-it](https://github.com/release-it/release-it) for manual releases from a
maintainer machine. `main` is not protected, so the release commit and tag go straight to it. A release
has two halves with different homes:

- **On your machine** (`pnpm release`): checks, version bump, changelog, commit, tag, push, then
  **`npm publish`** of `flashlink` (installs the `fl` and `flashlink` commands).
- **In CI** (`.github/workflows/release.yml`, triggered by the pushed tag): the **GitHub Release**, with
  the changelog section as its notes and the macOS binaries, installer and `SHA256SUMS` attached.

npm is published by hand on purpose: no npm token lives in the repository and CI never publishes, so the
package carries no npm provenance (only CI can produce that). release-it's own npm and GitHub steps are
turned off in `.release-it.json`, which also means **you do not need a `GITHUB_TOKEN`**: CI creates the
GitHub Release with its own token.

## Prerequisites

- Push access to `crcatala/flashlink` and a clean checkout on `main` (`git pull --ff-only`).
- An npm account with publish access to `flashlink` (`npm whoami`; `npm login` otherwise). If the account
  uses 2FA, npm asks for a one-time password during the publish.
- Node `^22.22.2`, `^24.15.0` or 26+ (what release-it 21 and its changelog plugin declare in `engines`;
  the project itself only needs 22.12+), pnpm, and `pnpm install` done.

## Before releasing

1. Update `main`:

   ```sh
   git checkout main
   git pull --ff-only
   ```

2. Draft the changelog. The helper prints the commits since the last tag and a prompt for an LLM to turn
   them into user-facing entries:

   ```sh
   pnpm release:prep
   ```

   Put the result under `## [Unreleased]` in `CHANGELOG.md`, using
   [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) sections (Added, Changed, Fixed, Removed,
   Security; user-visible changes only), then commit it to `main` and push. `pnpm release` refuses an
   empty Unreleased section and a dirty working tree.

3. Optionally run the checks yourself. `pnpm release` runs them again, so this only saves a round trip:

   ```sh
   pnpm verify    # format check, typecheck, tests, build
   ```

## Release

Preview first:

```sh
pnpm release:dry
```

A dry run changes nothing and, by release-it's design, does not run the hooks (the changelog check and
`pnpm verify`). It does require a clean working tree on `main`, since that is a rule of the real release.

Then release:

```sh
pnpm release              # asks for the version; or: pnpm release patch|minor|major
```

It does these steps, stopping at the first failure:

1. checks that the Unreleased section has entries, and runs `pnpm verify`;
2. asks for the version (plain `X.Y.Z` only: prereleases are refused before anything changes, because CI
   would reject their tag) and shows the changelog;
3. bumps `version` in the root `package.json` and copies it into `packages/cli/package.json` (one version
   for everything; never edit it by hand: CI refuses a tag that does not match);
4. moves the Unreleased entries under `## [X.Y.Z] - date` in `CHANGELOG.md`;
5. commits `chore: release vX.Y.Z`, tags `vX.Y.Z` and pushes both to `main`;
6. publishes to npm. First it checks again that you are on a clean `main` with `HEAD` tagged, that the tag
   is on `origin` and points at `HEAD`, that the version is not on npm yet and that you are logged in. Then
   it runs `npm publish --access public` in `packages/cli`, which builds and tests before publishing.

Pushing the tag starts the Release workflow. It checks the tag against the CLI version and the changelog,
runs format, typecheck, tests and the build, then builds the macOS binaries on a Linux runner and creates
the GitHub Release.

## Verify the release

- **GitHub:** the Release workflow is green and the release page lists `flashlink-darwin-arm64`,
  `flashlink-darwin-x64`, `flashlink-macos-support.tar.gz`, `install.sh`, `uninstall.sh` and `SHA256SUMS`,
  with the changelog section as the notes.
- **npm:** `npm view flashlink version`, then from a clean directory `npx -y flashlink@latest --version`
  and `npx -y flashlink@latest --help`.
- **Mac:** `curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/install.sh | sh -s -- --latest`,
  then `~/.local/share/flashlink/bin/fl --version`.

To check what npm would receive without publishing: `cd packages/cli && npm pack --dry-run` (just
`dist/`, `LICENSE`, `package.json` and the README).

## The first release (0.0.1)

`0.0.1` was the first release. The checklist below is what it needed, kept for forks and for reference.
From here on, `pnpm release patch|minor|major` is all a release needs. Before the first tag:

- The GitHub repository is named `flashlink` (the installer, the docs and the landing page all use
  `crcatala/flashlink`) and is **public**. The installer's `curl` download and `releases/latest` links
  only work on a public repository.
- The `flashlink` name is still free on npm (`npm view flashlink` should answer E404).
- A clean-account run of `pnpm setup:cloudflare` and `scripts/verify-deployment.mjs` has passed (see
  [`docs/VERIFY_DEPLOYMENT.md`](docs/VERIFY_DEPLOYMENT.md)).

## Recovery

- **The checks fail before the bump:** nothing changed; fix and re-run.
- **`npm publish` fails** (wrong one-time password, network): the tag and commit are already pushed and
  CI is running. Fix the cause and run `pnpm release:publish`. It refuses if the version is already on npm.
- **Published to npm but the GitHub Release failed:** re-run the failed workflow run from the Actions tab
  (the tag is unchanged), or fix the problem on `main` and let a new patch release replace it.
- **Wrong changelog text after a release:** edit `CHANGELOG.md` on `main`; edit the release notes on
  GitHub by hand. Published npm versions are immutable: ship a corrective version rather than replace one.
- **You tagged and pushed but want to undo before anyone used it:** `git push origin :refs/tags/vX.Y.Z`,
  `git tag -d vX.Y.Z`, and delete the GitHub Release if it exists. Do not unpublish from npm after the
  first hour without a reason; prefer a new patch version.
- **Check the publish step on its own:** `pnpm release:publish --dry-run` (needs `HEAD` tagged, so after a
  release; it passes `--dry-run` to `npm publish` and skips the check that the tag is on `origin`).
