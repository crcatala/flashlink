---
id: rf-in0j
status: open
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

- [ ] Owner confirms the design (especially the protected-main question and release-it vs release-please).
- [ ] CHANGELOG.md (Keep a Changelog) exists with an [Unreleased] section; scripts/check-changelog.sh and scripts/prep-release.sh added and tested (bash scripts get a smoke test or shellcheck).
- [ ] release-it configured (.release-it.json) so a dry run on a clean main bumps packages/cli, updates the changelog and prints the tag, without publishing; release:dry documented.
- [ ] release.yml publishes the GitHub Release with the changelog section as its notes (tested script).
- [ ] RELEASING.md (or the README Releasing section) describes the full flow, including the first release and recovery (partial release, wrong tag).
- [ ] pnpm format:check, typecheck, test, build still pass.

