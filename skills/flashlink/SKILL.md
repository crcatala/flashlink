---
name: flashlink
description: Share a file, folder or command output as a short public link that expires on its own, and refresh or revoke such links, using the fl CLI (flashlink). Use when you need to hand a screenshot, log, build artifact or generated file to the user or to another machine or agent, when you are given an flashlink URL (https://<host>/<8 characters>) that has expired, or when the user says to upload, share, re-open or close a link.
---

# fl: short self-expiring share links

`fl` uploads a file to the user's own Cloudflare R2 bucket and prints a short public URL such as `https://fl.example.com/k3F9xQ2m`. The link serves the raw bytes with the right `Content-Type` (no redirect, no login, no JavaScript), so `curl` or a fetch tool can read it. It stops working on its own (default 1 hour). The same URL can be re-opened later.

## Before you start

Run `fl --version`. If it is not installed, `npx flashlink` works (Node 22.12+). Then check it is configured: `fl status` prints the server's limits, or fails with a message saying what is missing.

Configuration comes from `~/.config/flashlink/config.json` (written by `fl init`) or from environment variables, which win over the file:

- `FLASHLINK_ENDPOINT`: the Worker URL, for example `https://fl.example.com`
- `FLASHLINK_TOKEN`: the upload token
- `FLASHLINK_TTL`: default lifetime, for example `1h`

In a sandbox, container or CI job, pass the token as an **environment variable** (a secret of that environment). Never put it on a command line, in a file you create, in a commit or in output you print, and never echo `fl config` output that includes it. If `fl` is not configured and you were not given a token, ask the user; do not guess.

**The token is not scoped.** Whoever holds it can upload, refresh, revoke and delete _every_ link on that deployment, not just the ones you made. Treat it like a password and do not forward it to anything else.

## Rules that matter

1. **A link is public to anyone who has the URL, until it expires.** Do not upload secrets (`.env` files, private keys, tokens, credentials, cookies, password databases) or anything private the user did not ask you to share. `fl up` refuses files that look like secrets and exits 1; that is a safety net with a small pattern list, not a guarantee that other files are safe. **Do not pass `--allow-secrets` (or `-y`, `--yes`) on your own**, and do not turn the check off with `config set warnSecrets false`. If the user explicitly tells you to share a flagged file, say what it is flagged for and use `--allow-secrets` only then.
2. **Use the shortest lifetime that works.** The default is 1 hour. For a one-off hand-off use `--ttl 15m`; use `--max-downloads 1` (`-d 1`) when only one fetch is expected (counts every successful fetch, ranged ones too, so a client that reads in ranges can be cut off and `-d` is only for plain `curl`/`wget` fetches). You can always `refresh` later; you cannot take back a link that sat open for a week. The server refuses lifetimes over its maximum (7 days by default) with `ttl_too_long`.
3. **Say what you uploaded.** Tell the user the URL, the file name, and when it expires. Revoke what you no longer need.
4. **Only touch links you made, or were told to.** The token can manage all links; that is not permission to.

## The CLI contract

- **stdout is the URL and nothing else** (one line per uploaded file). Progress, confirmations and errors go to **stderr**. So `URL=$(fl up report.pdf --no-copy)` is safe.
- **Exit code:** 0 on success; 1 on any failure (bad option, file problem, server error, refused secret). With several files, the exit code is 1 if any failed, while the links that did upload are still printed.
- **Pass `--no-copy` when scripting or running headless.** Without it, `fl` copies the URL to the clipboard where a clipboard tool exists. It is harmless but pointless for you, and on the user's own machine it would overwrite their clipboard.
- **`--json` is the machine-readable mode.** `up --json` prints the full result object (`code`, `filename`, `contentType`, `size`, `createdAt`, `expiresAt`, `maxDownloads`, `hits`, `url`, `urlWithName`). With several files `up --json` always prints a single JSON array in argument order: the result object for each file that uploaded and `{"file","error","message"}` for each that failed, with nothing on stderr. The exit code is 1 if any file failed, so on a partial failure read the array and **do not re-run the whole command**: the files that succeeded already have live links, and a re-run would upload them again under new codes. For a single failure (or any failure before the files are looked at, such as a bad option or a missing token) it prints one line `{"error":"<code>","message":"..."}` on stdout, leaves stderr empty and exits 1. `error` is the server's code for API failures (`unauthorized`, `ttl_too_long`, `file_too_large`, `not_found`, ...) and `cli_error` for local problems (missing file, bad option, secret refused, not configured). `--json` never prompts.
- Options must come **before** `--`: after it, everything is a file name. For a file whose name starts with a dash, write `fl up --no-copy -- -odd.txt`.
- Do not pipe `fl` into `head` or anything that may close the pipe early: Node then dies with an `EPIPE` stack trace. Capture the output in a variable or a file instead.
- There is no prompt to answer: without a terminal, anything that would ask (the secret warning) is refused instead.

## Upload

```sh
fl up build.log --ttl 15m --no-copy              # prints the URL
fl up shot.png --ttl 2h --with-name --no-copy    # https://host/k3F9xQ2m/shot.png (name is cosmetic)
fl up a.png b.png --no-copy                      # one URL per line, in order
some-command 2>&1 | fl up --name out.txt --ttl 15m --no-copy   # from stdin; --name sets the file name
fl up my-project --exclude '*.tmp' --no-copy     # a folder: uploads my-project.zip
fl up report.pdf --ttl 1h --json --no-copy       # full result as JSON
```

- Files over 50 MB (the default cap) are refused (`file_too_large`); so are empty files. Do not retry; split or shrink the file.
- Lifetimes look like `30s`, `15m`, `2h`, `1d`, `1h30m`.
- A **folder** is zipped in memory (no `zip` command needed). `.git/`, `node_modules/` and, inside a git repository, whatever `.gitignore` ignores are left out. The 50 MB limit applies to the zip. A flagged secret inside the folder refuses the whole upload and names the file; fix that by excluding it with `--exclude`, not by overriding the warning.
- Check the result when it matters: `curl -sI <url>` should answer `200` with the expected `Content-Type` and `Content-Length`.

## Refresh: re-open a link that expired

Use this when you are given a link that now returns `410 Gone` (`{"error":"gone","message":"This link has expired."}`), or when a link must outlive its original window.

```sh
fl refresh https://fl.example.com/k3F9xQ2m --ttl 30m --no-copy   # a URL or just the code: k3F9xQ2m
```

- The **same URL** works again for a new window **counted from now** (not added to the old one). It prints the URL on stdout. With no argument it refreshes the latest upload in _this machine's_ history, so name the link explicitly when you did not just upload it.
- Refreshing works for any link the server still has, even one this machine never uploaded. It also gives a link that hit its `--max-downloads` limit a fresh set of downloads.
- **Purged links:** the server deletes the file 7 days after expiry (or at once after `revoke --purge`), and a refresh then fails with `Link <code> has been purged from the server`, unless the original local file is still where it was and unchanged: then it is re-uploaded under the same code. A link that came from stdin, a zipped folder, another machine or a changed file cannot be. Run `fl up` again for a new URL, and tell the user the URL changed.
- A link that returns `404` with `{"error":"not_found"}` was never valid, has been purged, or has a mistyped code. Link codes are exactly 8 characters from `1-9A-HJ-NP-Za-km-z` (no `0`, `O`, `I` or `l`).

## Revoke: close a link early

```sh
fl revoke k3F9xQ2m             # stops serving now; refresh can re-open it
fl revoke k3F9xQ2m --purge     # also deletes the stored file from the server
```

Both print a confirmation on stderr, nothing on stdout, and exit 0. Use `--purge` when the content should not stay on the server at all. **A purge does not retire the URL for good:** the code stays valid, and `fl refresh <code>` on the machine that uploaded it re-uploads the original file under the same URL if that file is still there unchanged (a refresh from any other machine fails once the file is purged). So do not refresh a link you purged, and if the content itself is sensitive, assume anyone who already fetched it has a copy. Revoking an unknown code exits 1 (`no longer exists on the server`).

## Look things up

```sh
fl ls --json                   # this machine's upload history (live and expired), newest first
fl ls --live --json            # only links that are live
fl status --json               # the server's limits and usage
```

History lives only on the machine that uploaded. It is not a list of everything on the server, and `ls` on a fresh sandbox is empty even when links exist.

## Troubleshooting

| You see                          | Meaning and what to do                                                                                                  |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `unauthorized`                   | The token is wrong or missing. Check `FLASHLINK_TOKEN` and `FLASHLINK_ENDPOINT`. Ask the user; do not try other values. |
| "fl is not configured yet"       | Set `FLASHLINK_ENDPOINT` and `FLASHLINK_TOKEN`, or run `fl init` if the user wants it saved.                            |
| `Looks like it contains secrets` | Rule 1. Do not override on your own. Tell the user which file and why, and let them decide.                             |
| `file_too_large`, `Empty file`   | The file is over 50 MB or has no bytes. Do not retry.                                                                   |
| `ttl_too_long`                   | Ask for less than the server maximum (`fl status` shows it).                                                            |
| `daily_limit` or `storage_full`  | The deployment's upload or storage ceiling was reached. Report it to the user instead of looping.                       |
| `410 Gone` on a link             | Expired, revoked or out of downloads. `fl refresh <url>` if the user wants it back.                                     |
| `503 rate_limited` on a link     | Too many requests. Wait a few seconds and try once more; do not hammer.                                                 |

## Out of scope here

This skill does not deploy the Worker or create tokens. Those are one-time steps the user does with Cloudflare (see the project README). An MCP server and restricted tokens are not available yet.
