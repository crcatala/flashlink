---
id: rf-gah1
status: closed
deps: []
links: []
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

- [x] `r2fl up some-dir` uploads a zip named `some-dir.zip` with correct content; unzipping it reproduces the directory (minus exclusions).
- [x] Size cap enforced on the zipped size with a helpful error; temp zip is always cleaned up.
- [x] Default exclusions and `--exclude`/gitignore behavior are tested; symlinks pointing outside the directory are not followed.
- [x] Behavior of `refresh` after purge for directory uploads is defined, tested and documented.
- [x] README updated (the "Is a directory" hint removed).


## Notes

**2026-10-03T23:20:16Z**

Done on branch batch-07-folder-zip (PR: see GitHub), commit 56f86ac. Deviations (also in docs/PLAN.md): (1) no system zip and no temp file: an in-memory zip writer on node:zlib (src/zip.ts, no new npm dependency) because the dev container has no zip, and a plaintext temp copy of possibly sensitive files is worse than none; so 'temp zip is always cleaned up' holds trivially (test asserts no .zip is written). (2) size cap = zipped size, aborts as soon as the running zip passes it; one extra guard, no --force flag: files totalling >20x the cap are refused before reading (the zip is held in memory). (3) .git and node_modules always excluded by name at any depth; 'explicitly included' = pass that folder itself. (4) refresh after purge for a folder zip is refused (HistoryEntry.sourceKind 'dir'). (5) secret check runs per member file while zipping. Evidence: 295 CLI tests (27 new in test/folder.test.ts, incl. real unzip -t and extraction), and built CLI against wrangler dev: uploaded my-project.zip, downloaded it, unzip -t clean, diff -r identical minus exclusions, leaking symlink skipped, purge+refresh refused. Not verified: macOS Quick Action on a real Mac with a right-clicked folder (optional manual check, no ticket gate).
