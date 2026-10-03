---
name: r2fl
description: Share a file, folder or command output as a short public link that expires on its own, and refresh or revoke such links, using the r2fl CLI (r2-fastlink). Use when you need to hand a screenshot, log, build artifact or generated file to the user or to another machine or agent, when you are given an r2-fastlink URL (https://<host>/<8 characters>) that has expired, or when the user says to upload, share, re-open or close a link.
---

# r2fl: short self-expiring share links

`r2fl` uploads a file to the user's own Cloudflare R2 bucket and prints a short public URL such as `https://fl.example.com/k3F9xQ2m`. The link serves the raw bytes with the right `Content-Type` (no redirect, no login, no JavaScript), so `curl` or a fetch tool can read it. It stops working on its own (default 1 hour). The same URL can be re-opened later.

## Before you start

Run `r2fl --version`. If it is not installed, `npx r2fl` works (Node 22.12+). Then check it is configured: `r2fl status` prints the server's limits, or fails with a message saying what is missing.

Configuration comes from `~/.config/r2fl/config.json` (written by `r2fl init`) or from environment variables, which win over the file:

- `R2FL_ENDPOINT`: the Worker URL, for example `https://fl.example.com`
- `R2FL_TOKEN`: the upload token
- `R2FL_TTL`: default lifetime, for example `1h`

In a sandbox, container or CI job, pass the token as an **environment variable** (a secret of that environment). Never put it on a command line, in a file you create, in a commit or in output you print, and never echo `r2fl config` output that includes it. If `r2fl` is not configured and you were not given a token, ask the user; do not guess.

**The token is not scoped.** Whoever holds it can upload, refresh, revoke and delete _every_ link on that deployment, not just the ones you made. Treat it like a password and do not forward it to anything else.

## Rules that matter

1. **A link is public to anyone who has the URL, until it expires.** Do not upload secrets (`.env` files, private keys, tokens, credentials, cookies, password databases) or anything private the user did not ask you to share. `r2fl up` refuses files that look like secrets and exits 1; that is a safety net with a small pattern list, not a guarantee that other files are safe. **Do not pass `--allow-secrets` (or `-y`, `--yes`) on your own**, and do not turn the check off with `config set warnSecrets false`. If the user explicitly tells you to share a flagged file, say what it is flagged for and use `--allow-secrets` only then.
2. **Use the shortest lifetime that works.** The default is 1 hour. For a one-off hand-off use `--ttl 15m`; use `--max-downloads 1` (`-d 1`) when only one fetch is expected. You can always `refresh` later; you cannot take back a link that sat open for a week. The server refuses lifetimes over its maximum (7 days by default) with `ttl_too_long`.
3. **Say what you uploaded.** Tell the user the URL, the file name, and when it expires. Revoke what you no longer need.
4. **Only touch links you made, or were told to.** The token can manage all links; that is not permission to.

## The CLI contract

- **stdout is the URL and nothing else** (one line per uploaded file). Progress, confirmations and errors go to **stderr**. So `URL=$(r2fl up report.pdf --no-copy)` is safe.
- **Exit code:** 0 on success; 1 on any failure (bad option, file problem, server error, refused secret). With several files, the exit code is 1 if any failed, while the links that did upload are still printed.
- **Pass `--no-copy` when scripting or running headless.** Without it, `r2fl` copies the URL to the clipboard where a clipboard tool exists. It is harmless but pointless for you, and on the user's own machine it would overwrite their clipboard.
- **`--json` is the machine-readable mode.** `up --json` prints the full result object (`code`, `filename`, `contentType`, `size`, `createdAt`, `expiresAt`, `maxDownloads`, `hits`, `url`, `urlWithName`). With several files it prints one JSON array in argument order. On failure it prints one line `{"error":"<code>","message":"..."}` on stdout, leaves stderr empty and exits 1. `error` is the server's code for API failures (`unauthorized`, `ttl_too_long`, `file_too_large`, `not_found`, ...) and `cli_error` for local problems (missing file, bad option, secret refused, not configured). `--json` never prompts.
- Options must come **before** `--`: after it, everything is a file name. For a file whose name starts with a dash, write `r2fl up --no-copy -- -odd.txt`.
- Do not pipe `r2fl` into `head` or anything that may close the pipe early: Node then dies with an `EPIPE` stack trace. Capture the output in a variable or a file instead.
- There is no prompt to answer: without a terminal, anything that would ask (the secret warning) is refused instead.

## Upload

```sh
r2fl up build.log --ttl 15m --no-copy              # prints the URL
r2fl up shot.png --ttl 2h --with-name --no-copy    # https://host/k3F9xQ2m/shot.png (name is cosmetic)
r2fl up a.png b.png --no-copy                      # one URL per line, in order
some-command 2>&1 | r2fl up --name out.txt --ttl 15m --no-copy   # from stdin; --name sets the file name
r2fl up my-project --exclude '*.tmp' --no-copy     # a folder: uploads my-project.zip
r2fl up report.pdf --ttl 1h --json --no-copy       # full result as JSON
```

- Files over 50 MB (the default cap) are refused (`file_too_large`); so are empty files. Do not retry; split or shrink the file.
- Lifetimes look like `30s`, `15m`, `2h`, `1d`, `1h30m`.
- A **folder** is zipped in memory (no `zip` command needed). `.git/`, `node_modules/` and, inside a git repository, whatever `.gitignore` ignores are left out. The 50 MB limit applies to the zip. A flagged secret inside the folder refuses the whole upload and names the file; fix that by excluding it with `--exclude`, not by overriding the warning.
- Check the result when it matters: `curl -sI <url>` should answer `200` with the expected `Content-Type` and `Content-Length`.

## Refresh: re-open a link that expired

Use this when you are given a link that now returns `410 Gone` (`{"error":"gone","message":"This link has expired."}`), or when a link must outlive its original window.

```sh
r2fl refresh https://fl.example.com/k3F9xQ2m --ttl 30m --no-copy   # a URL or just the code: k3F9xQ2m
```

- The **same URL** works again for a new window **counted from now** (not added to the old one). It prints the URL on stdout. With no argument it refreshes the latest upload in _this machine's_ history, so name the link explicitly when you did not just upload it.
- Refreshing works for any link the server still has, even one this machine never uploaded. It also gives a link that hit its `--max-downloads` limit a fresh set of downloads.
- **Purged links:** the server deletes the file 7 days after expiry (or at once after `revoke --purge`), and a refresh then fails with `Link <code> has been purged from the server`, unless the original local file is still where it was and unchanged: then it is re-uploaded under the same code. A link that came from stdin, a zipped folder, another machine or a changed file cannot be. Run `r2fl up` again for a new URL, and tell the user the URL changed.
- A link that returns `404` with `{"error":"not_found"}` was never valid, has been purged, or has a mistyped code. Link codes are exactly 8 characters from `1-9A-HJ-NP-Za-km-z` (no `0`, `O`, `I` or `l`).

## Revoke: close a link early

```sh
r2fl revoke k3F9xQ2m             # stops serving now; refresh can re-open it
r2fl revoke k3F9xQ2m --purge     # also deletes the stored file; the link is gone for good
```

Both print a confirmation on stderr, nothing on stdout, and exit 0. Use `--purge` when the content should not stay on the server at all. Revoking an unknown code exits 1 (`no longer exists on the server`).

## Look things up

```sh
r2fl ls --json                   # this machine's upload history (live and expired), newest first
r2fl ls --live --json            # only links that are live
r2fl status --json               # the server's limits and usage
```

History lives only on the machine that uploaded. It is not a list of everything on the server, and `ls` on a fresh sandbox is empty even when links exist.

## Troubleshooting

| You see                          | Meaning and what to do                                                                                        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `unauthorized`                   | The token is wrong or missing. Check `R2FL_TOKEN` and `R2FL_ENDPOINT`. Ask the user; do not try other values. |
| `r2fl is not configured yet`     | Set `R2FL_ENDPOINT` and `R2FL_TOKEN`, or run `r2fl init` if the user wants it saved.                          |
| `Looks like it contains secrets` | Rule 1. Do not override on your own. Tell the user which file and why, and let them decide.                   |
| `file_too_large`, `Empty file`   | The file is over 50 MB or has no bytes. Do not retry.                                                         |
| `ttl_too_long`                   | Ask for less than the server maximum (`r2fl status` shows it).                                                |
| `daily_limit` or `storage_full`  | The deployment's upload or storage ceiling was reached. Report it to the user instead of looping.             |
| `410 Gone` on a link             | Expired, revoked or out of downloads. `r2fl refresh <url>` if the user wants it back.                         |
| `503 rate_limited` on a link     | Too many requests. Wait a few seconds and try once more; do not hammer.                                       |

## Out of scope here

This skill does not deploy the Worker or create tokens. Those are one-time steps the user does with Cloudflare (see the project README). An MCP server and restricted tokens are not available yet.
