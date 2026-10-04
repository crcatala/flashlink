# Deploy your own

flashlink is one Cloudflare Worker, one Durable Object and one private R2 bucket in **your** Cloudflare account. The free plan is enough.

You need a Cloudflare account, Node 22.12+ and [pnpm](https://pnpm.io).

## One command

Log in once, then let the setup script do the steps below:

```sh
git clone https://github.com/crcatala/flashlink && cd flashlink
pnpm install
pnpm --filter @flashlink/worker exec wrangler login   # once
pnpm setup:cloudflare                                   # add --dry-run to see the plan first
```

It creates the private bucket, deploys the Worker, generates a token and stores it as the Worker secret `FLASHLINK_TOKEN` (sent to wrangler on stdin, never as an argument or into a file), adds the 30-day lifecycle rule, then prints your URL, the token **once**, and the `fl init` command to run next.

- It is safe to re-run: it reuses the bucket and rule, redeploys, and keeps your existing token (`--rotate-token` replaces it, and the old one stops working).
- It stops instead of guessing if it cannot read the state of your account.
- It deploys to `*.workers.dev`. To change the limits, edit `packages/worker/wrangler.jsonc` before running it (see [Limits](#limits)).
- It is `setup:cloudflare` because `pnpm setup` is a built-in pnpm command.

## Step by step

The same thing by hand, if you prefer to see each command:

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

Wrangler prints your `*.workers.dev` URL. If `wrangler r2 bucket create` ever asks "Would you like Wrangler to add it on your behalf?" (older versions, or if you left out `--no-update-config`), answer **no**: `wrangler.jsonc` already binds the bucket as `BUCKET`, and accepting adds a redundant second binding and reformats the file.

`wrangler.jsonc` also sets `workers_dev: true` and `preview_urls: false` so deploys do not warn; preview URLs would put every uploaded version of the Worker on extra public hostnames.

## Custom domain

To use your own domain, add a custom domain or route to the Worker in the Cloudflare dashboard (and optionally set `PUBLIC_BASE_URL` in `wrangler.jsonc`).

## Limits

Limits are plain vars in [`packages/worker/wrangler.jsonc`](../packages/worker/wrangler.jsonc). Edit them and deploy again.

| Variable              | Default | Meaning                                                      |
| --------------------- | ------- | ------------------------------------------------------------ |
| `MAX_FILE_BYTES`      | 50 MiB  | Largest upload (hard ceiling: 100 MiB)                       |
| `MAX_TTL_SECONDS`     | 7 days  | Longest lifetime a link can be given                         |
| `DEFAULT_TTL_SECONDS` | 1 hour  | Lifetime when the client does not ask for one                |
| `MAX_TOTAL_BYTES`     | 2 GiB   | Total storage across all stored files                        |
| `MAX_UPLOADS_PER_DAY` | 200     | Uploads accepted per day                                     |
| `PURGE_GRACE_SECONDS` | 7 days  | How long after expiry the file is deleted (so refresh works) |

Rate limits live in the `ratelimits` block of the same file. The in-Worker rate limiter is active but lenient (Cloudflare's binding is approximate by design), so treat it as a deterrent and add a WAF rate-limit rule and billing alerts if you want hard protection.

**On a paid plan?** Durable Object costs are bounded by design (a single instance, no timers or WebSockets, and the cleanup alarm only runs when something is due), but turn on [usage notifications](https://developers.cloudflare.com/notifications/) in the Cloudflare dashboard anyway. See [the cost model](ARCHITECTURE.md#5-cost-model).

## Check that it works

To confirm a deployment end to end (uploads of several sizes, `Range`/`HEAD`, `no-store`, expiry and refresh, rate limiting):

```sh
FLASHLINK_TOKEN=<token> node scripts/verify-deployment.mjs --endpoint https://<your-worker>
```

[`VERIFY_DEPLOYMENT.md`](VERIFY_DEPLOYMENT.md) explains it and lists the checks that need the Cloudflare dashboard. The functional checks passed on a real account (see [ARCHITECTURE section 8](ARCHITECTURE.md#8-real-account-verification)).

## Next

Install the CLI and point it at your Worker: see the [README quick start](../README.md#quick-start).
