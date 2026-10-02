---
id: rf-dek6
status: open
deps: []
links: []
created: 2026-10-02T20:05:52Z
type: epic
priority: 1
assignee: cc-vps
tags: [epic, r2-fastlink]
---
# r2-fastlink: self-expiring short share links on Cloudflare R2

## Why
Sharing a local file with a coding agent (usually one running on another machine) is clumsy, and public upload services leave files up forever. r2-fastlink makes it one step: upload a file to MY OWN Cloudflare R2 bucket, get a SHORT public URL, and the URL stops working on its own (default 1 hour). Later the SAME URL can be re-opened for another window.

## Goals
- One command (CLI) or one right-click (Finder) from file to URL on the clipboard.
- Agent-friendly links: the plain short link serves raw bytes with the right Content-Type. No redirect, no login, no JS, no interstitial.
- Expiry configurable globally and per upload, with server-enforced ceilings. Refresh keeps the same short code. Revoke closes early.
- Local-only upload history (the server exposes no listing endpoint).
- Sane limits (50 MB default file cap) and a bounded blast radius for cost and abuse.
- Single-user and trivially self-deployable: the repo is meant to go public so anyone can fork it and deploy to their own Cloudflare account (free plan must work).

## Non-goals
Multi-user accounts, a hosted service, a web UI for uploading/listing (the web surface is a static landing page only), Windows support.

## Architecture (summary; full detail in docs/PLAN.md)
Private R2 bucket + one Cloudflare Worker (Hono) + exactly ONE SQLite-backed Durable Object ("Registry") that owns link state (code -> object, expiry, counters, quotas) and a sweeper alarm. The Worker serves GET/HEAD /<code> by asking the Registry (one DO call, which also records the hit) and streaming the object from R2. The DO never touches file bytes. Expiry is enforced server-side on every request, which is what makes a stable, refreshable short URL possible (presigned URLs would be long and change on refresh). A TypeScript CLI (`r2fl`) and (phase 2) a macOS Quick Action are the clients.

## Repo orientation (for agents picking up a ticket)
- docs/PLAN.md: architecture, decisions and rationale, abuse + cost model, phases. READ the sections your ticket cites.
- packages/core: shared types, constants, duration parsing, typed API client (FastlinkClient).
- packages/worker: src/registry.ts (Durable Object), src/serve.ts (public fetch path), src/api.ts (authenticated /api), src/http.ts (helpers), wrangler.jsonc, public/ (landing page), test/ (vitest in workerd).
- packages/cli: src/commands/*.ts, src/history.ts, src/config.ts, test/ (vitest with an in-memory fake server in test/harness.ts).
- Commands: `pnpm install`; `pnpm test`; `pnpm typecheck`; `pnpm format` / `pnpm format:check`; `pnpm build` (CLI); local backend: `cd packages/worker && echo 'UPLOAD_TOKEN=dev-token-0123456789abcdef' > .dev.vars && pnpm exec wrangler dev` (port 8787).
- Node >= 22.12 (dependency requirement). Only `.dev.vars`-style secrets stay local; never commit tokens.

## Invariants every ticket must preserve (violating these breaks the design)
1. EXACTLY ONE Durable Object instance (see packages/worker/src/stub.ts). Never create DOs per link, per IP or per user. No WebSockets, no timers/intervals, no unawaited work in the DO. The sweeper alarm is only scheduled for the next due cleanup.
2. The DO returns metadata only; file bytes go Worker <-> R2 directly.
3. Public fetch path order is: validate code format -> per-IP rate limit -> global rate limit -> ONE registry call -> R2. Malformed codes and rate-limited requests must never touch the DO (tests assert this).
4. Every Worker response is `Cache-Control: no-store` (a cached 404/410 would hide a refreshed link).
5. The CLI prints ONLY the URL(s) on stdout (scriptable); human output goes to stderr; `--json` prints the full result.
6. R2 stays private. Anyone holding a link can fetch until expiry; treat that as the security model.
7. Tests required for every behavior change: Worker tests run in workerd via @cloudflare/vitest-pool-workers; CLI tests use the fake server in packages/cli/test/harness.ts. New regression tests should fail on the old behavior.
8. Update README.md and docs/PLAN.md when behavior, defaults or decisions change.

## Phases (child tickets, in order)
- Phase 1 (DONE, PR #1): Worker + Durable Object + R2, `r2fl` CLI, landing page, plus post-review hardening. Open follow-ups: verify on real Cloudflare, CI, license, npm publish.
- Phase 2: macOS Finder Quick Action (first pass; no native Swift app yet).
- Phase 3: extras and ideas (clipboard/screenshot upload, folder zip, agent skill/MCP, secret scan, deploy button, large files, native menubar app, ...). Not committed; prioritize after phase 2.

## Epic done when
Phases 1 and 2 tickets are closed, a real deployment has been verified end to end, and the repo is ready to be made public (license chosen, CI green, README deploy path verified).


## Notes

**2026-10-02T20:06:16Z**

Recommended order for remaining work: (1) rf-rxkx verify on a real Cloudflare account, rf-cl6p CI, rf-cr7d license (needs owner); (2) phase 2 in dependency order: rf-hx3f -> rf-0q8c -> rf-smnk -> rf-e9az (the last needs a Mac and the owner); (3) rf-od5l npm publish (needs owner) can happen any time after CI and license; (4) phase 3 ideas only after phase 2 is verified, in rough priority: rf-chq2 secret warning, rf-4514 clipboard upload, rf-gah1 folder zip, rf-xxew agent skill/MCP, rf-dd4u download-cap policy, rf-dt1g setup script, then the P4 items. Tickets tagged needs-human require the repo owner (decisions, a real Cloudflare account or a Mac); agents should do everything else and leave precise notes.

**2026-10-02T20:20:30Z**

PR batching (sequential, one PR per batch; tag batch-NN on each ticket, lowest open batch goes next): 01 CI | 02 real-deploy verification runbook+script (human runs it) | 03 CLI --notify + JSON errors | 04 macOS Quick Action + picker + docs (human Mac QA) | 05 license + npm release prep (human decides/publishes) | 06 secret warning | 07 clipboard upload + folder zip | 08 download-cap policy | 09 agent skill/MCP | 10 setup script + deploy button | 11 large files | 12 edge cache | 13 history decision | 14 menubar app design. Batches 11-14 are P4 ideas: an agent should ask before starting them. Prompt: docs/AGENT_PROMPT.md.
