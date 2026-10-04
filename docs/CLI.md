# CLI reference

The `fl` command (also installed as `flashlink`). For a short introduction see the [README](../README.md).

## Install

```sh
npm i -g flashlink                  # or run it without installing: npx flashlink --help
fl init --endpoint https://fl.example.com      # prompts for your upload token
```

Works on macOS and Linux (Node 22.12+). From a clone of the repository instead:

```sh
pnpm install && pnpm build
ln -s "$PWD/packages/cli/dist/index.js" ~/.local/bin/fl   # or anywhere on your PATH
```

On a Mac without Node, the [Finder integration](MACOS.md) installs a standalone `fl` that needs no Node at all.

## Commands

```sh
fl up report.pdf                    # upload; prints the URL and copies it to the clipboard
fl up build.log --ttl 15m           # custom lifetime: 30s, 15m, 2h, 1d, 1h30m
fl up a.png b.png                   # one link per file
fl up big.zip -d 3                  # stop serving after 3 downloads
cat trace.txt | fl up --name trace.txt   # from stdin
fl up shot.png --with-name          # https://…/k3F9xQ2m/shot.png
fl up .env --allow-secrets          # override the secret warning (see below)
fl up my-project                    # a folder: uploads my-project.zip (see below)
fl up logs --exclude '*.tmp'        # ...leaving out matching paths (repeatable)

fl ls                               # local history (add --live, --all, --sync, --json)
fl refresh k3F9xQ2m --ttl 30m       # same link, new window (no argument: the latest upload)
fl revoke k3F9xQ2m                  # close now; refresh can re-open it
fl revoke k3F9xQ2m --purge          # also delete the stored file

fl status                           # server limits and usage
fl config                           # view settings; `config set defaultTtl 2h`
```

`up` is also `upload`, and `ls` is also `list`. Run `fl <command> --help` for every option (for example `-q/--quiet`, which prints only URLs).

Only the URL goes to stdout, so it composes: `curl -s "$(fl up shot.png --no-copy)"`. Add `--json` for the full result.

## Refresh and revoke

`fl refresh <code>` re-opens the same link for another window, whether it expired, was revoked or hit its download limit. If the server has already deleted the file (7 days past expiry by default), `fl refresh` re-uploads the original local file under the **same code**, as long as it is unchanged.

`fl revoke <code>` closes a link at once; `--purge` also deletes the stored file, so it cannot be refreshed back.

## Download limit

`-d/--max-downloads N` closes the link (`410`) after N downloads. Every `GET` that the server can answer counts, whole file or `Range` request alike; `HEAD`, unsatisfiable ranges (`416`) and requests for a link that is gone or used up do not. It is meant for plain fetches (`curl`, `wget`, an agent reading the file once).

**Clients that read a file in several ranges (video players, resumable downloaders, some browsers' first probe) use one count per request**, so with any N the last allowed request can leave them with a truncated file and the next one gets `410`: do not use `-d` for those. A request that finds the stored file missing still counts. `fl refresh` gives the link a fresh set of downloads. The `hits` and `lastHitAt` fields (in `--json` output) follow the same counting, with or without a limit.

## Folders

`fl up <folder>` zips the folder and uploads `<folder>.zip` (`application/zip`), with everything under a `<folder>/` directory inside the archive, so unzipping gives you the folder back (file permissions are kept; empty folders are not).

- **No temporary file.** The zip is built in memory, so it needs no `zip` command. The size limit applies to the **zipped** size (a big folder of text is fine; it stops as soon as the zip passes the limit, and refuses at once if the files add up to more than 20 times the limit).
- **What is left out.** `.git/` and `node_modules/` at any depth (point `fl up` at one of them directly to include it; if a git repository ignores it, as it usually does, add `--no-gitignore` too, otherwise there is nothing left to zip), anything matching `--exclude <glob>` (repeatable; gitignore-style: `*.log` matches at any depth, `build/` only folders, `/dist` and `docs/**/*.md` are anchored to the folder you passed), and, inside a git repository, whatever `.gitignore` ignores (tracked and untracked files are both included; `--no-gitignore` disables this).
- **git is needed inside a repository** to read the ignore rules. If it is missing or fails, `up` stops and tells you so rather than guessing, and `--no-gitignore` is the way out. Outside a repository `git` is not used.
- **Symlinks** are never followed out of the folder (every path is resolved first, so a symlinked parent folder cannot lead out either): a link to a file inside it is stored as that file, anything else (a link elsewhere, to a folder, or a broken one) is skipped, and the number skipped is reported.
- The [secret warning](#secret-warning) checks every file that goes into the zip and names the ones it flags.
- `--name` renames the upload (it is still a zip).
- **Refresh after purge.** `fl refresh` keeps working while the server still has the file, but once it has been purged a zipped folder **cannot be re-uploaded** (a zip is not reproducible: it depends on timestamps and the exclusions used), so it fails with a message to run `fl up <folder>` again for a new link.

## Secret warning

Anyone with the link can read the file, so `up` checks before uploading and stops if the file looks like it holds secrets:

- a file name such as `.env`, `.env.production`, `*.env`, `*.pem`, `*.key`, `*.p12`, `id_rsa` / `id_ed25519` (not the `.pub` files), `credentials*`, `.npmrc`, `.netrc` or `*.kdbx` (`.env.example`, `.env.sample` and `.env.template` are fine), or
- in a text file, a private key header (`-----BEGIN … PRIVATE KEY-----`), an AWS access key ID, a GitHub or Slack token, or an `api_key = <16+ characters>` assignment.

Only the first 2 MB of a text file is scanned and binary files are not scanned at all (their names still are). The warning names the rule and line numbers but never prints the matched text.

- At a terminal you are asked `Upload anyway? [y/N]`.
- With no terminal to ask (a script, stdin, the Finder Quick Action, where the error notification says why) or with `--json` (which never prompts and keeps stderr empty) the upload is refused.
- The real file name is checked even if you rename the upload with `--name`.
- `--allow-secrets` (or `-y` / `--yes`) uploads anyway, and `fl config set warnSecrets false` turns the check off.
- With several files only the flagged ones are skipped.
- `fl refresh` does not check again (it re-sends a file you already uploaded).

It is a safety net with a deliberately small pattern list: a clean result does not prove a file is safe, and false positives are possible.

## JSON output

With `--json` (on `up`, `refresh`, `ls`, `status`) a failed command prints one compact line to stdout, nothing to stderr, and exits 1: `{"error":"<code>","message":"..."}`.

- `error` is the server's error code for API failures (for example `unauthorized` or `ttl_too_long`) and `cli_error` for problems detected locally (missing file, bad option, not configured). This includes option errors caught by the parser (`up --json --bogus`).
- When `up --json` is given several files it always prints a single JSON array, in argument order: a result object for each success and `{"file","error","message"}` for each failure. The exit code is 1 if any failed, with nothing on stderr and no extra error line.

## Notifications (macOS)

`fl up --notify file` posts a macOS notification with the link (one notification summarizing all files), or with the error if the upload fails (including an unreadable config file), and copies the URL to the clipboard even if `copy` is off in your config (unless you pass `--no-copy`). stdout, stderr and the exit code are unchanged, so it also works in scripts.

It exists for launchers that have no terminal, such as the [Finder Quick Action](MACOS.md). On other platforms it does nothing. Clicking the notification does nothing (the link is on your clipboard). With the notifier installed by `macos/install.sh`, the notification comes from "flashlink"; without it, from Script Editor, and a click opens Script Editor.

## Settings and files

Settings live in `~/.config/flashlink/config.json` and history in `~/.local/share/flashlink/history.json` (both honor `XDG_*`; `fl config path` prints the config file's path). `FLASHLINK_ENDPOINT`, `FLASHLINK_TOKEN` and `FLASHLINK_TTL` override the config.

| Key            | Default | Meaning                                                   |
| -------------- | ------- | --------------------------------------------------------- |
| `endpoint`     | none    | Your Worker's URL                                         |
| `token`        | none    | The upload token (`FLASHLINK_TOKEN` is safer in scripts)  |
| `defaultTtl`   | `1h`    | Lifetime when `--ttl` is not given                        |
| `maxFileBytes` | 50 MiB  | Client-side pre-check (the server enforces its own limit) |
| `copy`         | `true`  | Copy the URL to the clipboard                             |
| `warnSecrets`  | `true`  | Run the [secret warning](#secret-warning)                 |

History is local only: the server keeps just enough state to serve and expire links.
