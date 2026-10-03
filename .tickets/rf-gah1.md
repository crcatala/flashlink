---
id: rf-gah1
status: open
deps: []
links: [rf-4514, rf-kecm]
created: 2026-10-02T20:05:53Z
type: feature
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, cli, idea, batch-07]
---
# Folder upload as zip: r2fl up <directory>

## Why
`r2fl up <directory>` currently errors with "Is a directory. Zip it first". Sharing a project folder or a set of logs is common, and the Finder Quick Action will be handed folders too.

## Design

- Spawn the system `zip` (`zip -r -q <tmp>.zip <dir>`, run with cwd = parent so paths are relative; macOS and most Linux have it) into the OS temp dir (mode 600), upload as `<dirname>.zip` (content type application/zip), delete the temp file in a `finally`. Error clearly if `zip` is missing. No new npm dependency unless a pure-JS zipper is clearly better.
- Apply the size cap to the ZIPPED size, and fail early (before zipping fully) if the uncompressed size is wildly over the cap and the user did not pass `--force`? Decide and document; at minimum report the zipped size in the error.
- `--exclude <glob>` (repeatable); respect `.gitignore` by default when the directory is a git repo (use `git ls-files` for the file list if available), with `--no-gitignore` to disable. Always exclude `.git/`, `node_modules/` unless explicitly included. Never follow symlinks outside the directory.
- History records the directory path as source; `refresh` after a purge can re-zip only if the zip's sha256 is reproducible: it generally is not (timestamps). Decide: either store `sourceKind: 'dir'` and refuse re-upload with a clear message, or re-zip and accept that content may differ. Prefer refusing with a clear message.

## Acceptance Criteria

- [ ] `r2fl up some-dir` uploads a zip named `some-dir.zip` with correct content; unzipping it reproduces the directory (minus exclusions).
- [ ] Size cap enforced on the zipped size with a helpful error; temp zip is always cleaned up.
- [ ] Default exclusions and `--exclude`/gitignore behavior are tested; symlinks pointing outside the directory are not followed.
- [ ] Behavior of `refresh` after purge for directory uploads is defined, tested and documented.
- [ ] README updated (the "Is a directory" hint removed).

