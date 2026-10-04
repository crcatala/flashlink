# fl

Command-line client for [flashlink](https://github.com/crcatala/flashlink): upload a file to your own Cloudflare R2 bucket and get a short public link that expires on its own.

```sh
npm i -g flashlink          # or: npx flashlink --help
fl init --endpoint https://fl.example.com
fl up screenshot.png --ttl 2h
```

You need a deployed flashlink Worker first (one Cloudflare Worker, one Durable Object, one private R2 bucket). The repository explains how to deploy your own, and documents every command: <https://github.com/crcatala/flashlink#readme>.

Requires Node 22.12 or newer.
