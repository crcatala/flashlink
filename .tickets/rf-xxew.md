---
id: rf-xxew
status: closed
deps: []
links: [rf-h4so]
created: 2026-10-02T20:05:53Z
type: feature
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, agent, idea, security, batch-08]
---
# Agent skill: SKILL.md so coding agents can use r2fl (MCP and scoped tokens split out)

## Why
The consumers of these links are coding agents. A skill (instructions) lets an agent create, refresh and revoke links itself, for example refreshing a link it was given that has expired, or sharing a generated artifact back to the user. A skill file is cheap (a markdown document over the CLI that already exists), so it ships early. The MCP server and restricted tokens were split out into `rf-h4so` (parked).

## Design

- A Claude Code skill file in the repo (e.g. `skills/r2fl/SKILL.md`) documenting the CLI contract agents rely on: stdout = URL only, `--json`, exit codes, `refresh`, `revoke`, ttl guidance, never upload secrets or anything private. Verify the guidance by actually driving the CLI from an agent against `wrangler dev`.
- Say plainly in the skill that the configured token can manage ALL links, and how an agent in another environment should receive config (environment variable, not printed in logs).
- Mention how to install the skill (README).
- The token-scope question is NOT decided here: record in a note that it was deferred to `rf-h4so`, plus anything the skill validation showed about it.

## Acceptance Criteria

- [x] Skill file exists and was validated by an agent actually performing upload + refresh + revoke with it.
- [x] README documents where the skill lives and how to install it.
- [x] A note records that the MCP server and scoped tokens were deferred to `rf-h4so`, with anything learned during validation.

## Notes

**2026-10-03T21:29:57Z**

2026-10-03 reorder: now batch-08 and narrowed to the skill file only. The MCP server and the scoped-token question moved to rf-h4so (parked). Rationale: the skill is a markdown file over the existing CLI and agents benefit from it during dogfooding; the MCP server and a second token class are real work with no demonstrated need yet.

**2026-10-03T23:37:29Z**

2026-10-03 batch-08 (branch batch-08-agent-skill). Added skills/r2fl/SKILL.md, a README 'Agent skill' section (install: symlink from a clone, or gh api for the private repo), a PLAN note, and packages/cli/test/skill.test.ts (front matter, every r2fl command/option shown exists in the real CLI --help, key rules present; verified it fails when a bogus flag is added). VALIDATION: I (the authoring agent, not a fresh one) followed only the skill's commands from a clean env (R2FL_ENDPOINT/R2FL_TOKEN/R2FL_*_DIR only) against wrangler dev: upload with --ttl 2s (stdout is only the URL), real expiry -> 410, refresh by URL (same code, 200), revoke (410, empty stdout, exit 0), refresh re-opens a revoked link, revoke --purge -> 404, stdin --name --json, folder zip (node_modules left out), secret refusal (exit 1, JSON error), bad-token JSON error shape. Corrections the validation forced into the skill: refresh DOES re-open a download-capped link (window hits reset); refresh works for links this machine never uploaded; options must precede '--'; purged-from-another-machine error text; not-configured text; quota codes are daily_limit/storage_full; codes are base58 not [A-Za-z0-9]; pass --no-copy; r2fl status | head crashes with an EPIPE stack trace (existing CLI wart, noted in the skill, NOT fixed here). DEFERRED to rf-h4so: MCP server and scoped tokens. Learned for the token-scope question: the single token can upload/refresh/revoke/purge EVERY link, and refresh needs no local history, so an agent holding the token can re-open any link whose code it knows; the skill says this plainly and tells agents to touch only their own links. That is the main argument for restricted tokens in rf-h4so.
