---
id: rf-dgve
status: open
deps: [rf-kecm]
links: []
created: 2026-10-03T17:27:31Z
type: task
priority: 2
assignee: cc-vps
parent: rf-yofr
tags: [phase-3, macos, swift, batch-15]
---
# Swift upload core (R2FLCore): Foundation-only package, tested on Linux CI

Everything the Finder app needs that is NOT Apple UI, as a SwiftPM package that builds and tests on Linux (and compiles unchanged into the macOS app), so most of the app's logic is verified on Ubicloud CI instead of only on a Mac. Scope is fixed by the approved design note (rf-kecm); this ticket must not start before it.

## Design

Location: macos/R2FLCore/ (Package.swift, Sources/R2FLCore, Tests/R2FLCoreTests). Foundation only (FoundationNetworking on Linux); no AppKit, UserNotifications or FinderSync.
Contents (match the CLI exactly, do not invent new formats): (1) config loading from the same file as the CLI, ~/.config/r2fl/config.json honoring XDG_CONFIG_HOME, with R2FL_ENDPOINT / R2FL_TOKEN / R2FL_TTL overrides (see packages/cli/src/config.ts and paths.ts); (2) duration parsing identical to packages/core/src/duration.ts (15m, 1h, 1d, 7d, ...); (3) the upload: POST <endpoint>/api/links with Authorization: Bearer <token>, file bytes streamed from disk (never loaded whole into memory), Content-Length, X-TTL-Seconds, X-Filename, Content-Type guessed from the extension (see packages/worker/src/api.ts handleUpload and packages/core/src/client.ts); (4) typed results and API errors ({error, message} codes, see packages/core/src/types.ts) mapped to messages a notification can show; client-side pre-check of maxFileBytes and empty files; (5) the history append, if rf-kecm decided the app writes ~/.local/share/r2fl/history.json in the CLI's schema (packages/cli/src/history.ts); (6) move macos/spike/Shared/HandOff.swift here (the spike keeps its copy). Multi-file selections: sequential or bounded concurrency, one result per file, never abort the batch on one failure.
Tests: unit tests for config/duration/error mapping/handoff; integration tests that run the real Worker locally (cd packages/worker && wrangler dev, port 8787, token from .dev.vars; the existing worker tests show the pattern) and upload small, awkward-named and oversize files. CI: a Linux job on ubicloud-standard-2 with a pinned Swift toolchain (setup action pinned by commit SHA like the other workflows) running swift test, path-filtered to macos/R2FLCore/**. Rebuild nothing in the TypeScript packages.

## Acceptance Criteria

- [ ] swift build and swift test pass on Linux in CI (ubicloud-standard-2), path-filtered, with a pinned toolchain.
- [ ] Integration test uploads through a locally running Worker and the returned link serves the same bytes.
- [ ] Config, duration and error behavior match the CLI for the same inputs (table-driven tests against the same fixtures where possible).
- [ ] No token is ever logged or written outside the config file; a test asserts error messages do not contain the token.
- [ ] README or macos/R2FLCore/README.md explains how to run the tests locally.

