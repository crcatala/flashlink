import { DEFAULT_MAX_FILE_BYTES, HARD_MAX_FILE_BYTES, type ServerLimits } from '@flashlink/core';
import type { Env } from './env.ts';

const DAY = 86400;

type LimitVars = Pick<
  Env,
  | 'MAX_FILE_BYTES'
  | 'MAX_TTL_SECONDS'
  | 'DEFAULT_TTL_SECONDS'
  | 'MAX_TOTAL_BYTES'
  | 'MAX_UPLOADS_PER_DAY'
  | 'PURGE_GRACE_SECONDS'
>;

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}

/** Resolve effective limits from Worker vars, falling back to safe defaults. */
export function parseLimits(env: LimitVars): ServerLimits {
  const maxTtlSeconds = positiveInt(env.MAX_TTL_SECONDS, 7 * DAY);
  return {
    maxFileBytes: Math.min(
      positiveInt(env.MAX_FILE_BYTES, DEFAULT_MAX_FILE_BYTES),
      HARD_MAX_FILE_BYTES,
    ),
    maxTtlSeconds,
    defaultTtlSeconds: Math.min(positiveInt(env.DEFAULT_TTL_SECONDS, 3600), maxTtlSeconds),
    maxTotalBytes: positiveInt(env.MAX_TOTAL_BYTES, 2 * 1024 ** 3),
    maxUploadsPerDay: positiveInt(env.MAX_UPLOADS_PER_DAY, 200),
    purgeGraceSeconds: positiveInt(env.PURGE_GRACE_SECONDS, 7 * DAY),
  };
}
