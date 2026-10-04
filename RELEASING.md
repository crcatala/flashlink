# Releasing

One person releases from their own machine with [release-it](https://github.com/release-it/release-it).
`main` is not protected, so the release commit and tag go straight to it. The release has two
halves with different homes:

- **On your machine** (`pnpm release`): checks, version bump, changelog, commit, tag, push, then
  **`npm publish`**. npm is published by hand on purpose: no npm token lives in the repository, and CI
  never publishes (so the package carries no npm provenance, which only CI can produce).
- **In CI** (`.github/workflows/release.yml`, triggered by the tag): the GitHub Release with the macOS
  binaries, installer and `SHA256SUMS`, using the changelog section as its notes.

## Prerequisites

- Push access to `crcatala/r2-fastlink` and a clean checkout of `main` (`git pull --ff-only`).
- Logged in to npm as a maintainer of `r2fl` (`npm whoami`; `npm login` otherwise).
- Node `^22.22.2`, `^24.15.0` or 26+ (what release-it 21 and its changelog plugin declare in `engines`; the project itself only needs 22.12+), pnpm, and `pnpm install` done.

## Every release

1. **Draft the changelog.** `pnpm release:prep` prints the commits since the last tag and a prompt for an
   LLM. Put the result under `## [Unreleased]` in `CHANGELOG.md` ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)
   sections: Added, Changed, Fixed, Removed, Security; user-visible changes only), then commit it to `main`
   and push. (`pnpm release` refuses an empty Unreleased section and a dirty tree.)
2. **Preview.** `pnpm release:dry` shows the version, changelog and git steps without changing anything.
   (release-it does not run its hooks in a dry run; `pnpm verify` is the check chain it runs for real:
   format, typecheck, tests, build.)
3. **Release.** `pnpm release` (or `pnpm release patch|minor|major`). It:
   1. checks the Unreleased section and runs `pnpm verify`;
   2. asks for the version (plain `X.Y.Z` only: prereleases are refused before anything changes, because CI would reject their tag) and shows the changelog;
   3. bumps `version` in the root `package.json` and copies it into `packages/cli/package.json`;
   4. moves the Unreleased entries under `## [X.Y.Z] - date` in `CHANGELOG.md`;
   5. commits `chore: release vX.Y.Z`, tags `vX.Y.Z` and pushes both to `main`;
   6. runs the npm publish step: it checks again that you are on a clean `main` with `HEAD` tagged, the tag
      is on `origin` and points at `HEAD`, the version is not on npm and you are logged in, then runs `npm publish --access public`
      in `packages/cli` (which builds and tests first, and asks for your one-time password if you use 2FA).
4. **Check.**
   - CI: the Release workflow is green and the release page lists `r2fl-darwin-arm64`, `r2fl-darwin-x64`,
     `r2fl-macos-support.tar.gz`, `install.sh`, `uninstall.sh` and `SHA256SUMS`, with the changelog as notes.
   - npm: `npm view r2fl version`, then `npx -y r2fl@latest --help` from a clean directory.
   - Mac: `curl -fsSL https://github.com/crcatala/r2-fastlink/releases/latest/download/install.sh | sh -s -- --latest`.

## The first release (0.1.0)

The version is still `0.0.0`, so `pnpm release minor` gives `0.1.0`. `CHANGELOG.md` already holds the
first release's entries under Unreleased; edit them instead of drafting from scratch. Do the
go-public steps first (repository public, license in place; the license is MIT).

## Recovery

- **The checks fail before the bump:** nothing changed; fix and re-run.
- **`npm publish` fails** (wrong one-time password, network): the tag and commit are already pushed, CI is
  running. Fix the cause and run `pnpm release:publish`. It refuses if the version is already on npm.
- **Published to npm but the GitHub Release failed:** re-run the failed workflow run from the Actions tab
  (the tag is unchanged), or fix the problem on `main` and let a new patch release replace it.
- **Wrong changelog text after a release:** edit `CHANGELOG.md` on `main`; edit the release notes on
  GitHub by hand. Published npm versions are immutable: ship a corrective version rather than replace one.
- **You tagged and pushed but want to undo before anyone used it:** `git push origin :refs/tags/vX.Y.Z`,
  `git tag -d vX.Y.Z`, and delete the GitHub Release if it exists. Do not unpublish from npm after the first
  hour without a reason; prefer a new patch version.
- **Check the publish step on its own:** `pnpm release:publish --dry-run` (needs `HEAD` tagged, so after a
  release; it passes `--dry-run` to `npm publish` and skips the check that the tag is on `origin`).
