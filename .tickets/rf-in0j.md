---
id: rf-in0j
status: closed
deps: []
links: []
created: 2026-10-04T00:38:30Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [release, infra, needs-human]
---
# Release workflow: release-it, changelog conventions and prep helpers

## Why
The tag-triggered release.yml (rf-od5l, rf-kphq) publishes to npm and builds the Mac binaries, but nothing yet bumps the version, writes a changelog or checks a release is ready: today it is 'edit packages/cli/package.json by hand, tag, push'. The owner already has a working setup in two other repos (github.com/crcatala/mymacros-cli and raindrop-cli): release-it with @release-it/keep-a-changelog, a CHANGELOG.md in Keep a Changelog format, scripts/check-changelog.sh (fails when [Unreleased] has no entries), scripts/prep-release.sh (prints commits since the last tag plus a prompt for drafting the changelog with an LLM), `release`/`release:dry`/`release:first`/`release:prep` scripts, and a RELEASING.md. Reuse it here, adapted to this repo.

## Design (proposal from the 2026-10-03 review; confirm before building)
- Keep the conventions from the owner's repos: release-it + keep-a-changelog plugin, CHANGELOG.md, check-changelog.sh, prep-release.sh, RELEASING.md.
- What differs here: (1) pnpm monorepo and ONE version, in packages/cli/package.json (root and the other packages stay private at 0.0.0), so release-it needs a hook that bumps packages/cli (for example `after:bump`: `pnpm --filter r2fl exec npm version ${version} --no-git-tag-version`), or run release-it with its package.json pointing there. (2) npm publish and the GitHub Release stay in .github/workflows/release.yml on the tag: npm provenance only works from a GitHub-hosted runner, and the Mac binaries are built there. So release-it is configured `npm.publish: false` and `github.release: false`; it bumps, updates CHANGELOG.md, commits `chore: release vX.Y.Z`, tags and pushes. (3) The workflow should use the CHANGELOG.md section for that version as the GitHub Release notes (small script, tested) instead of generated notes. (4) before:init hooks: `pnpm format:check && pnpm typecheck && pnpm test && pnpm build`, check-changelog.sh, and scripts/check-release-tag.mjs semantics (tag equals v<cli version>) so the workflow's own check can never fail.
- prep-release.sh: same idea as the owner's (commits since the last tag with bodies, minus Co-Authored-By lines, plus changed files, plus the drafting prompt). This repo uses conventional commits and one PR per batch, so the prompt can also ask to group by feat/fix and to skip chore/ci/docs/test unless user-visible. Keep the LLM drafting step; the owner edits the result.
- Open decision for the owner: is `main` protected (PR required)? release-it's default pushes the release commit straight to main (requireBranch main). If main requires PRs, use a two-step flow: `pnpm release:prep` branch does the bump + changelog commit without tagging (release-it `--no-git.tag --no-git.push` on a `release/vX.Y.Z` branch), merge that PR, then `pnpm release:tag` tags the merge commit and pushes only the tag. Recommend this two-step flow either way, since it matches how everything else lands here (one reviewed PR per change).
- Alternative considered: release-please (a bot opens a release PR with version + changelog from conventional commits; merging it tags). Zero local tooling and fits the PR flow, but the changelog is only as good as the commit subjects (no curated/LLM-edited pass), and tags created with the default GITHUB_TOKEN do not trigger release.yml (needs a PAT or GitHub App). Changesets was rejected as overkill (one published package). Recommendation: stay with release-it for consistency with the owner's other repos.
- First release: CHANGELOG.md starts with [Unreleased] and the v0.1.0 section written from the prep script's output; `release:first` equivalent for 0.1.0 (the version in packages/cli is still 0.0.0).

## Acceptance Criteria

- [x] Owner confirms the design (especially the protected-main question and release-it vs release-please).
- [x] CHANGELOG.md (Keep a Changelog) exists with an [Unreleased] section; scripts/check-changelog.sh and scripts/prep-release.sh added and tested (bash scripts get a smoke test or shellcheck).
- [x] release-it configured (.release-it.json) so a dry run on a clean main bumps packages/cli, updates the changelog and prints the tag, without publishing; release:dry documented.
- [x] release.yml publishes the GitHub Release with the changelog section as its notes (tested script).
- [x] RELEASING.md (or the README Releasing section) describes the full flow, including the first release and recovery (partial release, wrong tag).
- [x] pnpm format:check, typecheck, test, build still pass.


## Notes

**2026-10-04T01:48:56Z**

2026-10-03 DONE on branch feat/release-tooling (PR to follow), owner decisions applied: main is NOT protected and stays that way (release-it pushes the release commit and tag straight to main, requireBranch main); keep release-it; npm is published MANUALLY from the owner's machine, never by CI. Built: .release-it.json (git commit/tag/push, github.release false, npm.publish false, before:init = check-changelog.sh + pnpm verify, after:bump = sync-version), @release-it/keep-a-changelog, CHANGELOG.md (Unreleased already holds the v0.1.0 entries), scripts/check-changelog.sh, scripts/prep-release.sh (prompt adapted to conventional commits), scripts/release.mjs + release-lib.mjs (release | publish | sync-version | notes), RELEASING.md, README Releasing section, PLAN Release paragraph. Commands: pnpm release:prep, release, release:dry, release:publish, verify. 'pnpm release' = release-it then the interactive npm publish (separate step because npm's OTP prompt cannot work inside a release-it hook); release:publish repeats it and refuses unless on clean main, HEAD tagged v<cli version>, tag on origin, version not on npm, logged in. One version: root package.json bumped by release-it, copied into packages/cli; check-release-tag.mjs fails CI if they differ. release.yml: npm-publish job REMOVED (no NPM_TOKEN, no id-token permission), verify job also requires a CHANGELOG entry for the tag, GitHub Release notes = that section. Deviation/consequence: dropped npm provenance (publishConfig.provenance and --provenance), because only a supported CI provider can generate it; the test and docs say so. Evidence: 35 release tests (version sync, changelog section parser, publish refusals, bash helpers in temp repos, workflow has no npm publish); REAL release-it run (not dry-run) in a scratch clone with a local bare origin: hooks ran, root and cli both 0.1.0, CHANGELOG heading '## [0.1.0] - date', 'chore: release v0.1.0' commit + annotated tag pushed, notes/tag checks pass; publish step run against a fake npm (right args, cwd packages/cli, refuses on dirty tree / not logged in). Not verified: a real npm publish and the GitHub Release job (they need the first real tag; tracked in rf-od5l and rf-kphq). Note: release-it does not run hooks in --dry-run, so release:dry previews only the version/changelog/git steps.

**2026-10-04T03:33:57Z**

2026-10-03 review follow-up on PR #21, 4 fixes: (1) release:publish compares the PEELED commit of the tag on origin (git ls-remote ...^{}) with HEAD and refuses when they differ (npm and the GitHub Release would get different code); also refuses when origin cannot be asked; integration tests use a real repo with a local bare origin (annotated tag pushed from HEAD ok; local tag moved to a new commit refused). (2) Prereleases are refused BEFORE any change: release-it before:bump hook runs 'release.mjs check-version ${version}', and setPackageVersion/publishProblems now accept plain X.Y.Z only, like check-release-tag.mjs; verified in a scratch clone (tree clean, no tag, versions unchanged after 'release-it 0.2.0-rc.1') and that a normal release still passes the new hook. Prereleases would need their own flow (npm --tag next, tag-check rules): not built. (3) RELEASING.md Node requirement corrected to ^22.22.2 || ^24.15.0 || >=26 (release-it 21.1.0 and its plugin engines; I had copied an older figure). (4) Versioning docs aligned: PLAN says the private root package.json is the source, copied into packages/cli, not edited by hand, and drops the old 'nothing is published by hand' sentence; check-release-tag.mjs message and header now point at 'pnpm release' instead of 'bump and tag by hand'. Tests: cli 355 pass (11 new).
