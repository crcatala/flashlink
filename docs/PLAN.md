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
- Config in `~/.config/r2fl/config.json` (mode 600), history in `~/.local/share/r2fl/history.json`. Both honor `XDG_*` variables.

**Shared core** (`packages/core`): API types, duration parsing, API client, constants shared by CLI and Worker.

**macOS Quick Action** (`macos/`, phase 2): two Automator Quick Actions (services menu, Finder files and folders) whose single "Run Shell Script" action (`/bin/zsh`, input as arguments) calls the installed wrapper `~/.local/bin/r2fl-quick`; the wrapper runs `r2fl up --notify --ttl <choice> -- <files>`.

- **PATH.** Quick Actions run with `/usr/bin:/bin:/usr/sbin:/sbin`. The wrapper runs every `r2fl` call through the user's login shell (`/bin/zsh -l -c 'r2fl "$@"' r2fl ...`) so Homebrew, mise or nvm are found, instead of recording an absolute path at install time that would go stale when node is upgraded. Limitation: `zsh -l` reads `~/.zprofile` and `~/.zshenv`, not `~/.zshrc`, which the troubleshooting docs say. A login shell that finds nothing exits 127; the wrapper then posts its own fixed-text notification, because `r2fl` never started and so could not.
- **Lifetime picker.** `osascript` `choose from list` with fixed AppleScript source; the items and the preselected default (`r2fl config get defaultTtl`) are passed as osascript arguments, so config text or file names can never become AppleScript source. A non-standard default is appended to the list. Cancel exits 0 with no upload and no notification.
- **Opt-out decision.** Finder cannot set environment variables or flags, so the opt-out is a second Quick Action, "Share via r2-fastlink (default lifetime)", that calls the wrapper with `--no-prompt`. Both are installed; users enable the one they want in System Settings. This is less annoying than an env var or a config switch that has to be edited in a file, and costs one extra checked-in bundle (a test keeps the two consistent).
- **Files.** `install.sh` copies the two `.workflow` bundles (checked-in plists; no token, endpoint or home path inside) and the wrapper, clears quarantine, runs `pbs -flush`, and warns if a login shell cannot find `r2fl` and `node`. `uninstall.sh` removes exactly those. `r2fl up` already summarizes several files into one notification.
- **Testing.** The wrapper, installer and bundles are tested on Linux (`packages/cli/test/macos.test.ts`) with a fake `r2fl`, `osascript` and login shell injected through `R2FL_QUICK_SHELL` / `R2FL_QUICK_OSASCRIPT`. The `.workflow` plists have not been through Automator or `plutil -lint`; they follow the structure Automator writes for a Quick Action and parse as valid property lists (`plistlib`). Real behavior needs the manual QA on a Mac (README checklist).

**Landing page**: static HTML and CSS with light branding, what the tool is for, the CLI quickstart, a repo link, and "fork it and deploy your own".

### Request flows

**Fetch** (`GET /<code>`)

1. Reject malformed codes with `404` (regex; nothing else is touched).
2. Per-IP rate limit, then global rate limit (both before any DO call).
3. One DO call: look up the code and, for `GET`, count the hit, in a single atomic operation. Returns the metadata or `notfound`/`expired`/`exhausted`.
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

**Phase 2: macOS Finder Quick Action**: 2.1 done (`up --notify` and `--json` errors); 2.2 to 2.4 built (Quick Action bundles, wrapper, installer, lifetime picker, README section), tested on Linux. Not yet run on a real Mac: ticket `rf-e9az` stays open for that QA, after which phase 2 is done.

**Phase 3: extras (ideas, not committed)**

- Upload from clipboard (screenshots).
- Folder upload as zip.
- An agent skill or MCP tool so agents can refresh links themselves.
- Native Swift menubar app (drop target, hotkey).
- Deploy-to-Cloudflare button.

## 8. Distribution and forking

- `wrangler.jsonc` declares the R2 bucket, the SQLite DO migration (`new_sqlite_classes`), the rate-limit bindings, and the static assets directory.
- Deploy: `pnpm install && pnpm --filter worker deploy`, then `wrangler secret put R2FL_TOKEN` (the README gives an `openssl rand` one-liner).
- One name for the token everywhere: the Worker secret, the CLI/script environment variable and the docs are all `R2FL_TOKEN` (it was `UPLOAD_TOKEN` on the Worker until the repo's first real deployment, which showed the two names were confusing). A Worker that still has only `UPLOAD_TOKEN` fails closed with a 500 whose message says to run `wrangler secret put R2FL_TOKEN`; the old name is never accepted for auth.
- `wrangler.jsonc` sets `workers_dev: true` and `preview_urls: false` explicitly. Preview URLs would expose every uploaded version on extra public hostnames (same bucket, same secret) with no benefit here.
- The README creates the bucket with `wrangler r2 bucket create r2-fastlink --no-update-config`. Without it wrangler offers to append a second binding (`r2_fastlink`) to `wrangler.jsonc` and rewrites the whole file; the code only uses `BUCKET`. (`--no-update-config` is read from wrangler 4.147 source: an explicit `false` skips both the prompt and the write.)
- The custom domain is attached via a Worker route or custom domain in the Cloudflare dashboard.
- The CLI ships as an npm package (`r2fl`), so no special runtime beyond Node.
- Works on the free plan; the README documents billing alerts for paid-plan users.

## 9. Open questions and future ideas

- **License** (MIT is the likely choice) before the repo goes public.
- **Large files:** above ~100 MB needs presigned multipart uploads direct to R2. Deferred.
- **Cache positive lookups** at the edge for popular links to reduce DO calls. Adds revoke lag (bounded by cache TTL); deferred until there's a reason.
- **Keyed check characters** in the code would let the Worker reject most random guesses without a DO call, but shrink the effective guess space. Not adopted with 8-character codes.
- **Download-cap accounting (known limitation).** With `--max-downloads`, every `GET` that reaches the registry counts against the cap, including unsatisfiable `Range` requests (`416`), requests whose object turns out to be missing, and each partial request from a client that fetches in ranges (e.g. a video player). The cap is opt-in and the effect is conservative (links close early, never late). Fixing it needs an explicit policy for what counts as a download (for example, count only requests without a `Range` header or starting at offset 0) and a design that doesn't add a second Durable Object call per fetch, so it is deferred.
- **Secret scanning** warning for files like `.env` before upload.
- **Multi-device history** (opt-in sync) if local-only proves limiting.
