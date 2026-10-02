---
id: rf-lkxm
status: closed
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: task
priority: 2
assignee: cc-vps
parent: rf-dek6
tags: [phase-1, infra, core]
---
# Phase 1.1: Scaffold pnpm monorepo and shared core package

## Why
A single repo with Worker, CLI and shared types needs one toolchain so types, constants and the API client cannot drift between server and client.

## What was done
pnpm workspace with three packages: `packages/core` (constants, duration parsing, API types, `FastlinkClient`), `packages/worker`, `packages/cli`. Shared tsconfig, Prettier, vitest everywhere, `allowImportingTsExtensions`. Core is consumed as TypeScript source (package `exports` points at src/index.ts) and bundled into the CLI by tsup (`noExternal`).

## Acceptance Criteria

- [x] `pnpm install`, `pnpm test`, `pnpm typecheck`, `pnpm format:check`, `pnpm build` all work from the repo root.
- [x] Worker and CLI both import types/constants from `@r2-fastlink/core` (no duplicated API shapes).
- [x] Core has unit tests for duration parsing/formatting (packages/core/src/duration.test.ts).


## Notes

**2026-10-02T20:05:52Z**

Implemented and reviewed in PR #1 (branch feat/phase-1-worker-cli); closed as part of the epic setup.
