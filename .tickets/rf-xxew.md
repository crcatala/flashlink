---
id: rf-xxew
status: open
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

- [ ] Skill file exists and was validated by an agent actually performing upload + refresh + revoke with it.
- [ ] README documents where the skill lives and how to install it.
- [ ] A note records that the MCP server and scoped tokens were deferred to `rf-h4so`, with anything learned during validation.

## Notes

**2026-10-03T21:29:57Z**

2026-10-03 reorder: now batch-08 and narrowed to the skill file only. The MCP server and the scoped-token question moved to rf-h4so (parked). Rationale: the skill is a markdown file over the existing CLI and agents benefit from it during dogfooding; the MCP server and a second token class are real work with no demonstrated need yet.
