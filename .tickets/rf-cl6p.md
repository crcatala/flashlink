---
id: rf-cl6p
status: open
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 1
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, infra, ci]
---
# Add CI (GitHub Actions): format, typecheck, tests, build, dry-run deploy

## Why
There is no CI. Tests, typecheck, formatting and the Worker bundle can silently break on any change, and a public repo with outside forks needs a safety net. This also protects the invariants listed in the epic (for example "malformed codes never touch the DO" is test-enforced, but only if tests actually run).

## Design

- GitHub Actions workflow `.github/workflows/ci.yml` on push and pull_request.
- Use `actions/setup-node` with the version from `.node-version` (22), enable corepack/pnpm (packageManager is pinned in package.json), cache the pnpm store.
- Steps: `pnpm install --frozen-lockfile`, `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, then `pnpm --filter @r2-fastlink/worker exec wrangler deploy --dry-run --outdir /tmp/dryrun` (no credentials needed; proves the bundle and bindings resolve).
- Worker tests need workerd; the default ubuntu runner is fine. The pool reads `.dev.vars` if present (CI has none; tests inject their own token via vitest.config.ts so this is OK, verify).
- Keep the job under a few minutes; one job is enough.

## Acceptance Criteria

- [ ] Workflow runs on PRs and pushes to main and fails when any of format, typecheck, tests, build or the dry-run deploy fails (demonstrate by a deliberately failing commit on a throwaway branch, then remove it).
- [ ] CI passes on a clean checkout with no secrets configured.
- [ ] README (Development section) mentions that CI runs these checks; badge optional.
- [ ] Node version in CI comes from `.node-version` (no second source of truth).

