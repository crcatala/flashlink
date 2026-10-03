---
id: rf-od5l
status: in_progress
deps: [rf-cl6p]
links: [rf-kphq, rf-16ho]
created: 2026-10-02T20:05:53Z
type: task
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, cli, release, needs-human, batch-05]
---
# Publish the CLI to npm (r2fl)

## Why
The README currently tells users to clone the repo and symlink the built CLI. Publishing `r2fl` to npm makes `npm i -g r2fl` / `npx r2fl` work and is expected for a public tool. It also matters for phase 2: the Quick Action needs a stable, easily installed binary.

## Design

- Check the name `r2fl` is available on npm; if not, use a scoped name (e.g. `@<owner>/r2fl`) and keep the `r2fl` bin name.
- packages/cli is currently `version: 0.0.0` and bundles core via tsup (`noExternal`), so only `dist` is needed (`files: ["dist"]` is already set). Add `description`, `repository`, `homepage`, `keywords`, `license` (after the license ticket), `engines.node >= 22.12` (already set).
- Ensure `prepublishOnly` runs build + tests; verify the tarball with `npm pack --dry-run` (contains dist/index.js with shebang, executable bit preserved, no source/test files, no secrets).
- Release automation: a GitHub Actions workflow on tag `v*` that publishes with provenance (`npm publish --provenance --access public`) using an `NPM_TOKEN` secret the OWNER adds. Do not publish from an agent session.
- Update README Install section; keep the "from source" instructions as an alternative.

## Acceptance Criteria

- [x] `npm pack --dry-run` shows only intended files; installing the packed tarball into a clean temp dir gives a working `r2fl --version` and `r2fl --help`.
- [ ] Release workflow exists and is documented; actual publish is performed by the owner (record in a note).
- [x] README install instructions updated; `npx r2fl --help` documented.


## Notes

**2026-10-02T20:20:30Z**

SCOPE FOR AN AGENT (batch-05): do the packaging, npm pack verification and tag-triggered release workflow; do NOT publish. rf-cr7d (license) needs the owner's decision: only add LICENSE if the owner has recorded a decision in a note on rf-cr7d; otherwise leave it in_progress with an AWAITING HUMAN note that lists the options and asks for a choice.

**2026-10-03T20:11:24Z**

Batch 05 (branch batch-05-release-packaging, PR to follow). Done: packages/cli/package.json metadata (keywords, homepage, bugs, repository, publishConfig access=public + provenance, prepublishOnly = build + test; no license field yet, see rf-cr7d); packages/cli/README.md for the npm page; scripts/check-release-tag.mjs (tag must equal v<cli version>, tested); .github/workflows/release.yml (tag v*: verify -> github-release + npm-publish; npm job skips with a warning when NPM_TOKEN is unset); README Install and Releasing sections. Verified on Linux: npm pack lists only dist/index.js (executable, shebang), package.json, README.md; npm i of the packed tarball in a clean temp dir gives a working 'r2fl --version' and 'r2fl --help'. The name r2fl returned 404 on the registry on 2026-10-03, so it is free. Deviation: none from the design.
AWAITING HUMAN: (1) Decide the license first (rf-cr7d), then add LICENSE and the 'license' field in packages/cli/package.json before the first publish. (2) npm provenance only works from a PUBLIC repository, so make the repo public before the first publish (or drop 'provenance' from publishConfig and the workflow flag to publish while private). (3) Create an npm automation/granular token that can publish the new package r2fl and add it as the repository secret NPM_TOKEN. (4) Bump packages/cli version (for example 0.1.0) in a commit, merge, then 'git tag v0.1.0 && git push origin v0.1.0'. (5) Check the release run (release.yml) is green, 'npm view r2fl' shows the version, and 'npx r2fl --help' works from a clean directory; then tick the middle criterion ('Release workflow exists and is documented; actual publish is performed by the owner') and close this ticket. The workflow has not run on real Actions yet.
