---
id: rf-cl6p
status: in_progress
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: task
priority: 1
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, infra, ci, batch-01]
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
- [x] CI passes on a clean checkout with no secrets configured.
- [ ] README (Development section) mentions that CI runs these checks; badge optional.
- [x] Node version in CI comes from `.node-version` (no second source of truth).


## Notes

**2026-10-02T20:34:21Z**

Batch 01, PR #2 (branch batch-01-ci). Added .github/workflows/ci.yml (one job: corepack enable -> setup-node with node-version-file .node-version + pnpm cache -> install --frozen-lockfile, format:check, typecheck, test, build, wrangler deploy --dry-run --outdir $RUNNER_TEMP/dryrun). Triggers: pull_request and push to main; concurrency cancels superseded runs; contents: read only. README Development section documents CI. Deviation: actions pinned to checkout@v7/setup-node@v7 (v4 emitted Node 20 deprecation warnings). Evidence: PR run 37061207578 green in ~48s with no secrets and no .dev.vars (also verified locally that worker tests pass without .dev.vars, they inject their own token). Failure demo: throwaway PR #3 (deliberately failing worker test) went red at 'Run pnpm test' (run 37061332611), PR closed and branch deleted. Not verified: the push-to-main trigger and a deliberate failure of each other step (format/typecheck/build/dry-run; they are plain run steps so a nonzero exit fails the job).
AWAITING HUMAN: after merging PR #2, confirm a CI run appears and passes for the merge commit on main (gh run list --branch main). Then tick the first acceptance criterion and run: tk close rf-cl6p.
