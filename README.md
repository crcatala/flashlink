<p align="center"><img src="docs/assets/logo.svg" alt="flashlink logo" width="96" height="96" /></p>

# flashlink

Upload a file to your own Cloudflare R2 bucket and get back a **short, public link that expires on its own**. Built for handing assets (screenshots, logs, zips, videos) to coding agents without leaving anything lying around.

```
$ fl up screenshot.png --ttl 2h
✓ screenshot.png (1.2 MB) · expires 14:32
https://fl.example.com/k3F9xQ2m
```

- **Short links.** An 8-character code, served directly (no redirect, no login, no JS), so an agent can `curl` it. A trailing filename (`/k3F9xQ2m/shot.png`) is optional and ignored.
- **Self-expiring.** Default 1 hour, configurable globally and per upload. Expired links return `410 Gone`.
- **Refreshable.** `fl refresh <code>` re-opens the _same_ link for another window; `fl revoke <code>` closes it early.
- **Local history.** Your upload history lives on your machine only. The server keeps just enough state to serve and expire links.
- **Guardrails.** 50 MB file cap, 7 day max lifetime, storage and daily-upload ceilings, rate limiting, and a Durable Object design that keeps usage costs bounded.
- **Single-user, self-hosted.** One Cloudflare Worker + one Durable Object + one private R2 bucket. Fork it and deploy it to your own account; the free plan is enough.

## Status

Phase 1 (Worker, Durable Object, CLI, landing page) is implemented. Phase 2 (the Finder Quick Action) is implemented and has been verified on macOS 26. See [`docs/PLAN.md`](docs/PLAN.md) for the architecture, key decisions and the roadmap.

| Phase | Scope                                                             | Status |
| ----- | ----------------------------------------------------------------- | ------ |
| 1     | Worker + Durable Object + R2, `fl` CLI, landing page              | done   |
| 2     | macOS Finder Quick Action                                         | done   |
| 3+    | Extras (folder zip and agent skill done; clipboard upload parked) | ideas  |

## How it works

```
 fl / Quick Action ──upload──────▶ Worker ──▶ R2 (private bucket)
                                   │
 agent ──GET /k3F9xQ2m──▶ Worker ──┼──▶ Registry Durable Object (code → object, expiry)
                                   └──▶ streams the object if the link is live
```

R2 stays private. The Worker enforces expiry on every request, which is what lets a short link stay stable across refreshes. The Durable Object only ever holds metadata; file bytes go straight between the Worker and R2.

## Deploy your own

You need a Cloudflare account, Node 22.12+ and [pnpm](https://pnpm.io).

**One command.** Log in once, then let the setup script do the steps below:

```sh
git clone https://github.com/crcatala/flashlink && cd flashlink
pnpm install
pnpm --filter @flashlink/worker exec wrangler login   # once
pnpm setup:cloudflare                                   # add --dry-run to see the plan first
```

It creates the private bucket, deploys the Worker, generates a token and stores it as the Worker secret `FLASHLINK_TOKEN` (sent to wrangler on stdin, never as an argument or into a file), adds the 30-day lifecycle rule, then prints your URL, the token **once**, and the `fl init` command to run next. It is safe to re-run: it reuses the bucket and rule, redeploys, and keeps your existing token (`--rotate-token` replaces it, and the old one stops working). It stops instead of guessing if it cannot read the state of your account. It deploys to `*.workers.dev`; to change the limits, edit `packages/worker/wrangler.jsonc` before running it (see below). (It is `setup:cloudflare` because `pnpm setup` is a built-in pnpm command.)

**Step by step.** The same thing by hand, if you prefer to see each command:

```sh
git clone https://github.com/crcatala/flashlink && cd flashlink
pnpm install
cd packages/worker

# 1. Create the private bucket (name must match wrangler.jsonc). --no-update-config stops
#    wrangler from offering to add a second, redundant binding to wrangler.jsonc
pnpm exec wrangler r2 bucket create flashlink --no-update-config

# 2. Set your token (a long random string; keep it secret). The CLI and scripts use the same
#    value, under the same name: `fl init` asks for it, or set FLASHLINK_TOKEN in your shell
openssl rand -hex 32            # copy this value...
pnpm exec wrangler secret put FLASHLINK_TOKEN   # ...and paste it when prompted

# 3. Safety net: delete any object older than 30 days, even if the Worker's own cleanup
#    never ran (the Worker removes files 7 days after expiry; this only catches strays)
pnpm exec wrangler r2 bucket lifecycle add flashlink expire-strays objects/ --expire-days 30 -y

# 4. Deploy
pnpm exec wrangler deploy
```

Wrangler prints your `*.workers.dev` URL. If `wrangler r2 bucket create` ever asks "Would you like Wrangler to add it on your behalf?" (older versions, or if you left out `--no-update-config`), answer **no**: `wrangler.jsonc` already binds the bucket as `BUCKET`, and accepting adds a redundant second binding and reformats the file. `wrangler.jsonc` also sets `workers_dev: true` and `preview_urls: false` so deploys do not warn; preview URLs would put every uploaded version of the Worker on extra public hostnames. To use your own domain, add a custom domain or route to the Worker in the Cloudflare dashboard (and optionally set `PUBLIC_BASE_URL` in `wrangler.jsonc`).

To confirm a deployment works end to end (uploads of several sizes, `Range`/`HEAD`, `no-store`, expiry and refresh, rate limiting), run `FLASHLINK_TOKEN=<token> node scripts/verify-deployment.mjs --endpoint https://<your-worker>`; [`docs/VERIFY_DEPLOYMENT.md`](docs/VERIFY_DEPLOYMENT.md) explains it and lists the checks that need the Cloudflare dashboard. The functional checks passed on a real account (see the phase 1 notes in [`docs/PLAN.md`](docs/PLAN.md)); the in-Worker rate limiter is active but lenient (Cloudflare's binding is approximate by design), so treat it as a deterrent and add a WAF rate-limit rule and billing alerts if you want hard protection.

Limits are plain vars in [`packages/worker/wrangler.jsonc`](packages/worker/wrangler.jsonc) (`MAX_FILE_BYTES`, `MAX_TTL_SECONDS`, `MAX_TOTAL_BYTES`, `MAX_UPLOADS_PER_DAY`, `PURGE_GRACE_SECONDS`). Rate limits live in the `ratelimits` block.

**On a paid plan?** Durable Object costs are bounded by design (a single instance, no timers or WebSockets, and the cleanup alarm only runs when something is due), but turn on [usage notifications](https://developers.cloudflare.com/notifications/) in the Cloudflare dashboard anyway. See [the cost model](docs/PLAN.md#5-cost-model).

## Install the CLI

```sh
npm i -g flashlink                  # or run it without installing: npx flashlink --help
fl init --endpoint https://fl.example.com      # prompts for your upload token
```

Works on macOS and Linux (Node 22.12+). Releases are published by the maintainer (see [Releasing](#releasing)); if `npm i -g flashlink` reports that the package does not exist, no release has been published yet, so install from a clone instead:

```sh
pnpm install && pnpm build
ln -s "$PWD/packages/cli/dist/index.js" ~/.local/bin/fl   # or anywhere on your PATH
```

On a Mac without Node, the [Finder integration](#finder-integration-macos) installs a standalone `fl` that needs no Node at all.

## Using it

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

Only the URL goes to stdout, so it composes: `curl -s "$(fl up shot.png --no-copy)"`. Add `--json` for the full result.

**Download limit.** `-d/--max-downloads N` closes the link (`410`) after N downloads. Every `GET` that the server can answer counts, whole file or `Range` request alike; `HEAD`, unsatisfiable ranges (`416`) and requests for a link that is gone or used up do not. It is meant for plain fetches (`curl`, `wget`, an agent reading the file once). **Clients that read a file in several ranges (video players, resumable downloaders, some browsers' first probe) use one count per request**, so with any N the last allowed request can leave them with a truncated file and the next one gets `410`: do not use `-d` for those. A request that finds the stored file missing still counts. `fl refresh` gives the link a fresh set of downloads. The `hits` and `lastHitAt` fields (in `--json` output) follow the same counting, with or without a limit.

**Folders.** `fl up <folder>` zips the folder and uploads `<folder>.zip` (`application/zip`), with everything under a `<folder>/` directory inside the archive, so unzipping gives you the folder back (file permissions are kept; empty folders are not). The zip is built in memory, so it needs no `zip` command and leaves no temporary file, and the size limit applies to the **zipped** size (a big folder of text is fine; it stops as soon as the zip passes the limit, and refuses at once if the files add up to more than 20 times the limit). Left out: `.git/` and `node_modules/` at any depth (point `fl up` at one of them directly to include it; if a git repository ignores it, as it usually does, add `--no-gitignore` too, otherwise there is nothing left to zip), anything matching `--exclude <glob>` (repeatable; gitignore-style: `*.log` matches at any depth, `build/` only folders, `/dist` and `docs/**/*.md` are anchored to the folder you passed), and, inside a git repository, whatever `.gitignore` ignores (tracked and untracked files are both included; `--no-gitignore` disables this. Inside a repository `git` is needed to read the ignore rules; if it is missing or fails, `up` stops and tells you so rather than guessing, and `--no-gitignore` is the way out. Outside a repository `git` is not used). Symlinks are never followed out of the folder (every path is resolved first, so a symlinked parent folder cannot lead out either): a link to a file inside it is stored as that file, anything else (a link elsewhere, to a folder, or a broken one) is skipped, and the number skipped is reported. The [secret warning](#using-it) checks every file that goes into the zip and names the ones it flags. `--name` renames the upload (it is still a zip). `fl refresh` keeps working while the server still has the file, but once it has been purged a zipped folder **cannot be re-uploaded** (a zip is not reproducible: it depends on timestamps and the exclusions used), so it fails with a message to run `fl up <folder>` again for a new link.

**Secret warning.** Anyone with the link can read the file, so `up` checks before uploading and stops if the file looks like it holds secrets: a file name such as `.env`, `.env.production`, `*.env`, `*.pem`, `*.key`, `*.p12`, `id_rsa` / `id_ed25519` (not the `.pub` files), `credentials*`, `.npmrc`, `.netrc` or `*.kdbx` (`.env.example`, `.env.sample` and `.env.template` are fine), or, in a text file, a private key header (`-----BEGIN … PRIVATE KEY-----`), an AWS access key ID, a GitHub or Slack token, or an `api_key = <16+ characters>` assignment. Only the first 2 MB of a text file is scanned and binary files are not scanned at all (their names still are). The warning names the rule and line numbers but never prints the matched text. At a terminal you are asked `Upload anyway? [y/N]`; with no terminal to ask (a script, stdin, the Finder Quick Action, where the error notification says why) or with `--json` (which never prompts and keeps stderr empty) the upload is refused. The real file name is checked even if you rename the upload with `--name`. `--allow-secrets` (or `-y` / `--yes`) uploads anyway, and `fl config set warnSecrets false` turns the check off. With several files only the flagged ones are skipped. It is a safety net with a deliberately small pattern list: a clean result does not prove a file is safe, and false positives are possible. `fl refresh` does not check again (it re-sends a file you already uploaded).

**`--json` failures.** With `--json` (on `up`, `refresh`, `ls`, `status`) a failed command prints one compact line to stdout, nothing to stderr, and exits 1: `{"error":"<code>","message":"..."}`. `error` is the server's error code for API failures (for example `unauthorized` or `ttl_too_long`) and `cli_error` for problems detected locally (missing file, bad option, not configured). This includes option errors caught by the parser (`up --json --bogus`). When `up --json` is given several files it always prints a single JSON array, in argument order: a result object for each success and `{"file","error","message"}` for each failure. The exit code is 1 if any failed, with nothing on stderr and no extra error line.

**`--notify` (macOS).** `fl up --notify file` posts a macOS notification with the link (one notification summarizing all files), or with the error if the upload fails (including an unreadable config file), and copies the URL to the clipboard even if `copy` is off in your config (unless you pass `--no-copy`). stdout, stderr and the exit code are unchanged, so it also works in scripts. It exists for launchers that have no terminal, such as the [Finder Quick Action](#finder-integration-macos). On other platforms it does nothing. Clicking the notification does nothing (the link is on your clipboard). With the notifier installed by `macos/install.sh`, the notification comes from "flashlink"; without it, from Script Editor, and a click opens Script Editor.

If the server has already deleted a link's file (7 days past expiry by default), `fl refresh` re-uploads the original local file under the **same code**, as long as it is unchanged.

Settings live in `~/.config/flashlink/config.json` and history in `~/.local/share/flashlink/history.json` (both honor `XDG_*`). `FLASHLINK_ENDPOINT`, `FLASHLINK_TOKEN` and `FLASHLINK_TTL` override the config.

## Agent skill

[`skills/flashlink/SKILL.md`](skills/flashlink/SKILL.md) teaches a coding agent to use the CLI: upload a file, folder or command output, refresh a link it was handed that has expired, and revoke what it no longer needs. It documents the contract agents rely on (stdout is only the URL, `--json`, exit codes), asks for short lifetimes, and tells the agent never to upload secrets or override the secret warning by itself.

Install it for Claude Code, as a personal skill (all projects) or a project skill (`.claude/skills/flashlink` inside a repository):

```sh
# from a clone (a symlink keeps it up to date with `git pull`)
mkdir -p ~/.claude/skills && ln -s "$PWD/skills/flashlink" ~/.claude/skills/flashlink

# without a clone (works while the repository is private, after `gh auth login`)
mkdir -p ~/.claude/skills/flashlink
gh api repos/crcatala/flashlink/contents/skills/flashlink/SKILL.md \
  -H 'Accept: application/vnd.github.raw' > ~/.claude/skills/flashlink/SKILL.md
```

Other agents that read an `AGENTS.md` or similar can use the same file: it is plain markdown, and everything after the front matter is the instructions.

The agent needs `fl` on its `PATH` (or `npx flashlink`) and the endpoint and token. In a sandbox or on another machine, give it `FLASHLINK_ENDPOINT` and `FLASHLINK_TOKEN` as **environment variables** rather than a config file you paste in, and keep the token out of logs and command lines. **The token is not scoped:** it can upload, refresh, revoke and purge every link on your deployment, so only give it to agents you would trust with all of them. Restricted tokens and an MCP server are not built yet (parked until the skill has been used for a while). `packages/cli/test/skill.test.ts` checks that every command and option the skill shows exists in the CLI.

## Finder integration (macOS)

Right-click a file in Finder, choose **Quick Actions → Share via flashlink**, pick how long the link should live, and a notification shows the short link, which is also on your clipboard. Select several files and you get one link each and one summarizing notification.

> Status: the wrapper and installer have automated tests (run on Linux in CI) and the whole flow was verified by hand on macOS 26.6.2 (Apple Silicon). The QA checklist below is how to repeat that.

**Install** (no clone, no Bun, no Node needed)

```sh
curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/install.sh | sh -s -- --latest
```

That downloads the latest release's standalone `fl` for your Mac (Apple Silicon or Intel), the Quick Actions and the notifier, checks each download against the release's `SHA256SUMS`, and installs them. To pin a version use `--version v0.1.0`. While the repository is private, `curl` cannot read the release, so use the GitHub CLI (`gh auth login` once); the installer falls back to it by itself:

```sh
cd "$(mktemp -d)" && gh release download --repo crcatala/flashlink --pattern install.sh && sh install.sh --latest
```

A fork sets `FLASHLINK_REPO=<you>/<fork>` for the installer. Then point the binary at your Worker (it is not on your `PATH`, and it uses the same config file as any other `fl`):

```sh
~/.local/share/flashlink/bin/fl init --endpoint https://fl.example.com
```

**Update:** run the install command again; it replaces the binary, the Quick Actions and the notifier and keeps your config and history. The new binary is tested before it replaces the old one: if it does not start on your Mac, the installer says so, keeps the binary you had and exits with an error. **Uninstall:** `curl -fsSL https://github.com/crcatala/flashlink/releases/latest/download/uninstall.sh | sh` (or `sh macos/uninstall.sh` from a clone).

**From a clone** (development, or no release yet): with the CLI installed and configured as in "Install the CLI" above,

```sh
fl init --endpoint https://fl.example.com
sh macos/install.sh                 # uses your own fl and node, found in your login shell
pnpm install:macos                  # or: build the standalone binary for this Mac (needs Bun) and install it
```

The installer copies two Quick Actions to `~/Library/Services/` and a wrapper to `~/.local/bin/fl-quick`, checks that a login shell can find `fl` and `node`, and refreshes the Services menu. Then enable them once in **System Settings → Keyboard → Keyboard Shortcuts… → Services → Files and Folders**. A folder you right-click is uploaded as a zip (see [Folders](#using-it)); the notification names a file in it if the secret warning refuses it.

| Quick Action                             | Behavior                                                                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Share via flashlink`                    | Asks for the lifetime (15 minutes, 1 hour, 1 day, 7 days). Your `defaultTtl` is preselected, so the common case is Return. A non-standard default such as `45m` is added to the list. Cancel does nothing and says nothing. |
| `Share via flashlink (default lifetime)` | No question: uses your configured `defaultTtl`. Enable only this one if the picker annoys you.                                                                                                                              |

The server still enforces the maximum lifetime (7 days by default); if it refuses the choice the notification shows the error.

**The standalone binary (no node or PATH needed).** The release's `flashlink-darwin-arm64` / `flashlink-darwin-x64` is the CLI compiled with [Bun](https://bun.sh) into one file (about 60 to 70 MB). The installer copies it to `~/.local/share/flashlink/bin/fl` (with `flashlink` next to it, a symlink to `fl`, the same alias the npm package has), ad hoc signs it (`codesign -s -`, no developer account; it is not notarized, which is why the installer fetches it with `curl`, which sets no quarantine flag) and runs it with an empty environment to prove it starts. The Quick Actions then run that file directly. If it is missing, or cannot start (exit 126/127), they fall back to the login-shell lookup described below. It is a second copy of `fl`, used only by the Quick Actions: your own `fl` is untouched. `fl --version` prints the release and the git commit it was built from (for example `0.1.0 (a1b2c3d)`; `-dirty` for a local build with uncommitted changes), and the lifetime dialog shows the same line under "Link lifetime", so you can tell a stale install from a fresh one. To build one yourself, `pnpm build:binary` (or `sh scripts/build-binary.sh darwin-arm64`; it cross-compiles, so Linux works too) and `sh macos/install.sh --binary dist/bin/flashlink-darwin-arm64`; `pnpm install:macos` does both for your architecture.

Uninstalling removes both Quick Actions, the wrapper, the notifier and the standalone binary; your config and history are left alone.

**How it works.** (Without the standalone binary.) Quick Actions run with a minimal `PATH` that has neither `fl` nor `node`. `install.sh` therefore records the folders where **your Terminal** finds them in `~/.config/flashlink/quick-action-path` (one line of colon-separated folders; edit it by hand if you like), and the wrapper puts them in front of `PATH`. Everything runs in your login shell (`/bin/zsh -l`); if `fl` is still not found, for example after mise or nvm moved to a new Node version, it retries once in an interactive login shell, which also reads `~/.zshrc`. The actual work is `fl up --notify --ttl <choice> -- <files>`; the token and endpoint come from the normal fl config file, never from the Quick Action. Run `macos/install.sh` from a Terminal where `fl --version` works, and run it again after changing how `fl` is installed.

**Troubleshooting**

- _"Could not run fl" notification, or the installer's WARNING._ A Quick Action could not find `fl` or `node`. Run `fl --version` in your Terminal; if that works, run `sh macos/install.sh` from that same Terminal so it records the right folders. To test the way a Quick Action starts: `env -i HOME="$HOME" PATH=/usr/bin:/bin:/usr/sbin:/sbin ~/.local/bin/fl-quick --check` prints the two paths it found. If you use a version manager, check that the recorded folder still exists (`cat ~/.config/flashlink/quick-action-path`); you can also write the folders in that file yourself.
- _The action is missing from the Quick Actions menu._ Enable it in System Settings → Keyboard → Keyboard Shortcuts → Services → Files and Folders. Then run `/System/Library/CoreServices/pbs -flush`, or log out and back in. It only appears when you right-click a file or folder in Finder.
- _No notification appears._ Allow notifications for **flashlink** in System Settings → Notifications (for **Script Editor** if `macos/install.sh` could not build the notifier and printed a note). The first notification may ask for permission. The link is still copied to the clipboard.
- _Clicking a notification opens Script Editor._ The notifier app is missing: run `sh macos/install.sh` again (it needs `osacompile`, which ships with macOS). It lives in `~/.local/share/flashlink/notify/flashlink.app`.
- _macOS asks to access your Downloads (or Desktop, Documents) folder._ That is macOS's privacy protection, asked once per folder the first time a Quick Action reads a file from there. Choose Allow.
- _macOS blocks the workflow as downloaded or from an unidentified developer._ Remove the quarantine flag: `xattr -dr com.apple.quarantine ~/Library/Services/Share\ via\ flashlink*.workflow` (the installer already does this for what it copies).
- _"Looks like it contains secrets"._ The [secret warning](#using-it) refuses files such as `.env` or private keys because a Quick Action has no terminal to ask in. Upload it from a terminal with `fl up --allow-secrets -- file` if you really mean to share it.
- _Errors._ The notification carries the message (wrong token, file over the size cap, offline). Run the same upload in a terminal to see more: `fl up --notify -- file`.
- _Where things live._ Config: `~/.config/flashlink/config.json`; history: `~/.local/share/flashlink/history.json` (see `fl config path`); Quick Actions: `~/Library/Services/`; wrapper: `~/.local/bin/fl-quick`; standalone binary (if installed): `~/.local/share/flashlink/bin/fl` and the `flashlink` symlink beside it; notifier: `~/.local/share/flashlink/notify/`.

**Manual QA checklist** (run on a real Mac; record the macOS version). `sh macos/qa.sh 2>&1 | tee ~/flashlink-qa.log` walks through nearly all of it for you and checks the links' contents; the Finder-click rows (1, 11) are by hand:

| #   | Case                                                    | Expect                                                               |
| --- | ------------------------------------------------------- | -------------------------------------------------------------------- |
| 1   | One file, picker, choose "1 hour" (the default)         | Notification with the URL, URL on the clipboard, URL serves the file |
| 2   | Several files selected                                  | One link each, one summarizing notification                          |
| 3   | File name with spaces, unicode, a quote, a leading dash | Uploads; the link serves the right file                              |
| 4   | File over the 50 MB cap                                 | Error notification, no link                                          |
| 5   | Wrong token (`fl config set token ...`)                 | Error notification                                                   |
| 6   | Offline                                                 | Error notification                                                   |
| 7   | Cancel in the lifetime picker                           | Nothing uploaded, no notification                                    |
| 8   | `defaultTtl` = `45m`                                    | The picker lists "45m" and preselects it                             |
| 9   | "(default lifetime)" action                             | No picker; link expires after the configured default                 |
| 10  | `macos/uninstall.sh`                                    | Both actions disappear from the menu                                 |
| 11  | The picker window                                       | Appears in front of Finder (not hidden behind other windows)         |

## Development

```sh
pnpm install
pnpm test          # all packages (Worker tests run in workerd via @cloudflare/vitest-pool-workers)
pnpm typecheck
pnpm format
pnpm build         # the fl CLI

cd packages/worker
echo 'FLASHLINK_TOKEN=dev-token-0123456789abcdef' > .dev.vars
pnpm exec wrangler dev             # local Worker + R2 + Durable Object on :8787
```

`node scripts/verify-deployment.mjs --endpoint http://localhost:8787` (with `FLASHLINK_TOKEN` set to the `.dev.vars` token) runs the black-box deployment checks against the local Worker; add `--sweeper` and start `wrangler dev` with `--var PURGE_GRACE_SECONDS:20` to include the sweeper check.

CI (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`: `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `wrangler deploy --dry-run` for the Worker. It needs no secrets and takes its Node version from `.node-version`. It runs on `ubicloud-standard-2`; forks without Ubicloud should change `runs-on` to `ubuntu-latest`. Actions are pinned to commit SHAs. Run the same checks locally before opening a PR. A second job, `binaries`, builds the release files exactly as a release does (both darwin binaries, the support archive, `SHA256SUMS`), checks the checksums and starts the linux build, so a broken build shows up on the pull request rather than at release time.

### Releasing

Maintainers: one command from a clean `main` on your machine, logged in to npm (`npm login`) and GitHub:

```sh
pnpm release:prep     # commits since the last tag + a prompt to draft the CHANGELOG.md entries
# ...edit CHANGELOG.md under "## [Unreleased]", commit it to main...
pnpm release          # release-it: checks, bump, changelog, commit, tag, push; then npm publish
```

`pnpm release` runs format, typecheck, tests and the build, asks for the new version (or `pnpm release minor`), moves the changelog entries under it, bumps the version (one version for everything: the root `package.json`, copied into `packages/cli`), commits `chore: release vX.Y.Z`, tags and pushes. It then publishes `flashlink` to npm from your machine (npm asks for your one-time password if you use 2FA). **npm is never published from CI**, so there is no npm token in the repository and no npm provenance. `pnpm release:dry` previews the release; `pnpm release:publish` repeats just the npm step if it failed. Full flow, the first release and recovery: [`RELEASING.md`](RELEASING.md).

The pushed tag triggers `.github/workflows/release.yml`, which checks the tag against the version and the changelog, then creates the **GitHub Release** (notes taken from `CHANGELOG.md`) with `flashlink-darwin-arm64`, `flashlink-darwin-x64`, `flashlink-macos-support.tar.gz`, `install.sh`, `uninstall.sh` and `SHA256SUMS`, built on a Linux runner.

To check what npm would receive without publishing: `cd packages/cli && npm pack --dry-run` (just `dist/`, `LICENSE`, `package.json` and the README).

```
packages/core     shared types, duration parsing, API client
packages/worker   Cloudflare Worker, Registry Durable Object, landing page (public/)
packages/cli      the `fl` command
```

## License

[MIT](LICENSE), © 2026 Christian Catalan.
