# r2fl

Command-line client for [r2-fastlink](https://github.com/crcatala/r2-fastlink): upload a file to your own Cloudflare R2 bucket and get a short public link that expires on its own.

```sh
npm i -g r2fl          # or: npx r2fl --help
r2fl init --endpoint https://fl.example.com
r2fl up screenshot.png --ttl 2h
```

You need a deployed r2-fastlink Worker first (one Cloudflare Worker, one Durable Object, one private R2 bucket). The repository explains how to deploy your own, and documents every command: <https://github.com/crcatala/r2-fastlink#readme>.

Requires Node 22.12 or newer.
