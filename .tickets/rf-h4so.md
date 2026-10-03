---
id: rf-h4so
status: open
deps: []
links: [rf-xxew]
created: 2026-10-03T21:29:33Z
type: feature
priority: 4
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, agent, idea, security, deferred]
---
# Agent integration, later: MCP server and scoped (restricted) tokens

## Why
Split out of `rf-xxew` on 2026-10-03. The skill file (`rf-xxew`) covers what agents need today, since they can already run the CLI. An MCP server and a restricted token class are heavier and only pay off if agents end up running in environments where the owner would rather not hand over the full token. Parked until dogfooding shows that need.

## Design

- Optional MCP server (`packages/mcp`) wrapping `FastlinkClient` from packages/core with tools `upload_file`, `refresh_link`, `revoke_link`, `link_status`. It reads the same config/token as the CLI. Keep the surface minimal and require absolute file paths.
- The security question: the upload token grants upload + management of ALL links. Consider a second, restricted token class on the server (for example refresh/revoke-only, or upload-only with a lower size cap) so an agent environment does not hold the owner's full token. That is server work: tests for auth scopes in packages/worker/test, and the single-token model in docs/PLAN.md section 3 must be revisited.
- Agents in a different environment than the owner (for example a Linux dev container) need a safe way to receive config without printing tokens in logs.
- Start from the decision, not the code: record in a note whether the skill file alone is enough.

## Acceptance Criteria

- [ ] A decision is recorded (note) on whether an MCP server and/or scoped tokens are needed, with rationale.
- [ ] If an MCP server is added: tools covered by tests against the fake server, README documents setup for Claude Code, no secrets in logs or tool output.
- [ ] If scoped tokens are added: implemented with tests and docs/PLAN.md section 3 updated.

