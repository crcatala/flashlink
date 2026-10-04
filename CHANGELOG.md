# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/). The version is the CLI's (the `flashlink` package, run as `fl`);
the Worker is deployed from the same tag.

## [Unreleased]

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
