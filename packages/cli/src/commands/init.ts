import { ApiError } from '@r2-fastlink/core';
import { loadConfig, parseConfigValue, saveConfig } from '../config.ts';
import { clientFromConfig, type Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { formatBytes } from '../format.ts';
import { configPath } from '../paths.ts';
import { formatDuration } from '@r2-fastlink/core';

export interface InitOptions {
  endpoint?: string;
  token?: string;
  ttl?: string;
  /** Commander sets this to false for `--no-verify`. */
  verify?: boolean;
}

/** Save the Worker URL and upload token, then check them against the server. */
export async function init(opts: InitOptions, ctx: Context): Promise<void> {
  const interactive = ctx.stdinIsTTY;
  let endpoint = opts.endpoint ?? ctx.config.endpoint;
  let token = opts.token ?? ctx.env.R2FL_TOKEN;
  if (!endpoint) {
    if (!interactive) throw new CliError('Missing --endpoint.', 'Pass --endpoint and --token.');
    endpoint = await ctx.prompt('Worker URL (e.g. https://fl.example.com): ');
  }
  if (!token) {
    if (!interactive) throw new CliError('Missing --token (or R2FL_TOKEN).');
    token = await ctx.prompt('Upload token: ', { secret: true });
  }

  const patch = {
    ...parseConfigValue('endpoint', endpoint),
    ...parseConfigValue('token', token),
    ...(opts.ttl ? parseConfigValue('defaultTtl', opts.ttl) : {}),
  };

  if (opts.verify !== false) {
    const candidate = { ...ctx.config, ...patch };
    try {
      const { limits } = await clientFromConfig(candidate).status();
      ctx.err(
        `${ctx.style.green('✓')} Connected to ${candidate.endpoint}\n` +
          ctx.style.dim(
            `  max file ${formatBytes(limits.maxFileBytes)} · max lifetime ${formatDuration(limits.maxTtlSeconds)}`,
          ),
      );
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        throw new CliError(
          'The server rejected that token (401).',
          'Check R2FL_TOKEN on the Worker.',
        );
      }
      if (err instanceof ApiError) {
        throw new CliError(
          `Could not verify the server: ${err.message}`,
          'Use --no-verify to save anyway.',
        );
      }
      throw err;
    }
  }

  saveConfig(patch, ctx.env);
  ctx.err(`${ctx.style.green('✓')} Saved to ${configPath(ctx.env)}`);
  ctx.err(ctx.style.dim(`  default link lifetime: ${loadConfig(ctx.env).defaultTtl}`));
}
