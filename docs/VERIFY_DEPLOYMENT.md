# Verifying a real deployment

Everything in phase 1 was built and tested against local simulators (workerd via `wrangler dev` and `@cloudflare/vitest-pool-workers`). This runbook is how you confirm it on a real Cloudflare account. It splits the work into a script that automates the HTTP checks and a short list of things only a person with the dashboard can check. Tracked by ticket `rf-rxkx`.

You need: the deployed Worker URL, the upload token, a machine with Node 22.12+ and a clone of this repo. Use your own account. The script uploads a few throwaway files (about 50 MiB at peak), leaves nothing behind, and counts about 8 uploads against the daily cap.

## 1. Deploy from a clean state (checklist item 1)

Follow the README ["Deploy your own"](../README.md#deploy-your-own) section literally, in a fresh clone, on the account you want to verify. Do not paste commands from memory. Write down every step that fails, needs a flag the README does not mention, or is unclear, and fix the README in the same PR as your notes.

## 2. Run the script (checklist items 3 to 7)

```sh
export R2FL_TOKEN=<the value you stored with `wrangler secret put UPLOAD_TOKEN`>
node scripts/verify-deployment.mjs --endpoint https://<your-worker>.<subdomain>.workers.dev
```

It prints one line per check (`PASS`, `FAIL`, `WARN`, `SKIP`) and a summary, and exits 1 if anything failed. It takes about two minutes. Options: `--large-mb`, `--skip-large`, `--sweeper`, `--skip-ratelimit`, `--probe-requests`, `--max-rpm`; run it with `--help`.

What it covers:

| Checklist item                       | Checks                                                                                                                                                                                                                                                                                               |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3 uploads of several sizes           | tiny text, HTML, ~1 MiB binary, a large file near the limit (default 49 MiB); each fetched back and compared by SHA-256; upload and download time for the large file; 413 for one byte over `MAX_FILE_BYTES`                                                                                         |
| 4 `Content-Length` through the proxy | every upload above succeeds only if the Worker saw the right length (the Worker also rejects a stored size mismatch); 411 for a chunked upload without `Content-Length`; 400 for an empty body                                                                                                       |
| 5 fetch semantics                    | `Cache-Control: no-store` on 200, 206, 404, 410, 416 and HEAD; `nosniff`, `Referrer-Policy`, `Accept-Ranges`, `Content-Disposition`; `Range` (first bytes, suffix, open-ended, 416); HEAD without a hit; `/<code>/<name>`; repeat 410 after expiry; no `cf-cache-status: HIT` on any Worker response |
| 6 lifecycle                          | 5 s TTL (200, then 410), refresh keeps the same URL, revoke then refresh, purge then 404, re-upload under the same code (and 409 when the code is live), `--max-downloads`                                                                                                                           |
| 7 rate limiting                      | normal use is never throttled (the script paces itself to 45 requests/min), then a flood of bogus-code requests until the first 429; reports the threshold                                                                                                                                           |
| 9 (part) sweeper                     | with `--sweeper`, uploads a 1 s link and waits for the sweeper alarm to purge it (see section 4)                                                                                                                                                                                                     |
| 8 (part) custom domain               | WARN if the returned URLs use a different origin than `--endpoint`; all fetches use the returned URLs                                                                                                                                                                                                |

Read the result like this:

- `FAIL`: a defect. File a bug ticket under epic `rf-dek6` (`tk create "..." -t bug --parent rf-dek6`) with the check name and detail, or fix it in the PR with a regression test.
- `WARN`: something to look at, not necessarily a bug. The rate-limit probe warns if it saw no 429 within `--probe-requests` requests. The limiter is per Cloudflare location and approximate, so try `--probe-requests 400` before calling it broken. Note the threshold you observe either way; it is the number for PLAN section 4.
- The rate-limit probe runs last and leaves your IP throttled on the Worker (`/api` and `/<code>`) for up to a minute. Wait before running anything else against the deployment.
- Replace your Worker hostname with `<worker-url>` before pasting output into a ticket note if you do not want it in the repo history.

## 3. Check the CLI against the deployment (checklist item 3, CLI half)

```sh
pnpm install && pnpm build
ln -s "$PWD/packages/cli/dist/index.js" ~/.local/bin/r2fl      # if not already linked
r2fl init --endpoint https://<your-worker>                      # paste the token when prompted
r2fl up README.md                                               # small text; open the URL in a browser too
head -c $((51*1024*1024)) /dev/urandom > /tmp/51mb.bin
r2fl up /tmp/51mb.bin                                           # the client should refuse (51 MiB > 50 MiB)
r2fl config set maxFileBytes 100MB
r2fl up /tmp/51mb.bin                                           # the server should answer 413 ("File is 53477376 bytes; the limit is 52428800.")
r2fl config set maxFileBytes 50MB                               # restore
r2fl up README.md --ttl 5s --no-copy                            # prints the URL; keep it
sleep 6; curl -si <that url> | head -1                          # HTTP/2 410
r2fl refresh                                                    # latest upload, same URL
curl -si <that url> | head -1                                   # HTTP/2 200
```

The script already checked these HTTP behaviors; this block confirms the CLI drives them correctly end to end.

## 4. Things only the dashboard can show

**Item 2: one SQLite-backed Durable Object instance.** After the script has run (it makes many uploads and fetches), open the Worker in the Cloudflare dashboard, go to its Durable Objects view and open the `Registry` class. Confirm: storage backend is SQLite, and exactly **one** object exists. More than one means something creates instances per link or per IP; that breaks the design (epic invariant 1), so file a P1 bug.

**Item 8: custom domain (optional).** Attach a custom domain or route to the Worker in the dashboard, set `PUBLIC_BASE_URL` in `packages/worker/wrangler.jsonc` to it, `wrangler deploy`, then re-run the script with `--endpoint https://<custom domain>`. The "URL origin matches" check should PASS and `r2fl up` should print URLs on that domain.

**Item 9: usage after a day.** Come back after about 24 hours of normal use (or leave a few links around) and compare the dashboard with [PLAN section 5](PLAN.md#5-cost-model):

- Durable Object **requests**: roughly one per fetch of a live link (`resolve`), two per upload (`allocate` and `commit`), one per API call, plus one per sweeper alarm. A value far above that points at a loop or at unfiltered junk traffic reaching the Registry.
- Durable Object **duration (GB-s)**: should be near zero while idle. A steadily climbing value means something keeps the Registry awake.
- **Rows written**: a handful per upload and per alarm. Large numbers mean unexpected writes.
- Worker requests and R2 operations: sanity-check against what you actually did.

**Item 9: the sweeper on a real account.** Temporarily deploy with a short grace period and run the sweeper check, then restore it:

```sh
cd packages/worker
pnpm exec wrangler deploy --var PURGE_GRACE_SECONDS:20
cd ../..
node scripts/verify-deployment.mjs --endpoint https://<your-worker> --sweeper --skip-large --skip-ratelimit
cd packages/worker && pnpm exec wrangler deploy      # back to the committed value (7 days)
```

The `sweeper purges an expired link` check should PASS (the alarm fires within seconds of the grace period passing). Confirm `curl -s https://<your-worker>/api/status -H "Authorization: Bearer $R2FL_TOKEN"` reports `purgeGraceSeconds` 604800 again after the restore.

**Item 10: lifecycle rule.**

```sh
cd packages/worker && pnpm exec wrangler r2 bucket lifecycle list r2-fastlink
```

Expect a rule `expire-strays` on prefix `objects/` that expires objects after 30 days.

## 5. Record the results

1. `tk add-note rf-rxkx "<script summary line, notable WARN/FAIL lines, answers for items 2, 8, 9, 10, README fixes>"`.
2. Tick the acceptance criteria in `.tickets/rf-rxkx.md` that you verified: every checklist item executed (and noted); README corrected where it diverged; defects ticketed or fixed with a regression test; PLAN section 5 updated if real numbers differ (and the "not verified on a real account" caveat in the phase 1 notes removed); no secrets, account IDs or tokens committed.
3. If every criterion is ticked, `tk close rf-rxkx`. That also unblocks `rf-dd4u`, `rf-dt1g`, `rf-v39y` and `rf-l2ym`.
