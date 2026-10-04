---
id: rf-dt1g
status: in_progress
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
- [x] README documents script and (if viable) the deploy button, including remaining manual steps.
- [x] Script has unit tests for its pure parts (argument handling, output formatting) and is shellcheck/lint clean.


## Notes

**2026-10-03T21:29:57Z**

2026-10-03 reorder: stays batch-10, which is now the last batch and the 'go public' step together with rf-cr7d. It needs rf-cr7d CLOSED (owner decision) and the repo public before the Deploy button can be tested.

**2026-10-04T00:38:47Z**

2026-10-03 batch-10 (branch batch-10-license-setup). Built: scripts/setup.mjs (spawns 'pnpm exec wrangler' in packages/worker) + scripts/setup-lib.mjs (logic with injected io) + scripts/setup-lib.d.mts, run as 'pnpm setup:cloudflare' (NOT 'pnpm setup', a pnpm built-in); options --dry-run, --rotate-token, --help. Flow: whoami -> r2 bucket info/create -> deploy -> secret list/put R2FL_TOKEN (stdin) -> lifecycle list/add. README documents it above the manual steps (kept as the reference). Deviations from the ticket: (1) secret is set AFTER deploy (secret put on a not-yet-deployed Worker asks an unanswerable question; a deployed Worker without the secret fails closed with 500); (2) the Worker secret is R2FL_TOKEN (ticket text says UPLOAD_TOKEN, renamed on 2026-10-02); (3) a failing/unparseable 'secret list' stops setup instead of assuming no secret (would overwrite the owner's token; found while writing it, regression-tested); (4) DEPLOY BUTTON NOT OFFERED: Cloudflare's docs require a subdirectory app to be fully isolated incl. dependencies, packages/worker depends on workspace @r2-fastlink/core, the button cannot add the lifecycle rule, and it needs a public repo; reasoning in PLAN section 8. Evidence: 17 new tests (pure parsers on real wrangler messages, full flow against a fake account, idempotency, token only on stdin and once in the summary, dry-run makes no wrangler call, unreadable secret list never replaces a token); real script exercised against a stand-in 'pnpm exec wrangler' (fresh run, then two re-runs: token delivered over stdin, unchanged on re-run, not in args or stderr); wrangler output formats read from wrangler 4.147 source and --help. Terminal screenshots were NOT used: the capture scanner blocked them (it flags a 64-hex 'Token:' value, here a throwaway from the stand-in, and the label 'Token:  unchanged'); artifacts deleted, a redacted transcript is in the PR instead. Criteria 2 and 3 ticked (shellcheck n/a: JS, prettier + tests). 
AWAITING HUMAN: criterion 1 needs a real, clean Cloudflare account (not verified by an agent: no real Cloudflare access). Steps: git clone, pnpm install, 'pnpm --filter @r2-fastlink/worker exec wrangler login', 'pnpm setup:cloudflare --dry-run' then 'pnpm setup:cloudflare'. Look for: all 5 steps succeed, the final summary shows URL + a 64-char token once, 'r2fl init --endpoint <url>' + pasting the token connects, 'node scripts/verify-deployment.mjs --endpoint <url>' passes. Then re-run 'pnpm setup:cloudflare': it must say bucket/secret/rule already exist, print 'Token: unchanged', and the same token must still work. Check no token in your terminal scrollback beyond the one summary and none in 'git status'. If wrangler's output formats differ from what the script expects (whoami logged-out text, secret list JSON, workers.dev URL, lifecycle rule name), it will stop with a message; record it here and tick the criterion when all of that passes. Do this on an account where the name 'r2-fastlink' is free or you are fine reusing it (the script reuses an existing bucket and Worker of that name).
