# Development

Notes for working on the code (your own fork, or the maintainer). The project is not taking outside contributions; see [`CONTRIBUTING.md`](../CONTRIBUTING.md).

```
packages/core     shared types, duration parsing, API client
packages/worker   Cloudflare Worker, Registry Durable Object, landing page (public/)
packages/cli      the `fl` command
macos/            Finder Quick Actions, installer, notifier
skills/flashlink  the agent skill
scripts/          deploy setup, deployment verification, release and build helpers
docs/             deploy, CLI, macOS and agent guides; ARCHITECTURE.md has the design and decisions
```

## Run and test

```sh
pnpm install
pnpm test          # all packages (Worker tests run in workerd via @cloudflare/vitest-pool-workers)
pnpm typecheck
pnpm format
pnpm build         # the fl CLI
pnpm verify        # format check + typecheck + test + build: what CI and a release run

cd packages/worker
echo 'FLASHLINK_TOKEN=dev-token-0123456789abcdef' > .dev.vars
pnpm exec wrangler dev             # local Worker + R2 + Durable Object on :8787
```

`node scripts/verify-deployment.mjs --endpoint http://localhost:8787` (with `FLASHLINK_TOKEN` set to the `.dev.vars` token) runs the black-box deployment checks against the local Worker; add `--sweeper` and start `wrangler dev` with `--var PURGE_GRACE_SECONDS:20` to include the sweeper check.

Keep the README, the guides in `docs/` and [`ARCHITECTURE.md`](ARCHITECTURE.md) in sync with any change in behavior, defaults or decisions.

## CI

`.github/workflows/ci.yml` runs on every pull request and on pushes to `main`: `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `wrangler deploy --dry-run` for the Worker. It needs no secrets and takes its Node version from `.node-version`.

It runs on `ubicloud-standard-2`; forks without Ubicloud should change `runs-on` to `ubuntu-latest`. Actions are pinned to commit SHAs. A second job, `binaries`, builds the release files exactly as a release does (both darwin binaries, the support archive, `SHA256SUMS`), checks the checksums and starts the linux build, so a broken build shows up on the pull request rather than at release time.

## Releasing

Maintainer only; see [`RELEASING.md`](../RELEASING.md).
