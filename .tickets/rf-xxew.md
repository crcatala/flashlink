---
id: rf-xxew
status: open
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: feature
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, agent, idea, security, batch-09]
---
# Agent integration: skill and/or MCP tool (and the token-scope question)

## Why
The consumers of these links are coding agents. A skill (instructions) and/or an MCP tool lets an agent create, refresh and revoke links itself, for example refreshing a link it was given that has expired, or sharing a generated artifact back to the user.

## Design

- Start with the cheapest option: a Claude Code skill file in the repo (e.g. `skills/r2fl/SKILL.md`) documenting the CLI contract agents rely on (stdout = URL only, `--json`, exit codes, `refresh`, ttl guidance, never upload secrets). Verify the guidance by actually driving the CLI from an agent against `wrangler dev`.
- Optionally an MCP server (`packages/mcp`) wrapping `FastlinkClient` from packages/core with tools `upload_file`, `refresh_link`, `revoke_link`, `link_status`. It reads the same config/token as the CLI. Keep the surface minimal and require absolute file paths.
- Security thinking is the real work: the upload token grants upload + management of ALL links. Consider a second, restricted token class on the server (for example refresh/revoke-only or upload-only with a lower size cap) so an agent environment does not hold the owner's full token. If added, that is server work: tests for auth scopes in packages/worker/test, and the single-token model in docs/PLAN.md section 3 must be revisited.
- Agents running in a different environment than the owner (e.g. a Linux dev container) need a safe way to receive config without printing tokens in logs.

## Acceptance Criteria

- [ ] Skill file exists and was validated by an agent actually performing upload + refresh + revoke with it.
- [ ] If an MCP server is added: tools covered by tests against the fake server, README documents setup for Claude Code, no secrets in logs or tool output.
- [ ] A decision is recorded (note) on whether scoped tokens are needed; if yes, implemented with tests and docs/PLAN.md updated.

