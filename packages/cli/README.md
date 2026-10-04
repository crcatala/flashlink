# flashlink

Command-line client for [flashlink](https://github.com/crcatala/flashlink): upload a file to your own Cloudflare R2 bucket and get a short public link that expires on its own.

```sh
npm i -g flashlink          # or: npx flashlink --help
fl init --endpoint https://fl.example.com
fl up screenshot.png --ttl 2h
```

You need a deployed flashlink Worker first (one Cloudflare Worker, one Durable Object, one private R2 bucket). One command sets it up in your own Cloudflare account; see the [deploy guide](https://github.com/crcatala/flashlink/blob/main/docs/DEPLOY.md).

- [Quick start and examples](https://github.com/crcatala/flashlink#readme)
- [CLI reference](https://github.com/crcatala/flashlink/blob/main/docs/CLI.md): every command, folders, download limits, the secret warning, config
- [macOS Finder Quick Action](https://github.com/crcatala/flashlink/blob/main/docs/MACOS.md) and the [agent skill](https://github.com/crcatala/flashlink/blob/main/docs/AGENT_SKILL.md)

The package installs two commands that do the same thing: `fl` (short) and `flashlink`.

Requires Node 22.12 or newer.
