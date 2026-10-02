---
id: rf-od5l
status: open
deps: [rf-cl6p]
links: []
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

- [ ] `npm pack --dry-run` shows only intended files; installing the packed tarball into a clean temp dir gives a working `r2fl --version` and `r2fl --help`.
- [ ] Release workflow exists and is documented; actual publish is performed by the owner (record in a note).
- [ ] README install instructions updated; `npx r2fl --help` documented.


## Notes

**2026-10-02T20:20:30Z**

SCOPE FOR AN AGENT (batch-05): do the packaging, npm pack verification and tag-triggered release workflow; do NOT publish. rf-cr7d (license) needs the owner's decision: only add LICENSE if the owner has recorded a decision in a note on rf-cr7d; otherwise leave it in_progress with an AWAITING HUMAN note that lists the options and asks for a choice.
