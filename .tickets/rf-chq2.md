---
id: rf-chq2
status: open
deps: []
links: []
created: 2026-10-02T20:05:53Z
type: feature
priority: 3
assignee: cc-vps
parent: rf-dek6
tags: [phase-3, cli, security, idea, batch-06]
---
# Warn before uploading likely secrets (.env, keys, tokens)

## Why
Links are PUBLIC to anyone with the URL. The easiest way to hurt yourself is uploading `.env`, a private key or a credentials file. A warning before upload is cheap insurance.

## Design

- Pre-upload check in the CLI (packages/cli/src/secrets.ts), pure and unit-testable: filename patterns (`.env*`, `*.pem`, `*.key`, `id_rsa*`, `id_ed25519*`, `credentials*`, `*.p12`, `.npmrc`, `.netrc`, `*.kdbx`) and content patterns on text files (PEM private key header, AWS access key id `AKIA[0-9A-Z]{16}`, GitHub tokens `gh[pousr]_...`, Slack tokens, generic `api[_-]?key\s*[:=]`). Scan only the first few MB; skip binary files.
- On a TTY: show what matched (never print the secret itself, just the pattern name and line number) and ask for confirmation. Non-TTY (scripts, Quick Action): refuse unless `--yes`/`--allow-secrets` is passed. Config key `warnSecrets` (default true) to disable.
- False positives will happen; keep the pattern set small and explain overrides in the error message.

## Acceptance Criteria

- [ ] Each pattern has positive and negative unit tests; matches never echo the secret value.
- [ ] TTY prompt, non-TTY refusal and the override flag are tested through the Context abstraction.
- [ ] `warnSecrets` config key works (documented in README and `r2fl config`).
- [ ] No measurable slowdown for large binary uploads (binary files are skipped).

