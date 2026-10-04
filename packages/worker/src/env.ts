import type { Registry } from './registry.ts';

export interface Env {
  BUCKET: R2Bucket;
  REGISTRY: DurableObjectNamespace<Registry>;
  /** Rate-limit bindings; optional so a fork can remove them from wrangler.jsonc. */
  LIMIT_IP?: RateLimit;
  LIMIT_GLOBAL?: RateLimit;
  /** Secret: bearer token required for /api/*. */
  FLASHLINK_TOKEN?: string;
  /** Old name of the secret. Never used for auth; only detected to give a helpful error. */
  UPLOAD_TOKEN?: string;
  /** Optional base URL used when building links (defaults to the request origin). */
  PUBLIC_BASE_URL?: string;
  MAX_FILE_BYTES?: string;
  MAX_TTL_SECONDS?: string;
  DEFAULT_TTL_SECONDS?: string;
  MAX_TOTAL_BYTES?: string;
  MAX_UPLOADS_PER_DAY?: string;
  PURGE_GRACE_SECONDS?: string;
}
