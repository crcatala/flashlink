import { DEFAULT_MAX_FILE_BYTES, HARD_MAX_FILE_BYTES, parseDuration } from '@r2-fastlink/core';
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
}

export const DEFAULT_CONFIG: Config = {
  defaultTtl: '1h',
  maxFileBytes: DEFAULT_MAX_FILE_BYTES,
  copy: true,
};

export const CONFIG_KEYS = ['endpoint', 'token', 'defaultTtl', 'maxFileBytes', 'copy'] as const;
export type ConfigKey = (typeof CONFIG_KEYS)[number];

type Env = Record<string, string | undefined>;

/** Read the config file (if any) and apply R2FL_* environment overrides. */
export function loadConfig(env: Env = process.env): Config {
  const stored = readJson<Partial<Config>>(configPath(env)) ?? {};
  const config: Config = { ...DEFAULT_CONFIG, ...stored };
  if (env.R2FL_ENDPOINT) config.endpoint = env.R2FL_ENDPOINT;
  if (env.R2FL_TOKEN) config.token = env.R2FL_TOKEN;
  if (env.R2FL_TTL) config.defaultTtl = env.R2FL_TTL;
  return config;
}

/** Persist only what the file holds (never env overrides), with mode 600. */
export function saveConfig(patch: Partial<Config>, env: Env = process.env): Config {
  const stored = readJson<Partial<Config>>(configPath(env)) ?? {};
  const next = { ...stored, ...patch };
  writeJsonAtomic(configPath(env), next);
  return { ...DEFAULT_CONFIG, ...next };
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
      if (!['true', 'false', 'on', 'off', '1', '0'].includes(raw.toLowerCase())) {
        throw new CliError('copy must be true or false.');
      }
      return { copy: ['true', 'on', '1'].includes(raw.toLowerCase()) };
  }
}

export function maskToken(token: string | undefined): string {
  if (!token) return '(not set)';
  return token.length <= 8 ? '********' : `${token.slice(0, 4)}…${token.slice(-4)}`;
}
