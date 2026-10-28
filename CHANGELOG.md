# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The version is the CLI's (the `flashlink` package, run as `fl`);
the Worker is deployed from the same tag.

## [Unreleased]

### Added

- `fl update`: updates `fl` the way it was installed. From a clone it pulls `main`, installs and
  rebuilds (and refuses a dirty tree or another branch); a global npm, pnpm or bun install is
  reinstalled from npm; `fl update --check` only reports (exit 0 up to date, 1 update available,
  2 unknown) and `fl update --force` updates even when nothing is newer.

### Changed

- `fl --version` (and `-V`) now prints `fl X.Y.Z (sha7 YYYY-MM-DD)` for every install: the commit and
  its date, with `-dirty` when the build came from uncommitted changes. A build without commit
  information prints `fl X.Y.Z`. Previously a standalone binary printed `X.Y.Z (sha)` and an npm
  install printed the bare version, so a stale install was harder to spot. The Finder menu shows the
  new line too.

## [0.0.3] - 2026-10-22

### Changed

- The macOS installer now installs the `fl` command too: it links `fl` and `flashlink` in
  `~/.local/bin` to the standalone binary the Finder menu uses, so Terminal and Finder run the same
  version and nothing depends on Node. It never overwrites an `fl` installed some other way, says
  when `~/.local/bin` is not on your `PATH` (with the line to add), and when another `fl` comes first.
  Already installed? Run the install command again.
- The installer's output is clearer: grouped steps, colors on a terminal (not with `NO_COLOR`), and a
  "Next steps" list that only includes connecting to your Worker when that is still needed.

## [0.0.2] - 2026-10-22

### Security

- The standalone macOS binaries (`flashlink-darwin-arm64`, `flashlink-darwin-x64`) are now built with
  Bun 1.4.4. The 0.0.1 binaries embed Bun 1.4.2, whose Brotli decoder has an out-of-bounds write
  (CVE-2026-111497) reachable when decompressing a `br`-encoded HTTP response. Reinstall with the
  installer to update. The npm package runs on your own Node.js and is not affected by this change.

### Changed

- The macOS support archive no longer includes `macos/qa.sh`, a maintainer-only QA script the installer
  never used.

## [0.0.1] - 2026-10-04

### Added

- Worker on Cloudflare R2 with one SQLite-backed Durable Object: short public links
  (`https://<worker>/<code>`) that serve the raw file with its Content-Type, expire on their own
  (1 hour by default, 7 days at most), can be refreshed under the same code, revoked or purged,
  and support `Range` and `HEAD`.
- `fl` CLI (also installed as `flashlink`): `init`, `up` (files, several files, stdin, and folders as a zip), `refresh`, `revoke`,
  `ls`, `status` and `config`; local-only upload history; `--ttl`, `--max-downloads`, `--with-name`,
  `--json` (including machine-readable errors), `--notify` and `--no-copy`. `--max-downloads` closes a
  link after N downloads; every satisfiable `GET` counts (whole file or `Range`), but not `HEAD` or a
  `416`, so a client that reads a file in several ranges is not suited to it.
- A warning before uploading files that look like secrets (`.env`, keys, tokens), with
  `--allow-secrets` to override.
- macOS Finder Quick Actions with a lifetime picker and notifications, plus an installer that
  downloads a standalone `fl` binary (with a `flashlink` alias) from a release and checks its checksum.
- A landing page on the Worker's own URL: what the tool is, how to use the CLI and how to deploy your
  own copy.
- An agent skill (`skills/flashlink/SKILL.md`) so coding agents can create, refresh and revoke links.
- `pnpm setup:cloudflare`: one command to create the bucket, deploy the Worker, set the token and add
  the lifecycle rule in your own Cloudflare account; `scripts/verify-deployment.mjs` checks a
  deployment end to end.
- Guardrails: per-IP and global rate limits, a 50 MB default file cap, a total-storage cap and a daily
  upload cap, all configurable in `packages/worker/wrangler.jsonc`.
- MIT license.
