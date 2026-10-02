---
id: rf-dt1g
status: open
deps: [rf-rxkx, rf-cr7d]
links: []
created: 2026-10-02T20:05:54Z
type: feature
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, infra, docs, idea, needs-human, batch-10]
---
# One-command setup script and Deploy-to-Cloudflare button

## Why
Forking should be near one command. Today the README has several manual steps (bucket, secret, lifecycle rule, deploy). A setup script and/or a Deploy-to-Cloudflare button lowers the bar for the people the repo is meant for.

## Design

- `pnpm setup` (a Node script under `scripts/`, no extra deps) that: checks `wrangler whoami`, creates the bucket if missing, generates a 32-byte random token, runs `wrangler secret put UPLOAD_TOKEN` (pipe the token on stdin; never echo it to logs), adds the lifecycle rule (idempotent), runs `wrangler deploy`, then prints the exact `r2fl init --endpoint <url>` command and shows the token ONCE for the user to copy. Idempotent and safe to re-run (never regenerate the token silently).
- Evaluate Cloudflare's "Deploy to Cloudflare" button: it clones the repo into the user's account and can provision R2 and Durable Objects from wrangler config; it may not handle secrets or the lifecycle rule, so document the post-deploy steps. Needs the repo to be public (depends on the license ticket).
- Document both paths; keep the manual path as the reference.

## Acceptance Criteria

- [ ] Setup script works end to end on a clean account (owner verification, recorded in a note) and is idempotent; the token never appears in logs or in git.
- [ ] README documents script and (if viable) the deploy button, including remaining manual steps.
- [ ] Script has unit tests for its pure parts (argument handling, output formatting) and is shellcheck/lint clean.

