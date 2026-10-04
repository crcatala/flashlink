# r2-fastlink: plan

Status: v1. Phase 1 implemented (see section 7); the rest is planned. Last updated 2026-10-02.

## 1. Problem and goals

Sharing a local file with a coding agent (usually one running on a different machine) is clumsy. Attaching, pasting, or scp-ing all take effort, and public upload services leave the file up forever.

r2-fastlink makes it a one-step action:

1. Upload a file from the CLI or Finder to **my own** R2 bucket.
2. Get a **short** public URL back.
3. The URL **stops working on its own**, by default after 1 hour.
4. Later I can **re-open the same URL** for another window.

Goals

- Fast path: one command, or one right-click, from file to URL on the clipboard.
- Agent-friendly links: the plain short link serves the raw bytes with a correct `Content-Type`. No redirect chain, no HTML interstitial.
- Expiry is configurable globally and per upload, with server-enforced ceilings.
- Sane limits on size and storage. The tool must not be able to run up a bill.
- Local-only history of uploads and links, with refresh and revoke.
- Single-user and trivially self-deployable. The repo is meant to go public so anyone can fork and deploy it to their own Cloudflare account.

Non-goals

- Multi-user accounts, sharing permissions, or a hosted service.
- A web UI for uploading or listing. The web surface is a static landing page.
- Windows support (CLI targets macOS and Linux).
- Resumable or multipart uploads (50 MB default cap; see section 9).

## 2. Architecture

```
┌────────────┐   POST/PUT /api/links (bearer token)
│  r2fl CLI  │─────────────────────────────────────────┐
│ Quick Act. │                                         ▼
└────────────┘                              ┌────────────────────┐
                                            │   Cloudflare Worker │
┌────────────┐   GET /<code>[/name]         │   (Hono)            │
│   agent    │─────────────────────────────▶│                     │
└────────────┘                              │  1. validate code   │
                                            │  2. rate-limit      │
        static landing page (assets) ◀──────│  3. ask registry    │
                                            │  4. stream from R2  │
                                            └───┬────────────┬────┘
                                                │ RPC        │ get/put
                                                ▼            ▼
                                   ┌──────────────────┐  ┌───────────┐
                                   │ Registry DO      │  │ R2 bucket │
                                   │ (SQLite, 1 inst) │  │ (private) │
                                   │ + sweeper alarm  │  └───────────┘
                                   └──────────────────┘
```

### Components

**Worker** (`packages/worker`)

- Public routes: `GET|HEAD /<code>` and `/<code>/<anything>`.
- Authenticated routes (`Authorization: Bearer <token>`), under `/api`:
  - `POST /api/links`: upload, allocates a new code.
  - `PUT /api/links/:code`: upload under a specific code. Used to re-create a link whose object has already been purged. `409` if the code exists.
  - `GET /api/links/:code`: metadata and hit count.
  - `POST /api/links/lookup`: batch metadata for many codes (used by `r2fl ls --sync`).
  - `POST /api/links/:code/refresh`: set a new expiry from now.
  - `POST /api/links/:code/revoke`: expire immediately (still refreshable during the grace window).
  - `DELETE /api/links/:code`: purge the object and row immediately.
  - `GET /api/status`: effective limits and current usage.
- Static assets: the landing page. Asset requests are served by the platform without invoking the Worker; only unmatched paths (codes, `/api/*`) reach Worker code.

**Registry Durable Object** (`Registry`, SQLite-backed, exactly one instance)

- Table `links(code PK, r2_key, filename, content_type, size, created_at, expires_at, max_downloads, hits, last_hit_at, state)` where `state` is `pending` (allocated, bytes not yet committed) or `active`.
- Atomic operations: allocate a code (collision-free), commit an upload, resolve-and-count a fetch, refresh, revoke, purge.
- Quota enforcement: total stored bytes and uploads per day.
- A single **sweeper alarm** that deletes R2 objects and rows once `expires_at + GRACE` has passed, and reaps stale `pending` rows.

**R2 bucket**: private, no public access and no custom domain on the bucket. Object key is `objects/<code>`. An R2 lifecycle rule (30 days, `wrangler r2 bucket lifecycle add`, documented in the README deploy steps because lifecycle rules can't live in `wrangler.jsonc`) deletes anything older than the max retention plus grace as a backstop for orphans.

**CLI** (`packages/cli`, binary `r2fl`): TypeScript on Node 22.12+, Linux and macOS.

- `up`, `refresh`, `revoke`, `ls`, `status`, `config`, `init`.
- Prints only the URL on stdout (scriptable); human-readable details go to stderr. Copies the URL to the clipboard when a clipboard tool exists.
- `up --notify` (macOS) posts one notification per invocation through `/usr/bin/osascript` (absolute path, because Quick Actions run with a minimal PATH): the link(s) on success, the error on failure. Text is escaped for AppleScript string literals since filenames and URLs are untrusted. It implies a clipboard copy unless `--no-copy`, and does nothing on other platforms. Notification delivery is behind `Context.notify` so tests inject a recorder.
- With `--json`, any failure is printed as a single compact `{"error": <ApiError.code | "cli_error" | "error">, "message": ...}` line on stdout (stderr stays empty) and the exit code is 1, so wrappers such as the Quick Action can parse failures. This includes option-parse errors (`--json` is detected from argv, and commander's `exitOverride` turns them into thrown errors). `up --json` with several files prints one array with per-file `{file, error, message}` entries instead of a trailing error line (`ReportedError` exits 1 silently). The formatting lives in `src/report.ts`.
- Secret warning (`src/secrets.ts`, pure and unit-tested; used by `up` only): before uploading, the file name is matched against a short list (`.env`, `.env.*` except `.example`/`.sample`/`.template`, `*.env`, `*.pem`, `*.key`, `*.p12`, `id_rsa|dsa|ecdsa|ed25519*` except `.pub`, `credentials*`, `.npmrc`, `.netrc`, `*.kdbx`) and, for text files (no NUL in the first 8 KiB), the first 2 MiB is scanned line by line for a PEM private-key header, AWS access key IDs (`AKIA`/`ASIA`), GitHub tokens, Slack tokens and `api[_-]?key = <16+ chars>`. The generic pattern requires a value that looks like a secret (the ticket's bare `api_key\s*[:=]` would flag `apiKey: string` in any source file). Findings are a rule name plus line numbers and never contain the matched text, so the warning cannot leak the secret into a terminal log or notification. Decision: with a terminal (`Context.interactive`: stdin and stderr are TTYs) ask `[y/N]`; otherwise (scripts, stdin pipes, the Quick Action, and always with `--json`, whose contract is a quiet stderr) refuse with an error that names the override, because there is nobody to ask. The file's real basename is checked as well as the `--name` override, so renaming cannot skip the filename rules. In a multi-file `up --notify`, the failure notification carries the first failure's reason (the plain summary alone would hide why a file was skipped). `--allow-secrets` / `-y` / `--yes` and config `warnSecrets=false` skip the check; a flagged file in a multi-file `up` fails only itself. `refresh` re-uploads a file that already passed the check, so it does not rescan. It is a safety net, not a guarantee.
- Folder upload (`src/folder.ts`, `src/zip.ts`; `rf-gah1`): `up <dir>` uploads `<dirname>.zip` as `application/zip`, entries under `<dirname>/`, mode bits kept (Unix "made by" so unzip restores them), UTF-8 names, deflate or store per file. Deviations from the ticket's design, with reasons: (1) **no system `zip`**: a ~100-line in-memory writer on `node:zlib` (no npm dependency) replaces spawning `zip` into a mode-600 temp file, because the dev container has no `zip` (so it could not be tested), a Quick Action's minimal PATH is one more thing to go wrong, in-process code controls symlinks and the cap precisely, and nothing is ever written to disk (so no temp file to clean up; a plaintext copy of possibly sensitive files in `/tmp` is a worse failure than the cap). Limits that follow: no zip64, so at most 65535 files and 4 GiB (the cap is far below). (2) **Size cap**: applies to the zipped size and aborts as soon as the running zipped size passes it; plus one early guard, with no `--force` flag: a folder whose files total more than 20 x the cap (and anyway 4 GiB) is refused before reading any file, since the whole zip is held in memory (at the default 50 MB that is 1 GB of raw files; `maxFileBytes` or `--exclude` is the way out). (3) **File list**: `git ls-files -z --cached --others --exclude-standard` run in the folder when a `.git` exists in it or a parent (a cheap `existsSync` walk first, so `git` is never started outside repos; on macOS a bare `git` without the developer tools opens an install dialog) and a directory walk otherwise. Inside a repository a git failure (missing, error, timeout) is an **error** that names `--no-gitignore`, never a fallback to the walk, because the walk does not know `.gitignore` and would upload files the user ignored on purpose (found in review: the default 1 MiB `execFileSync` output cap made repositories of roughly 10k+ files hit exactly that path; `maxBuffer` is now 256 MiB). Tracked files that no longer exist are skipped. `.git` and `node_modules` are excluded by name at any depth, and "explicitly included" means passing that folder itself (exclusions are matched on paths relative to the folder); when a repository's `.gitignore` also ignores it (the usual case for `node_modules`) `--no-gitignore` is needed too, otherwise the list is empty ("Nothing to zip", whose hint names the flag). `--exclude` is a small gitignore-style matcher (`*`, `**`, `?`, anchoring with `/`, trailing `/` for folders only), not full gitignore syntax (no negation). (4) **Symlinks**: every candidate path is resolved with `realpath` (not only the symlinks, so a symlinked parent folder cannot escape either: git lists a tracked `sub/x` even after `sub` became a link to somewhere else, found in review) and the resolved path is what is read; kept only when it is a regular file inside the folder, otherwise skipped and counted (never followed to folders, which also avoids loops). (5) **Secret check**: each member is checked with the same rules as a single file, while zipping (names by relative path, content of text files), so the zip's compressed bytes are never scanned and the warning names the files (first 5, then "and N more"); the zip's own name is not matched against the filename rules. (6) **Refresh after purge**: `HistoryEntry.sourceKind` (`file`/`dir`/`stdin`, absent on older entries) is `dir` for folders and `refresh` refuses to re-upload (it would otherwise fail with EISDIR, or silently send different bytes): the zip's hash can't be compared against the live folder, because the exclusions are not stored. Refreshing a link the server still has works as before.
- Config in `~/.config/r2fl/config.json` (mode 600), history in `~/.local/share/r2fl/history.json`. Both honor `XDG_*` variables.

**Shared core** (`packages/core`): API types, duration parsing, API client, constants shared by CLI and Worker.

**macOS Quick Action** (`macos/`, phase 2): two Automator Quick Actions (services menu, Finder files and folders) whose single "Run Shell Script" action (`/bin/zsh`, input as arguments) calls the installed wrapper `~/.local/bin/r2fl-quick`; the wrapper runs `r2fl up --notify --ttl <choice> -- <files>`.

- **PATH.** Quick Actions run with `/usr/bin:/bin:/usr/sbin:/sbin`. The first attempt (login shell only) failed on the owner's real Mac: with mise, `r2fl` lives in a per-version folder that only the interactive `~/.zshrc` activation adds, and the installer's check passed falsely because it inherited the Terminal's `PATH`. Final design, in three parts: (1) `install.sh` records the directories of `command -v r2fl` and `command -v node` from the Terminal it runs in into `<config dir>/quick-action-path` (also the hand-editable override); (2) the wrapper runs every `r2fl` call in `/bin/zsh -l -c` with those directories prepended (works for any setup without assumptions about the shell); (3) on exit 126/127 it retries once with `-l -i` so `~/.zshrc` is read (covers a stale recorded folder after a Node upgrade). If all fail it posts a fixed-text notification telling the user to re-run the installer, because `r2fl` never started and so could not report itself. The installer verifies the result through the installed wrapper (`r2fl-quick --check`) inside `env -i` with the minimal `PATH`, never with the Terminal's `PATH`. Rejected: an absolute path baked into the workflow (breaks on upgrade, hard to override), and bypassing the CLI with `curl` (duplicates config, TTL and error handling in shell). A native Finder Sync extension that calls the HTTP API directly would remove the problem entirely; see ticket `rf-og97`.
- **Standalone binary (prototype).** `scripts/build-binary.sh` compiles the unchanged CLI with `bun build --compile` (cross-compiles; darwin-arm64 about 62 MB, darwin-x64 about 69 MB). `install.sh --binary FILE` puts it at `<data dir>/bin/r2fl`, strips quarantine, ad hoc signs it and checks it starts under `env -i`; the wrapper prefers it over the login-shell lookup and falls back to that lookup on exit 126/127. One code path (the TypeScript CLI) and no dependency on the user's node. Node single-executable applications were tried and dropped: they need a CommonJS bundle (the entry point uses top-level `await`) and a node binary carrying the SEA fuse, which the node on the dev machine lacked. How it reaches users is decided under "Distributing the binary" below.
- **Finder Sync spike (`rf-og97`): VIABLE, deferred.** Can a Finder Sync extension signed only locally (ad hoc, no paid account) show a root-level "Share via r2-fastlink" submenu and hand the selection to a helper app? Yes, on macOS 26.6.2: the menu appears at the root of Finder's context menu for every location tried, all four lifetimes and every selected path arrive (924 files and awkward names included), the notification is titled "r2-fastlink", no `killall Finder` and no Gatekeeper or privacy prompt were needed. Design: a background host app (`LSUIElement`, URL scheme) plus a sandboxed `com.apple.FinderSync` extension whose only entitlements are the sandbox and `files.user-selected.read-only` (so no provisioning profile); the hand-off is one percent-encoded URL opened with `NSWorkspace` (an App Group would need a team identity). Full results and caveats: [`docs/finder-sync-spike.md`](finder-sync-spike.md). The code (`macos/spike/`, its CI workflow and test) is deliberately **not on `main`**: it is at the git tag `spike-finder-sync` (PR #11, closed unmerged), because nothing uses it and it would rot unnoticed. **Decision (2026-10-03):** the PATH problem is solved by the standalone binary instead (below), with one code path, so the Swift client (Option A) is dropped and the Quick Action stays the primary Finder integration. A root-level menu would be a thin Finder Sync shell that spawns the binary (Option B), deferred until the owner misses it (epic `rf-yofr`, `rf-kecm` decision 13). Next step: distributing the binary (`rf-kphq`).
- **Distributing the binary (`rf-kphq`, with `rf-od5l`): implemented in the batch-05 PR; the owner approves it by merging (or asks for changes).** One story for "how do I get r2fl", one version number.
  - **Version.** `packages/cli/package.json` is the only version. A release is the git tag `v<that version>` (`v0.1.0`); the release workflow refuses a tag that differs. The npm package, the release binaries and `r2fl --version` all show it; a standalone binary adds the git commit, as it already does. Bump the version in a commit, tag it, push the tag. Nothing is published from a branch or by hand.
  - **Release.** Pushing a `v*` tag runs `.github/workflows/release.yml`: the normal checks, then two independent jobs. `github-release` builds both darwin binaries on a Linux runner (Bun cross-compiles; no macOS minutes) and creates a GitHub Release with `r2fl-darwin-arm64`, `r2fl-darwin-x64`, `r2fl-macos-support.tar.gz` (the `macos/` folder), `install.sh` and `uninstall.sh` (the same files as in `macos/`, so one curl command can run them without a checkout) and `SHA256SUMS` covering all of them. `npm-publish` runs on a GitHub-hosted runner (`ubuntu-latest`; npm provenance rejects third-party runners such as the Ubicloud one the other jobs use) and runs `npm publish --provenance --access public` for `r2fl` using the owner's `NPM_TOKEN` secret and is skipped, with a warning, when the secret is absent (a fork can ship binaries without npm).
  - **Install.** `install.sh --latest` or `--version v0.1.0` downloads the binary for this Mac's architecture, checks it against `SHA256SUMS`, then installs it exactly as `--binary` does (ad hoc signature, start check under `env -i`). The Quick Action files always come from the same release (`r2fl-macos-support.tar.gz`, fetched and verified), never from a checkout the script happens to sit in, so a pinned version is reproducible and `curl ... | sh -s -- --latest` works with nothing else on disk. The new binary is staged as `r2fl.new`, signed and started there, and only then moved over the installed one: a failed update keeps the working binary, says so, and exits non-zero. Downloads use `curl`, which sets no quarantine flag, and fall back to `gh release download` for a private repository. `pnpm install:macos` stays for development.
  - **CI.** A PR-time job (`binaries` in `ci.yml`) runs the same packaging script as the release (`scripts/package-release.sh`), verifies the checksums, and starts the linux-x64 binary, so a broken build is found before a tag. Bun is pinned to the version the binaries were developed with.
  - **Kept for now.** The login-shell fallback and the recorded-PATH machinery stay: a source install without Bun still needs them, and they are covered by tests. Revisit once release binaries are the normal path.
  - **Out of scope.** Hardened runtime and notarization (ad hoc signing is enough for a file fetched with curl), a Homebrew tap, auto-update (`rf-16ho`).
- **Notifier applet.** Notifications from `osascript` belong to Script Editor, so clicking one opened Script Editor's Open dialog (found on the owner's Mac). `install.sh` now builds a tiny applet from `macos/notify-applet.applescript` with `osacompile` into `<data dir>/notify/r2-fastlink.app` (no Dock icon, bundle id `dev.r2fastlink.notify`, ad hoc signed). `sendNotification` writes the subtitle and text to `notify/pending/<unique>` and runs `open -g -j` on it; the applet posts them and deletes the files. A click relaunches the applet with nothing pending, so it quits: the click does nothing, by design (the link is on the clipboard, and a click cannot say which notification it came from, so "open the link" would be wrong for older or multi-file notifications). If the applet is missing or `open` fails, the old `osascript` path is used. Messages hold a link to the upload, so the folder is mode 700 and the files 600, written under a dot name and renamed (the applet's listing skips dot files, so it never reads half a message). A running applet only gets a "reopen" for a second `open`, so it re-checks the folder after a short pause and quits after two empty looks, and drops messages older than ten minutes unread. The wrapper's own fixed-text problem notifications (r2fl not found, picker failed, bad config) use the same queue when the applet is installed (`notify_via_applet` in `r2fl-quick.sh`), and fall back to `osascript` like the CLI.
- **Lifetime picker.** `osascript` `choose from list` with fixed AppleScript source; the items and the preselected default (`r2fl config get defaultTtl`) are passed as osascript arguments, so config text or file names can never become AppleScript source. A non-standard default is appended to the list. Cancel exits 0 with no upload and no notification.
- **No guessing.** If `r2fl config get defaultTtl` fails with anything other than 126/127, the notification carries `r2fl`'s own message (for example a corrupt config) rather than a PATH hint. A `defaultTtl` that is not a duration (after trimming whitespace, which `r2fl` accepts) aborts with a notification instead of falling back to `1h`: silently choosing a longer lifetime than configured would keep a file public for longer than intended.
- **Opt-out decision.** Finder cannot set environment variables or flags, so the opt-out is a second Quick Action, "Share via r2-fastlink (default lifetime)", that calls the wrapper with `--no-prompt`. Both are installed; users enable the one they want in System Settings. This is less annoying than an env var or a config switch that has to be edited in a file, and costs one extra checked-in bundle (a test keeps the two consistent).
- **Files.** `install.sh` copies the two `.workflow` bundles (checked-in plists; no token, endpoint or home path inside) and the wrapper, clears quarantine, runs `pbs -flush`, and warns if a login shell cannot find `r2fl` and `node`. `uninstall.sh` removes exactly those. `r2fl up` already summarizes several files into one notification.
- **Testing.** The wrapper, installer and bundles are tested on Linux (`packages/cli/test/macos.test.ts`) with a fake `r2fl`, `osascript` and login shell injected through `R2FL_QUICK_SHELL` / `R2FL_QUICK_OSASCRIPT`. The hand-written `.workflow` plists pass `plutil -lint` on macOS 26.6.2 and Finder loads and runs them. The guided `macos/qa.sh` (README checklist) was run on that Mac with all automatic checks passing; see the notes on `rf-0q8c`, `rf-smnk` and `rf-e9az`.

**Landing page**: static HTML and CSS with light branding, what the tool is for, the CLI quickstart, a repo link, and "fork it and deploy your own".

### Request flows

**Fetch** (`GET /<code>`)

1. Reject malformed codes with `404` (regex; nothing else is touched).
2. Per-IP rate limit, then global rate limit (both before any DO call).
3. One DO call: look up the code and, for a `GET` that counts as a download (every satisfiable `GET`; see section 9, download-cap accounting), count the hit, in a single atomic operation. Returns the metadata or `notfound`/`expired`/`exhausted`.
4. `404` unknown, `410` expired, revoked or out of downloads.
5. Otherwise the Worker streams the object from R2 directly (the DO never touches file bytes), honoring `Range`.

**Upload** (`POST /api/links`)

1. Authenticate, rate-limit.
2. Require `Content-Length`; reject over the size cap with `413` before reading the body. (On real Cloudflare a chunked request body is buffered by the edge, which supplies the length, so a client that omits it is not refused with 411 but is still held to the cap with 413.)
3. DO `allocate(meta)`: checks quota, picks a unique code, inserts a `pending` row, returns the code and R2 key.
4. Worker streams the body to R2 (`env.BUCKET.put`).
5. DO `commit(code)`: marks the row `active`, returns the final metadata. Two DO calls per upload; none while bytes move.

**Refresh / revoke**: a single DO call each. Refresh sets `expires_at = now + ttl`, resets the per-window download counter, and rejects a TTL above `MAX_TTL_SECONDS` with a clear error instead of silently clamping it. If the object has been purged, the CLI can re-upload from the original local path (verified by hash) using `PUT /api/links/:code`, so the short link is preserved.

## 3. Key decisions and rationale

| Decision                                                            | Why                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2 bucket private; Worker serves objects                            | Expiry must be enforceable and **refreshable under the same short URL**. Presigned URLs are long, and change on every refresh.                                                                                                                  |
| Expiry is server-side state, not an R2 feature                      | Same reason. It also allows revoke-now and download caps.                                                                                                                                                                                       |
| Short code is 8 random base58 characters                            | 58⁸ ≈ 1.3×10¹⁴. At 10 live links and 1,000 guesses/s, the expected time to hit one is about 400 years, and links live about an hour. Codes are never sequential or derivable.                                                                   |
| Link served directly at `/<code>`; filename suffix optional         | Agents fetch with `curl`/WebFetch; redirects and interstitials break them. The suffix is cosmetic (type hints) and ignored.                                                                                                                     |
| One SQLite-backed Durable Object as the registry                    | Strongly consistent allocate/refresh/revoke (KV is eventually consistent), atomic code allocation, and alarms for cleanup. D1 would also work; the DO fits and keeps the free-plan path (SQLite-backed DOs are the only kind on the free plan). |
| **Exactly one** DO instance, never one per link or IP               | Instance count is the classic DO cost trap. One instance has a bounded duration cost (section 5).                                                                                                                                               |
| The DO returns metadata only; the Worker streams bytes              | Proxying bodies through a DO burns duration and memory.                                                                                                                                                                                         |
| Two-stage expiry: `410` at `expires_at`, purge at `expires_at + 7d` | Refresh stays possible for a week without keeping data forever.                                                                                                                                                                                 |
| No content-addressed dedup                                          | Refcounting on delete adds complexity for little gain at personal scale.                                                                                                                                                                        |
| History is local-only                                               | The server needs no listing endpoint, which keeps the public surface minimal. The cost: each machine has its own history.                                                                                                                       |
| Single static bearer token                                          | Single-user by design. Token is a Wrangler secret generated at deploy time.                                                                                                                                                                     |
| Static landing page served by the same Worker                       | One deploy, one domain, and static asset requests don't invoke the Worker.                                                                                                                                                                      |
| TypeScript monorepo (pnpm workspaces)                               | One language across Worker, CLI and shared types. Swift is deferred to a possible later menubar app.                                                                                                                                            |
| Quick Action before a native app                                    | Gives the Finder right-click experience for roughly 30 minutes of work.                                                                                                                                                                         |

## 4. Security and abuse prevention

Anyone holding a link can fetch the file until it expires. The risks are guessing codes, hammering the endpoint, and serving hostile content.

1. **Entropy.** CSPRNG (`crypto.getRandomValues`) with rejection sampling to avoid modulo bias.
2. **Cheap rejection.** Malformed codes get `404` from a regex check, with no DO call.
3. **Per-IP rate limit** before any DO call (default 60 requests/min, keyed on `CF-Connecting-IP`).
4. **Global rate limit** before any DO call on the **public fetch path**: a circuit breaker on total anonymous DO-bound traffic (default 300 requests/min). It is not applied to authenticated `/api` calls, so a fetch flood can't lock you out of uploading. Trade-off: an attacker could trip it and temporarily deny real fetches; for a personal tool, cost safety wins. Tunable.
5. **Upload auth.** Constant-time token comparison (both sides hashed first, so length doesn't leak). The token is high entropy (256-bit); the per-IP limit applies to `/api` too, which bounds guess rate. A separate "failed auth" limiter was considered and dropped: the rate-limit binding counts every call, so it can't gate on failures without also consuming successes.
6. **No enumeration surface.** No list endpoint. `X-Robots-Tag: noindex`, `robots.txt`.
7. **Per-link controls.** Optional `--max-downloads`, revoke-now, purge.
8. **Upload-side caps** (enforced in the DO): per-file size, total stored bytes, uploads per day. A leaked token can't run up an unbounded R2 bill.
9. **Response hardening.** `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cache-Control: no-store` (a cached response would outlive expiry), and `Content-Security-Policy: sandbox` on active content types (HTML, SVG, XML). `sandbox` is not applied to everything because it breaks inline PDF viewing in some browsers; with `nosniff`, non-active types can't execute.
10. **Edge backstops (documented, outside the Worker).** Cloudflare's automatic DDoS mitigation and an optional WAF rate-limit rule block traffic before the Worker runs, so blocked requests aren't billed.

Limits of the in-Worker rate limiter (measured on a real account: active, but it admitted roughly 3 to 10 times the configured rate; see section 7). Cloudflare documents the Rate Limiting binding as "permissive, eventually consistent, and intentionally designed to not be used as an accurate accounting system", and counters are **local to each Cloudflare location**. It is a deterrent, not a hard cap. The period can only be 10 or 60 seconds, and limits are set in `wrangler.jsonc`, not in runtime vars.

## 5. Cost model

Durable Object pricing (from Cloudflare's published pricing, checked 2026-10-02):

- **Free plan:** SQLite-backed DOs only; 100,000 requests/day and 13,000 GB-s/day. Past the limit, requests fail; nothing is billed.
- **Paid plan:** 1M requests/month included then $0.15/M; 400,000 GB-s/month included then $12.50/M GB-s; objects are billed as if they use a full 128 MB; SQLite rows read 25B/month included then $0.001/M; rows written 50M/month included then $1.00/M; storage 5 GB-month included then $0.20/GB-month. Each `setAlarm()` counts as one row written.
- Workers: 100,000 requests/day on free; on paid, 10M/month included then $0.30/M.

Design consequences:

- **Duration is effectively free.** A DO awake for an entire 30-day month at 128 MB uses 0.125 GB × 2,592,000 s ≈ 324,000 GB-s, which is under the 400,000 GB-s included in the paid plan. This only holds with a **single instance** and a design that never keeps extra objects alive.
- **Requests are the only real exposure**, and they scale linearly and mildly: 100M DO requests in a month ≈ $15 plus Worker request charges. There is no runaway multiplier.
- **Nothing that keeps a DO awake or multiplies instances:** no WebSockets, no `setInterval`/`setTimeout` loops, no unawaited work, no per-user or per-IP objects, no file bytes through the DO.
- **The sweeper alarm is scheduled only for the next due cleanup** and reschedules only if rows remain. With no live links, no alarm is pending and the DO sits idle. There is no periodic heartbeat.
- **Pre-DO filtering** (regex, per-IP and global limits) keeps most junk traffic away from the DO.
- **R2:** misses stop at the DO lookup, so only valid live links cause R2 reads. R2 has no egress fees.

Honest caveat: because the rate limiter is per-location and approximate, the global limit is a deterrent. A widely distributed flood could exceed it. The hard backstops are Cloudflare's DDoS protection, an optional WAF rule, and billing alerts (the README will tell paid-plan users to enable usage notifications).

## 6. Defaults and configuration

| Setting            | Default                                             | Where                                            |
| ------------------ | --------------------------------------------------- | ------------------------------------------------ |
| Default TTL        | 1 hour                                              | client config (`defaultTtl`), per-upload `--ttl` |
| Max TTL            | 7 days                                              | Worker var `MAX_TTL_SECONDS`                     |
| Max file size      | 50 MB (hard ceiling 100 MB, the Workers body limit) | Worker var `MAX_FILE_BYTES`; client pre-check    |
| Total stored bytes | 2 GB                                                | Worker var `MAX_TOTAL_BYTES`                     |
| Uploads per day    | 200                                                 | Worker var `MAX_UPLOADS_PER_DAY`                 |
| Grace before purge | 7 days                                              | Worker var `PURGE_GRACE_SECONDS`                 |
| Per-IP limit       | 60 req / 60 s                                       | `ratelimits` in `wrangler.jsonc`                 |
| Global limit       | 300 req / 60 s                                      | `ratelimits` in `wrangler.jsonc`                 |
| Code length        | 8 base58 chars                                      | constant                                         |

Durations accept `30s`, `15m`, `2h`, `1d`.

## 7. Phased plan

**Phase 1: Worker, DO, CLI, landing page** (implemented)

- Worker: fetch and API routes, Registry DO (allocate/commit/resolve/refresh/revoke/purge, quotas, sweeper alarm), rate limiting, response hardening, Range/HEAD support.
- CLI: `init`, `up` (files and stdin), `refresh`, `revoke`, `ls`, `status`, `config`; local history; clipboard copy.
- Static landing page.
- Tests: Worker integration tests running against real DO and R2 simulations (workerd), unit tests for core and CLI, plus an end-to-end run of the CLI against a local `wrangler dev`.
- Docs: deploy-your-own guide in the README.

Implementation notes, where phase 1 refined this plan:

- Rate-limit bindings are optional in code (a missing or erroring limiter fails open), so a fork can remove them from `wrangler.jsonc`.
- `compatibility_date` is pinned to `2026-08-01`: the bundled local runtime (workerd) rejects dates newer than it knows about. Bump it when you upgrade Wrangler.
- Tests inject permissive limiter stubs for most cases and exercise the real binding in one dedicated test.
- Real-account verification (ticket `rf-rxkx`, run by the owner on 2026-10-03 against a workers.dev deployment on the free plan; `scripts/verify-deployment.mjs` and [`VERIFY_DEPLOYMENT.md`](VERIFY_DEPLOYMENT.md)). Results:
  - Everything functional passed: auth, uploads from tiny to 49 MiB (49 MiB up in 19.1 s, about 2.6 MiB/s from the owner's connection; down in 2.1 s), the 413 over the cap, Range/HEAD, `no-store` on every Worker response, 5 s TTL expiry then 410, refresh keeping the URL, revoke, purge and re-upload under the same code, `--max-downloads`, and no `cf-cache-status` on any Worker response.
  - Sweeper: with `PURGE_GRACE_SECONDS=20` an expired link was purged within seconds of becoming due and its row was gone. The grace period was then restored to 604800.
  - Durable Object: namespace `r2-fastlink_Registry`, storage SQL, exactly one object (the dashboard lists it twice, once as `registry` and once by its bare ID, which is the same ID; the bare-ID row is most likely alarm invocations, which carry no name). 299 DO requests and 0 errors in the first 24 hours, which covered about 270 scripted requests plus manual curls. No loop or junk traffic is visible. After cleanup the `links` table was empty.
  - Lifecycle: `expire-strays` (prefix `objects/`, 30 days) exists. Cloudflare also adds a default "abort incomplete multipart uploads after 7 days" rule.
  - **Content-Length through the edge:** a chunked upload with no `Content-Length` was accepted (201), not refused with 411: Cloudflare's edge buffers a chunked request body and gives the Worker a length, so the Worker never sees "no length". The bytes were stored intact. The cap still holds: a chunked 60 MB upload got `413 file_too_large` (after the whole body was sent, which is why it was slow). The script's 411 check now accepts either behavior and a new check asserts the chunked over-limit case is refused; the re-run on 2026-10-03 passed both (30 passed, 0 failed, 49 MiB up in 21.3 s, down in 3.8 s).
  - **Rate limiter: active but lenient (`rf-77fd`, resolved as documentation).** From one IP, 150 requests in 1.2 s and then a 200-request loop (about 1 to 4 per second; the owner noticed it ran slower than planned, so it may never have exceeded 60/min) against the real limit all returned 404, never 429, and the Worker logged no limiter errors. To separate "not enforcing" from "lenient", the owner temporarily deployed a copy of `wrangler.jsonc` with the per-IP limit at 3 requests per 10 s and sent 40 sequential requests: 9 were refused with 429 and 31 were let through. So the binding is attached and does enforce, but it admits several times the configured rate (counts are cached per machine and synced in the background, as Cloudflare documents). Treat the in-Worker limits as a coarse deterrent, not a cap; the real backstops are item 10 (an optional WAF rate-limit rule) and billing alerts. `withinLimit` still fails open if the binding throws, and now logs `rate limiter failed open`.
  - Still open: DO and Worker usage after about a day of normal use against section 5, and the optional custom domain check.
- `r2fl refresh` with no argument refreshes the most recent upload; `r2fl ls --sync` reconciles local history with the server.

**Phase 2: macOS Finder Quick Action**: 2.1 done (`up --notify` and `--json` errors); 2.2 to 2.4 done (Quick Action bundles, wrapper, installer, lifetime picker, README section), tested on Linux and verified by hand on macOS 26.6.2. A native Finder Sync alternative was spiked (`rf-og97`, VIABLE) and then deferred; see "Finder Sync spike" under the CLI notes.

**Phase 3: extras (ideas, not committed)**

- Folder upload as zip (done, `rf-gah1`).
- An agent skill (`skills/r2-fastlink/SKILL.md`, a skill file over the CLI so agents can create, refresh and revoke links themselves) (done, `rf-xxew`). It was validated by driving the documented commands against `wrangler dev`. Findings: the skill must tell agents to pass `--no-copy` (otherwise the clipboard is touched), that options go before `--`, that refresh also re-opens revoked and download-capped links and works for links this machine never uploaded (the server owns the state; the local history only matters for re-uploading a purged file), and that the one token can manage every link, which is the argument for scoped tokens in `rf-h4so`. `r2fl status | head` dies with an `EPIPE` stack trace (a CLI wart, noted in the skill, not fixed here). The MCP server and scoped tokens stay parked in `rf-h4so`.
- Parked: upload from the clipboard (screenshots), reconsidered later; an MCP server and scoped (restricted) tokens, to be decided after the skill has been used.
- Native Swift menubar app (drop target, hotkey).
- Deploy-to-Cloudflare button: evaluated and not offered (see section 8, `rf-dt1g`).

## 8. Distribution and forking

- `wrangler.jsonc` declares the R2 bucket, the SQLite DO migration (`new_sqlite_classes`), the rate-limit bindings, and the static assets directory.
- Deploy: `pnpm setup:cloudflare` (`scripts/setup.mjs`, logic and tests in `scripts/setup-lib.mjs` / `packages/cli/test/setup.test.ts`; `rf-dt1g`), or by hand with the README's step-by-step commands. The script, in order: `wrangler whoami` (stops when logged out) -> `r2 bucket info` and `create --no-update-config` if missing -> `deploy` -> `secret list` and `secret put R2FL_TOKEN` (token generated with `crypto.randomBytes(32)`, hex, sent on stdin) only when no such secret exists or `--rotate-token` -> `r2 bucket lifecycle list` and `add expire-strays objects/ --expire-days 30` if missing. Decisions: (1) **Deploy before the secret.** `secret put` on a Worker that does not exist yet makes wrangler ask whether to create it, which cannot be answered unattended; a deployed Worker without the secret fails closed (`api.ts` returns 500 "R2FL_TOKEN is not configured"), so the gap of a few seconds is safe. (2) **It never replaces a token it could not read:** a failing or unparseable `secret list` stops the script, because treating "unknown" as "not set" would silently lock the owner's CLI out. (3) The token appears exactly once, in the final summary on stdout (a terminal; do not redirect the script's stdout to a file), is never stored by the script, and the printed `r2fl init` command does not contain it (shell history); `init` prompts for it. (4) Names come from `packages/worker/wrangler.jsonc` (read with a regex, since it has comments). (5) `--dry-run` makes no wrangler call. The wrangler output formats it relies on (`whoami` text when logged out, `secret list` JSON, the `workers.dev` URL in `deploy` output, rule names in `lifecycle list`) were read from wrangler 4.147's source and `--help`, and the process plumbing (stdin to `secret put`, idempotent re-runs) was exercised against a stand-in wrangler; a run against a real account is the owner's check (`rf-dt1g`).
- **Deploy to Cloudflare button: not offered.** Cloudflare's docs (developers.cloudflare.com/workers/platform/deploy-buttons) say that for a subdirectory "your application must be fully isolated within that subdirectory, including any dependencies", and `packages/worker` depends on the workspace package `@r2-fastlink/core` (`workspace:*`), so the button cannot build it as it stands. It also cannot add the lifecycle rule, and it needs a public repository. Making the Worker self-contained (vendoring or publishing core) for a button would cost more than it saves next to the one-command script. Revisit if Cloudflare gains workspace support.
- One name for the token everywhere: the Worker secret, the CLI/script environment variable and the docs are all `R2FL_TOKEN` (it was `UPLOAD_TOKEN` on the Worker until the repo's first real deployment, which showed the two names were confusing). A Worker that still has only `UPLOAD_TOKEN` fails closed with a 500 whose message says to run `wrangler secret put R2FL_TOKEN`; the old name is never accepted for auth.
- `wrangler.jsonc` sets `workers_dev: true` and `preview_urls: false` explicitly. Preview URLs would expose every uploaded version on extra public hostnames (same bucket, same secret) with no benefit here.
- The README creates the bucket with `wrangler r2 bucket create r2-fastlink --no-update-config`. Without it wrangler offers to append a second binding (`r2_fastlink`) to `wrangler.jsonc` and rewrites the whole file; the code only uses `BUCKET`. (`--no-update-config` is read from wrangler 4.147 source: an explicit `false` skips both the prompt and the write.)
- The custom domain is attached via a Worker route or custom domain in the Cloudflare dashboard.
- The CLI ships as an npm package (`r2fl`), so no special runtime beyond Node, and on macOS as a standalone binary from the GitHub Release (see "Distributing the binary"). Both come from the same `v*` tag.
- Works on the free plan; the README documents billing alerts for paid-plan users.

## 9. Open questions and future ideas

- **License: MIT, © 2026 Christian Catalan** (decided by the owner, `rf-cr7d`). `LICENSE` at the root, a byte-identical copy in `packages/cli` (npm packs only files inside the package directory; a test keeps them equal), and `"license": "MIT"` in all four `package.json` files. Runtime dependencies of the shipped CLI and Worker are MIT (`commander`, `mime`, `hono`); `pnpm licenses list` also shows Apache-2.0, ISC, BSD-3-Clause, MPL-2.0, CC0 and LGPL-3.0 packages, all development-only (wrangler/miniflare and their `sharp` image libraries, test tooling) and not redistributed in the CLI package, the Worker bundle or the binaries.
- **Large files:** above ~100 MB needs presigned multipart uploads direct to R2. Deferred.
- **Cache positive lookups** at the edge for popular links to reduce DO calls. Adds revoke lag (bounded by cache TTL); deferred until there's a reason.
- **Keyed check characters** in the code would let the Worker reject most random guesses without a DO call, but shrink the effective guess space. Not adopted with 8-character codes.
- **Download-cap accounting (decided, `rf-dd4u`; revised after review).** Policy: `Registry.resolve(code, count, range)` counts a hit (`hits`, `window_hits`, `last_hit_at`) for every `GET` that is satisfiable, ranged or not, and never for `HEAD` or `416`. The registry gets the raw header and parses it with the same `parseRange` (`http.ts`) the serve path uses, against the stored `size`, so it is still exactly one Durable Object call per fetch (asserted in `links.test.ts` by counting stub calls). What this fixes: an unsatisfiable range no longer burns a count. What it deliberately does not fix: **ranged clients.** A client that reads a file in several ranges (a video player, a resumable downloader, Safari's `bytes=0-1` probe) spends one count per request, so the final allowed request can leave it with a truncated file and every later one gets `410`, whatever N is. `-d` is for plain full fetches (`curl`, `wget`, an agent). Decisions and tradeoffs: (1) **The first draft of this policy counted only requests with no `Range` or a range from byte 0** (so a ranged client would cost one count). Review showed that opens a hole: `Range: bytes=1-` is never counted, so a link holder reads everything but the first byte of a capped link without limit. The cap used to fail closed (links closed early, never late) and that is worth more than ranged-client convenience, so every satisfiable range counts. (2) The cap gates every request once reached: once `window_hits >= max_downloads` even ranges get `410`. (3) A stronger policy, per-window byte accounting (count `served bytes / size` downloads, so many small ranges of one file cost one), would let ranged clients work without reopening the hole; it needs a schema column and a migration of the live table and is not done (see below). (4) **Missing object:** a request that passes the registry but finds the R2 object gone (a purge race; the sweeper deletes objects only after expiry, when the registry already answers `410`) still counts. Verifying with an R2 `head` before the registry call would break the call order (the key comes from the registry) and one after it would cost an R2 operation on every fetch for a case that is almost unreachable. A client that aborts mid-transfer still counts. (5) **`hits` and `lastHitAt`** mean "counted fetches" and "when `hits` last increased" for every link, capped or not (so they match what the cap sees, and a link only ever read by ranges still shows as used); they do not count `HEAD`, `416` or refused requests. (Per-window byte accounting, if ever built, would also need its own column rather than changing these.)
- **Secret scanning** beyond the small built-in pattern list (entropy checks, more providers) is not planned; the warning (section 2, CLI) is a safety net, not a scanner.
- **Multi-device history** (opt-in sync) if local-only proves limiting.
