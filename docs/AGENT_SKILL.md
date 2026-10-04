# Agent skill

[`skills/flashlink/SKILL.md`](../skills/flashlink/SKILL.md) teaches a coding agent to use the CLI: upload a file, folder or command output, refresh a link it was handed that has expired, and revoke what it no longer needs.

It documents the contract agents rely on (stdout is only the URL, `--json`, exit codes), asks for short lifetimes, and tells the agent never to upload secrets or override the [secret warning](CLI.md#secret-warning) by itself.

## Install it for Claude Code

As a personal skill (all projects) or a project skill (`.claude/skills/flashlink` inside a repository):

```sh
# without a clone
mkdir -p ~/.claude/skills/flashlink
curl -fsSL https://raw.githubusercontent.com/crcatala/flashlink/main/skills/flashlink/SKILL.md \
  -o ~/.claude/skills/flashlink/SKILL.md

# from a clone (a symlink keeps it up to date with `git pull`)
mkdir -p ~/.claude/skills && ln -s "$PWD/skills/flashlink" ~/.claude/skills/flashlink
```

If the repository is private, fetch the file with the GitHub CLI instead (`gh auth login` once):

```sh
gh api repos/crcatala/flashlink/contents/skills/flashlink/SKILL.md \
  -H 'Accept: application/vnd.github.raw' > ~/.claude/skills/flashlink/SKILL.md
```

Other agents that read an `AGENTS.md` or similar can use the same file: it is plain markdown, and everything after the front matter is the instructions.

## Give the agent access

The agent needs `fl` on its `PATH` (or `npx flashlink`) and the endpoint and token. In a sandbox or on another machine, give it `FLASHLINK_ENDPOINT` and `FLASHLINK_TOKEN` as **environment variables** rather than a config file you paste in, and keep the token out of logs and command lines.

**The token is not scoped:** it can upload, refresh, revoke and purge every link on your deployment, so only give it to agents you would trust with all of them. Restricted tokens and an MCP server are not built yet (parked until the skill has been used for a while).

`packages/cli/test/skill.test.ts` checks that every command and option the skill shows exists in the CLI.
