---
id: rf-chq2
status: closed
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

- [x] Each pattern has positive and negative unit tests; matches never echo the secret value.
- [x] TTY prompt, non-TTY refusal and the override flag are tested through the Context abstraction.
- [x] `warnSecrets` config key works (documented in README and `r2fl config`).
- [x] No measurable slowdown for large binary uploads (binary files are skipped).


## Notes

**2026-10-03T21:42:48Z**

Done on branch batch-06-secret-warning (PR opened from it). New packages/cli/src/secrets.ts (pure: filename rules + content rules, findings carry rule name and line numbers only), wired into 'up' via confirmSecrets(); new config key warnSecrets (default true, in 'r2fl config'); flags --allow-secrets and -y/--yes; new Context.interactive (stdin and stderr TTYs). TTY: shows what matched and asks [y/N]; non-TTY (scripts, stdin, Quick Action): refuses with an error naming the override, so the --notify notification explains it. Deviations: (1) generic api-key pattern requires a 16+ char value (a bare 'api_key:' would flag 'apiKey: string' in any source file); (2) .env.example/.sample/.template and id_*.pub are exempt; (3) 'refresh' does not rescan (it re-sends a file that already passed). Evidence: 10 new up tests fail on the old up.ts; CLI tests 263 pass; ran built CLI against wrangler dev (refuse, JSON error, override, multi-file, warnSecrets off) and a real PTY prompt capture. Perf: 50MB binary 0.4ms, 50MB text 16ms (first 2MiB only).

**2026-10-03T23:11:25Z**

Review follow-up on PR #16 (3 findings, all valid and fixed): (1) --name renamed a flagged file past the filename rules; the source file's real basename is now checked too (deduped by rule). (2) --json never prompts any more (treated as non-interactive: refuses, stderr empty), matching the documented --json contract. (3) up --notify with several files now puts the first failure's reason (basename: message + hint) in the failure notification instead of only 'N of M uploads failed.'; stderr output without --notify is unchanged. 3 new tests fail on the previous up.ts; one existing assertion on the bare notification body was updated on purpose. README and PLAN updated.
