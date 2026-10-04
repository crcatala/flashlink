#!/usr/bin/env node
// One-command setup of your own Cloudflare account. See `pnpm setup:cloudflare --help`.
// (Not `pnpm setup`: that is a built-in pnpm command.)
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SetupError, parseSetupArgs, runSetup } from './setup-lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workerDir = path.join(root, 'packages', 'worker');

function wrangler(args, { input, echo, quiet } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'wrangler', ...args], {
      cwd: workerDir,
      stdio: [input === undefined ? 'inherit' : 'pipe', 'pipe', 'pipe'],
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
    });
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (echo) process.stderr.write(chunk);
    });
    // wrangler's own progress and errors go to stderr; show them (they never contain the token).
    child.stderr.on('data', (chunk) => {
      if (!quiet) process.stderr.write(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, stdout }));
    if (input !== undefined) child.stdin.end(input);
  });
}

const io = {
  readWranglerConfig: () => fs.readFileSync(path.join(workerDir, 'wrangler.jsonc'), 'utf8'),
  wrangler,
  randomToken: () => randomBytes(32).toString('hex'),
  log: (line) => console.log(line),
  err: (line) => console.error(line),
};

try {
  const { opts, help } = parseSetupArgs(process.argv.slice(2));
  if (opts.help) {
    console.log(help);
  } else {
    await runSetup(opts, io);
  }
} catch (err) {
  if (err instanceof SetupError) {
    console.error(`\nsetup: ${err.message}`);
    if (err.hint) console.error(err.hint);
    process.exit(1);
  }
  throw err;
}
