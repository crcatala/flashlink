import { CONFIG_KEYS, maskToken, parseConfigValue, saveConfig, type ConfigKey } from '../config.ts';
import type { Context } from '../context.ts';
import { CliError } from '../errors.ts';
import { formatBytes } from '../format.ts';
import { configPath } from '../paths.ts';

function assertKey(key: string): ConfigKey {
  if (!(CONFIG_KEYS as readonly string[]).includes(key)) {
    throw new CliError(`Unknown setting "${key}".`, `Settings: ${CONFIG_KEYS.join(', ')}`);
  }
  return key as ConfigKey;
}

function display(key: ConfigKey, ctx: Context): string {
  const value = ctx.config[key];
  if (key === 'token') return maskToken(ctx.config.token);
  if (key === 'maxFileBytes') return formatBytes(ctx.config.maxFileBytes);
  return value === undefined ? '(not set)' : String(value);
}

export function configShow(ctx: Context): void {
  for (const key of CONFIG_KEYS) ctx.out(`${key.padEnd(14)}${display(key, ctx)}`);
  ctx.err(ctx.style.dim(`\n${configPath(ctx.env)}`));
}

export function configGet(key: string, ctx: Context): void {
  const k = assertKey(key);
  // `get token` prints the real token so it can be piped; everything else is as displayed.
  ctx.out(
    k === 'token'
      ? (ctx.config.token ?? '')
      : k === 'maxFileBytes'
        ? String(ctx.config.maxFileBytes)
        : display(k, ctx),
  );
}

export function configSet(key: string, value: string, ctx: Context): void {
  const k = assertKey(key);
  saveConfig(parseConfigValue(k, value), ctx.env);
  ctx.err(`${ctx.style.green('✓')} ${k} saved.`);
}
