import { DEFAULT_MAX_FILE_BYTES, HARD_MAX_FILE_BYTES, parseDuration } from '@flashlink/core';
import { CliError } from './errors.ts';
import { readJson, writeJsonAtomic } from './fsutil.ts';
import { parseSize } from './format.ts';
import { configPath } from './paths.ts';

export interface Config {
  endpoint?: string;
  token?: string;
  /** Default link lifetime, e.g. "1h". Overridden per upload with --ttl. */
  defaultTtl: string;
  /** Client-side pre-check; the server enforces its own limit regardless. */
  maxFileBytes: number;
  /** Copy the resulting URL to the clipboard when a clipboard tool is available. */
  copy: boolean;
  /** Ask before uploading a file that looks like it holds secrets (.env, private keys, tokens). */
  warnSecrets: boolean;
}

export const DEFAULT_CONFIG: Config = {
  defaultTtl: '1h',
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  copy: true,
  warnSecrets: true,
};

export const CONFIG_KEYS = [
  'endpoint',
  'token',
  'defaultTtl',
  'maxFileBytes',
  'copy',
  'warnSecrets',
] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

type Env = Record<string, string | undefined>;

/** Read the config file (if any) and apply FLASHLINK_* environment overrides. */
export function loadConfig(env: Env = process.env): Config {
  const stored = readJson<Partial<Config>>(configPath(env)) ?? {};
  const config: Config = { ...DEFAULT_CONFIG, ...stored };
  if (env.FLASHLINK_ENDPOINT) config.endpoint = env.FLASHLINK_ENDPOINT;
  if (env.FLASHLINK_TOKEN) config.token = env.FLASHLINK_TOKEN;
  if (env.FLASHLINK_TTL) config.defaultTtl = env.FLASHLINK_TTL;
  return config;
}

/** Persist only what the file holds (never env overrides), with mode 600. */
export function saveConfig(patch: Partial<Config>, env: Env = process.env): Config {
  const stored = readJson<Partial<Config>>(configPath(env)) ?? {};
  const next = { ...stored, ...patch };
  writeJsonAtomic(configPath(env), next);
  return { ...DEFAULT_CONFIG, ...next };
}

function parseBoolean(key: string, raw: string): boolean {
  const value = raw.toLowerCase();
  if (!['true', 'false', 'on', 'off', '1', '0'].includes(value)) {
    throw new CliError(`${key} must be true or false.`);
  }
  return ['true', 'on', '1'].includes(value);
}

/** Validate and convert a raw string for a config key. */
export function parseConfigValue(key: ConfigKey, raw: string): Partial<Config> {
  switch (key) {
    case 'endpoint': {
      let url: URL;
      try {
        url = new URL(raw);
      } catch {
        throw new CliError(`"${raw}" is not a valid URL.`);
      }
      if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new CliError('endpoint must start with https:// (or http:// for local dev).');
      }
      return { endpoint: url.origin + url.pathname.replace(/\/+$/, '') };
    }
    case 'token':
      if (raw.length < 8) throw new CliError('token looks too short.');
      return { token: raw };
    case 'defaultTtl':
      try {
        parseDuration(raw);
      } catch (err) {
        throw new CliError((err as Error).message);
      }
      return { defaultTtl: raw };
    case 'maxFileBytes': {
      const bytes = parseSize(raw);
      if (bytes > HARD_MAX_FILE_BYTES) {
        throw new CliError('maxFileBytes cannot exceed 100MB (the Workers request body limit).');
      }
      return { maxFileBytes: bytes };
    }
    case 'copy':
    case 'warnSecrets':
      return { [key]: parseBoolean(key, raw) };
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) return '(not set)';
  return token.length <= 8 ? '********' : `${token.slice(0, 4)}…${token.slice(-4)}`;
}
