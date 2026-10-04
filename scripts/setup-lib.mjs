// The logic of scripts/setup.mjs, with every side effect behind an injected `io` so it can be
// tested without a Cloudflare account. Plain ESM, no dependencies.

export const TOKEN_SECRET = 'R2FL_TOKEN';
export const LIFECYCLE_RULE = 'expire-strays';
export const LIFECYCLE_PREFIX = 'objects/';
export const LIFECYCLE_DAYS = 30;

const HELP = `Usage: pnpm setup:cloudflare [options]

Sets up your own Cloudflare account for r2-fastlink: private R2 bucket, Worker + Durable Object,
upload token (as the Worker secret ${TOKEN_SECRET}), and a 30-day safety-net lifecycle rule.
Safe to re-run: it reuses what exists, redeploys, and never replaces your token unless asked.

  --dry-run        print what would happen and change nothing
  --rotate-token   generate a new token and replace the existing secret (old token stops working)
  -h, --help       show this help

You must be logged in to Cloudflare first (\`pnpm --filter @r2-fastlink/worker exec wrangler login\`)
or have CLOUDFLARE_API_TOKEN set.`;

export function parseSetupArgs(argv) {
  const opts = { dryRun: false, rotateToken: false, help: false };
  for (const arg of argv) {
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--rotate-token') opts.rotateToken = true;
    else if (arg === '-h' || arg === '--help') opts.help = true;
    else throw new SetupError(`Unknown option: ${arg}`, 'Run with --help to see the options.');
  }
  return { opts, help: HELP };
}

export class SetupError extends Error {
  constructor(message, hint) {
    super(message);
    this.hint = hint;
  }
}

/** wrangler.jsonc allows comments, so read the two names with a regex instead of JSON.parse. */
export function parseWranglerNames(jsonc) {
  const code = jsonc.replace(/^\s*\/\/.*$/gm, '');
  const worker = /"name"\s*:\s*"([^"]+)"/.exec(code)?.[1];
  const bucket = /"bucket_name"\s*:\s*"([^"]+)"/.exec(code)?.[1];
  if (!worker || !bucket) {
    throw new SetupError(
      'Could not read the Worker name and bucket_name from packages/worker/wrangler.jsonc.',
    );
  }
  return { worker, bucket };
}

/** `wrangler whoami` exits 0 even when logged out, so read what it says. */
export function isAuthenticated(whoamiOutput) {
  return !/not authenticated|not logged in/i.test(whoamiOutput);
}

/**
 * `wrangler secret list` prints JSON: [{"name":"R2FL_TOKEN","type":"secret_text"}].
 * Returns null when the output is not that, so the caller can stop instead of assuming "no
 * secrets" (which would replace an existing token).
 */
export function parseSecretNames(output) {
  const start = output.indexOf('[');
  const end = output.lastIndexOf(']');
  if (start === -1 || end < start) return null;
  try {
    const parsed = JSON.parse(output.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed.map((s) => s?.name).filter(Boolean) : null;
  } catch {
    return null;
  }
}

export function hasLifecycleRule(listOutput, rule = LIFECYCLE_RULE) {
  return new RegExp(`(^|[^\\w-])${rule}($|[^\\w-])`, 'm').test(
    listOutput.replace(/^Listing lifecycle rules.*$/m, ''),
  );
}

/** The URL `wrangler deploy` prints for the Worker, or null. */
export function findWorkerUrl(deployOutput, worker) {
  const re = new RegExp(`https://${worker}\\.[a-z0-9-]+\\.workers\\.dev`, 'i');
  return re.exec(deployOutput)?.[0] ?? null;
}

export function summary({ url, token, keptToken }) {
  const lines = ['', 'Done. Your r2-fastlink is deployed.', ''];
  lines.push(`  URL:    ${url ?? '(wrangler did not print one; see the deploy output above)'}`);
  if (token) {
    lines.push(
      `  Token:  ${token}`,
      '',
      'Copy the token now: it is shown once and is not stored anywhere on this machine.',
      `Keep it in a password manager. It is the Worker secret ${TOKEN_SECRET}.`,
    );
  } else if (keptToken) {
    lines.push(
      `  Token:  unchanged (the existing ${TOKEN_SECRET} secret was kept; use --rotate-token to replace it)`,
    );
  }
  lines.push(
    '',
    'Next, on the machine you upload from:',
    `  r2fl init --endpoint ${url ?? '<your worker url>'}     # paste the token when asked`,
    `  node scripts/verify-deployment.mjs --endpoint ${url ?? '<your worker url>'}   # optional full check (needs ${TOKEN_SECRET} in the environment)`,
    '',
  );
  return lines.join('\n');
}

/**
 * io: {
 *   readWranglerConfig(): string
 *   wrangler(args, { input?, echo?, quiet? }): Promise<{ code, stdout }>   // runs in packages/worker
 *   randomToken(): string
 *   log(line), err(line)
 * }
 */
export async function runSetup(opts, io) {
  const { worker, bucket } = parseWranglerNames(io.readWranglerConfig());
  const plan = [
    `check you are logged in to Cloudflare`,
    `create the private R2 bucket "${bucket}" if it does not exist`,
    `deploy the Worker "${worker}" (wrangler deploy)`,
    opts.rotateToken
      ? `generate a NEW token and replace the ${TOKEN_SECRET} secret`
      : `set a generated ${TOKEN_SECRET} secret only if none exists (an existing token is kept)`,
    `add the "${LIFECYCLE_RULE}" lifecycle rule (objects/ older than ${LIFECYCLE_DAYS} days) if missing`,
  ];
  if (opts.dryRun) {
    io.log('Dry run, nothing will be changed. Setup would:');
    plan.forEach((step, i) => io.log(`  ${i + 1}. ${step}`));
    return { dryRun: true };
  }

  const step = (n, text) => io.err(`[${n}/5] ${text}`);
  const must = (res, what, hint) => {
    if (res.code !== 0) throw new SetupError(`${what} failed (exit ${res.code}).`, hint);
    return res;
  };

  step(1, 'Checking your Cloudflare login');
  const who = await io.wrangler(['whoami'], {});
  if (!isAuthenticated(who.stdout)) {
    throw new SetupError(
      'You are not logged in to Cloudflare.',
      'Run `pnpm --filter @r2-fastlink/worker exec wrangler login` (or set CLOUDFLARE_API_TOKEN), then re-run.',
    );
  }

  step(2, `Bucket "${bucket}"`);
  const info = await io.wrangler(['r2', 'bucket', 'info', bucket, '--json'], { quiet: true });
  if (info.code === 0) {
    io.err(`      already exists, reusing it`);
  } else {
    must(
      await io.wrangler(['r2', 'bucket', 'create', bucket, '--no-update-config'], { echo: true }),
      'Creating the bucket',
      'Check that R2 is enabled for your account (Cloudflare dashboard > R2).',
    );
  }

  step(3, `Deploying the Worker "${worker}"`);
  const deploy = must(
    await io.wrangler(['deploy'], { echo: true }),
    'Deploying the Worker',
    'Fix the error above and re-run: setup picks up where it stopped.',
  );
  const url = findWorkerUrl(deploy.stdout, worker);

  step(4, `Secret ${TOKEN_SECRET}`);
  const listed = must(
    await io.wrangler(['secret', 'list', '--format', 'json'], {}),
    'Listing the Worker secrets',
    'Setup stops here rather than risk replacing your existing token. Re-run it.',
  );
  const names = parseSecretNames(listed.stdout);
  if (!names) {
    throw new SetupError(
      'Could not read the output of `wrangler secret list`.',
      'Setup stops here rather than risk replacing your existing token. Set it by hand with `wrangler secret put R2FL_TOKEN` (see the README).',
    );
  }
  const existing = names.includes(TOKEN_SECRET);
  let token = null;
  if (existing && !opts.rotateToken) {
    io.err('      already set, keeping it');
  } else {
    token = io.randomToken();
    // On stdin, never in an argument (visible in `ps`) and never echoed.
    const put = await io.wrangler(['secret', 'put', TOKEN_SECRET], { input: `${token}\n` });
    must(put, 'Setting the secret', 'Re-run setup (add --rotate-token if a token was half-set).');
  }

  step(5, `Lifecycle rule "${LIFECYCLE_RULE}"`);
  const rules = await io.wrangler(['r2', 'bucket', 'lifecycle', 'list', bucket], { quiet: true });
  if (rules.code === 0 && hasLifecycleRule(rules.stdout)) {
    io.err('      already there');
  } else {
    must(
      await io.wrangler(
        [
          'r2',
          'bucket',
          'lifecycle',
          'add',
          bucket,
          LIFECYCLE_RULE,
          LIFECYCLE_PREFIX,
          '--expire-days',
          String(LIFECYCLE_DAYS),
          '-y',
        ],
        { echo: true },
      ),
      'Adding the lifecycle rule',
      'It is a safety net only; the Worker already deletes expired files. Re-run to retry.',
    );
  }

  io.log(summary({ url, token, keptToken: existing && !opts.rotateToken }));
  return { dryRun: false, url, token };
}
