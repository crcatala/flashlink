/** Public description of a link, as returned by the API. Timestamps are ISO 8601. */
export interface LinkInfo {
  code: string;
  filename: string;
  contentType: string;
  size: number;
  createdAt: string;
  expiresAt: string;
  /** True once `expiresAt` has passed (or the link was revoked or exhausted). */
  expired: boolean;
  /** Per-window download cap, or null for unlimited. */
  maxDownloads: number | null;
  /** Total fetches over the link's lifetime. */
  hits: number;
  lastHitAt: string | null;
}

/** Response of an upload: the link plus its public URLs. */
export interface UploadResult extends LinkInfo {
  /** Short URL: `<base>/<code>`. */
  url: string;
  /** Same link with the filename appended: `<base>/<code>/<filename>`. */
  urlWithName: string;
}

export interface RefreshResult extends LinkInfo {
  url: string;
}

export interface ServerLimits {
  maxFileBytes: number;
  maxTtlSeconds: number;
  defaultTtlSeconds: number;
  maxTotalBytes: number;
  maxUploadsPerDay: number;
  purgeGraceSeconds: number;
}

export interface ServerStatus {
  limits: ServerLimits;
  usage: {
    linkCount: number;
    activeCount: number;
    totalBytes: number;
    uploadsToday: number;
  };
}

export interface ApiErrorBody {
  error: string;
  message: string;
}

/** Error codes returned in `ApiErrorBody.error`. */
export type ApiErrorCode =
  | 'unauthorized'
  | 'not_configured'
  | 'rate_limited'
  | 'bad_request'
  | 'length_required'
  | 'file_too_large'
  | 'empty_file'
  | 'ttl_too_long'
  | 'storage_full'
  | 'daily_limit'
  | 'exists'
  | 'not_found'
  | 'gone'
  | 'upload_failed'
  | 'internal_error';
