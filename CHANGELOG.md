# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The version is the CLI's (`r2fl`); the Worker is
deployed from the same tag.

## [Unreleased]

### Added

- Worker on Cloudflare R2 with one SQLite-backed Durable Object: short public links
  (`https://<worker>/<code>`) that serve the raw file with its Content-Type, expire on their own
  (1 hour by default, 7 days at most), can be refreshed under the same code, revoked or purged,
  and support `Range` and `HEAD`.
- `r2fl` CLI: `init`, `up` (files, several files, stdin, and folders as a zip), `refresh`, `revoke`,
  `ls`, `status` and `config`; local-only upload history; `--ttl`, `--max-downloads`, `--with-name`,
  `--json` (including machine-readable errors), `--notify` and `--no-copy`.
- A warning before uploading files that look like secrets (`.env`, keys, tokens), with
  `--allow-secrets` to override.
- macOS Finder Quick Actions with a lifetime picker and notifications, plus an installer that
  downloads a standalone `r2fl` binary from a release and checks its checksum.
- An agent skill (`skills/r2-fastlink/SKILL.md`) so coding agents can create, refresh and revoke links.
- `pnpm setup:cloudflare`: one command to create the bucket, deploy the Worker, set the token and add
  the lifecycle rule in your own Cloudflare account; `scripts/verify-deployment.mjs` checks a
  deployment end to end.
- Guardrails: per-IP and global rate limits, a 50 MB default file cap, a total-storage cap and a daily
  upload cap, all configurable in `packages/worker/wrangler.jsonc`.
- MIT license.

### Changed

- `--max-downloads` counts every satisfiable `GET` (whole file or `Range`), not `HEAD` or a `416`.
  A client that reads a file in several ranges uses one count per request, so it is not suited to
  `-d`.
- The Worker secret is `R2FL_TOKEN` (it was `UPLOAD_TOKEN` during development).
