# r2-fastlink

Upload a file to your own Cloudflare R2 bucket and get back a **short, public link that expires on its own**. Built for handing assets (screenshots, logs, zips, videos) to coding agents without leaving anything lying around.

```
$ r2fl up screenshot.png --ttl 2h
✓ screenshot.png (1.2 MB) · expires 14:32
https://fl.example.com/k3F9xQ2m
```

- **Short links.** An 8-character code, served directly (no redirect, no login, no JS), so an agent can `curl` it. A trailing filename (`/k3F9xQ2m/shot.png`) is optional and ignored.
- **Self-expiring.** Default 1 hour, configurable globally and per upload. Expired links return `410 Gone`.
- **Refreshable.** `r2fl refresh <code>` re-opens the _same_ link for another window; `r2fl revoke <code>` closes it early.
- **Local history.** Your upload history lives on your machine only. The server keeps just enough state to serve and expire links.
- **Guardrails.** 50 MB file cap, 7 day max lifetime, storage and daily-upload ceilings, rate limiting, and a Durable Object design that keeps usage costs bounded.
- **Single-user, self-hosted.** One Cloudflare Worker + one Durable Object + one private R2 bucket. Fork it and deploy it to your own account; the free plan is enough.

## Status

Phase 1 (Worker, Durable Object, CLI, landing page) is implemented. See [`docs/PLAN.md`](docs/PLAN.md) for the architecture, key decisions and the roadmap.

| Phase | Scope                                                             | Status  |
| ----- | ----------------------------------------------------------------- | ------- |
| 1     | Worker + Durable Object + R2, `r2fl` CLI, landing page            | done    |
| 2     | macOS Finder Quick Action                                         | planned |
| 3+    | Extras (clipboard/screenshot upload, zip of folders, agent skill) | ideas   |

## How it works

```
 r2fl / Quick Action ──upload──▶ Worker ──▶ R2 (private bucket)
                                   │
 agent ──GET /k3F9xQ2m──▶ Worker ──┼──▶ Registry Durable Object (code → object, expiry)
                                   └──▶ streams the object if the link is live
```

R2 stays private. The Worker enforces expiry on every request, which is what lets a short link stay stable across refreshes. The Durable Object only ever holds metadata; file bytes go straight between the Worker and R2.

## Deploy your own

You need a Cloudflare account, Node 22.12+ and [pnpm](https://pnpm.io).

```sh
git clone https://github.com/crcatala/r2-fastlink && cd r2-fastlink
pnpm install
cd packages/worker

# 1. Create the private bucket (name must match wrangler.jsonc)
pnpm exec wrangler r2 bucket create r2-fastlink

# 2. Set your upload token (a long random string; keep it secret)
openssl rand -hex 32            # copy this value...
pnpm exec wrangler secret put UPLOAD_TOKEN   # ...and paste it when prompted

# 3. Safety net: delete any object older than 30 days, even if the Worker's own cleanup
#    never ran (the Worker removes files 7 days after expiry; this only catches strays)
pnpm exec wrangler r2 bucket lifecycle add r2-fastlink expire-strays objects/ --expire-days 30 -y

# 4. Deploy
pnpm exec wrangler deploy
```

Wrangler prints your `*.workers.dev` URL. To use your own domain, add a custom domain or route to the Worker in the Cloudflare dashboard (and optionally set `PUBLIC_BASE_URL` in `wrangler.jsonc`).

Limits are plain vars in [`packages/worker/wrangler.jsonc`](packages/worker/wrangler.jsonc) (`MAX_FILE_BYTES`, `MAX_TTL_SECONDS`, `MAX_TOTAL_BYTES`, `MAX_UPLOADS_PER_DAY`, `PURGE_GRACE_SECONDS`). Rate limits live in the `ratelimits` block.

**On a paid plan?** Durable Object costs are bounded by design (a single instance, no timers or WebSockets, and the cleanup alarm only runs when something is due), but turn on [usage notifications](https://developers.cloudflare.com/notifications/) in the Cloudflare dashboard anyway. See [the cost model](docs/PLAN.md#5-cost-model).

## Install the CLI

The CLI isn't published to npm yet. From a clone of this repo:

```sh
pnpm install && pnpm build
ln -s "$PWD/packages/cli/dist/index.js" ~/.local/bin/r2fl   # or anywhere on your PATH

r2fl init --endpoint https://fl.example.com      # prompts for your upload token
```

Works on macOS and Linux (Node 22.12+).

## Using it

```sh
r2fl up report.pdf                    # upload; prints the URL and copies it to the clipboard
r2fl up build.log --ttl 15m           # custom lifetime: 30s, 15m, 2h, 1d, 1h30m
r2fl up a.png b.png                   # one link per file
r2fl up big.zip -d 3                  # stop serving after 3 downloads
cat trace.txt | r2fl up --name trace.txt   # from stdin
r2fl up shot.png --with-name          # https://…/k3F9xQ2m/shot.png

r2fl ls                               # local history (add --live, --all, --sync, --json)
r2fl refresh k3F9xQ2m --ttl 30m       # same link, new window (no argument: the latest upload)
r2fl revoke k3F9xQ2m                  # close now; refresh can re-open it
r2fl revoke k3F9xQ2m --purge          # also delete the stored file

r2fl status                           # server limits and usage
r2fl config                           # view settings; `config set defaultTtl 2h`
```

Only the URL goes to stdout, so it composes: `curl -s "$(r2fl up shot.png --no-copy)"`. Add `--json` for the full result.

If the server has already deleted a link's file (7 days past expiry by default), `r2fl refresh` re-uploads the original local file under the **same code**, as long as it is unchanged.

Settings live in `~/.config/r2fl/config.json` and history in `~/.local/share/r2fl/history.json` (both honor `XDG_*`). `R2FL_ENDPOINT`, `R2FL_TOKEN` and `R2FL_TTL` override the config.

## Development

```sh
pnpm install
pnpm test          # all packages (Worker tests run in workerd via @cloudflare/vitest-pool-workers)
pnpm typecheck
pnpm format
pnpm build         # the r2fl CLI

cd packages/worker
echo 'UPLOAD_TOKEN=dev-token-0123456789abcdef' > .dev.vars
pnpm exec wrangler dev             # local Worker + R2 + Durable Object on :8787
```

CI (`.github/workflows/ci.yml`) runs on every pull request and on pushes to `main`: `pnpm format:check`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and `wrangler deploy --dry-run` for the Worker. It needs no secrets and takes its Node version from `.node-version`. It runs on `ubicloud-standard-2`; forks without Ubicloud should change `runs-on` to `ubuntu-latest`. Actions are pinned to commit SHAs. Run the same checks locally before opening a PR.

```
packages/core     shared types, duration parsing, API client
packages/worker   Cloudflare Worker, Registry Durable Object, landing page (public/)
packages/cli      the `r2fl` command
```

## License

To be decided before the repo goes public.
