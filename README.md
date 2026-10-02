# r2-fastlink

Upload a file to your own Cloudflare R2 bucket and get back a **short, public link that expires on its own**. Built for handing assets (screenshots, logs, zips, videos) to coding agents without leaving anything lying around.

```
$ r2fl up screenshot.png --ttl 2h
https://fl.example.com/k3F9xQ2m
```

- **Short links.** An 8-character code, served directly (no redirect, no login, no JS), so an agent can `curl` it.
- **Self-expiring.** Default 1 hour, configurable globally and per upload. Expired links return `410 Gone`.
- **Refreshable.** `r2fl refresh <code>` re-opens the *same* link for another window; `r2fl revoke <code>` closes it early.
- **Local history.** Your upload history lives on your machine only. The server keeps just enough state to serve and expire links.
- **Single-user, self-hosted.** One Cloudflare Worker + one Durable Object + one private R2 bucket. Fork it and deploy it to your own account.

## Status

Planning. See [`docs/PLAN.md`](docs/PLAN.md) for the architecture, key decisions and the phased roadmap.

| Phase | Scope | Status |
| --- | --- | --- |
| 1 | Worker + Durable Object + R2, `r2fl` CLI, landing page | planned |
| 2 | macOS Finder Quick Action | planned |
| 3+ | Extras (clipboard/screenshot upload, zip of folders, agent skill) | ideas |

## How it works

```
 r2fl / Quick Action ──upload──▶ Worker ──▶ R2 (private bucket)
                                   │
 agent ──GET /k3F9xQ2m──▶ Worker ──┼──▶ Registry Durable Object (code → object, expiry)
                                   └──▶ streams the object if the link is live
```

R2 stays private. The Worker enforces expiry on every request, which is what lets a short link stay stable across refreshes.

## Deploy your own

Coming with phase 1. In short: fork, `wrangler deploy`, set one secret (your upload token), `r2fl init`. Works on the Cloudflare free plan.

## License

To be decided before the repo goes public.
