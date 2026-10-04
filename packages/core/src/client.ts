import type { ApiErrorBody, LinkInfo, RefreshResult, ServerStatus, UploadResult } from './types.ts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UploadOptions {
  filename: string;
  contentType: string;
  body: Uint8Array;
  ttlSeconds?: number;
  maxDownloads?: number;
  /** Re-create a specific (purged) code instead of allocating a new one. */
  code?: string;
}

/** Thin typed client for the flashlink Worker API. */
export class FastlinkClient {
  readonly endpoint: string;

  constructor(
    endpoint: string,
    private readonly token: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = endpoint.replace(/\/+$/, '');
  }

  upload(opts: UploadOptions): Promise<UploadResult> {
    const headers: Record<string, string> = {
      'Content-Type': opts.contentType,
      'X-Filename': encodeURIComponent(opts.filename),
    };
    if (opts.ttlSeconds !== undefined) headers['X-TTL-Seconds'] = String(opts.ttlSeconds);
    if (opts.maxDownloads !== undefined) headers['X-Max-Downloads'] = String(opts.maxDownloads);
    const path = opts.code ? `/api/links/${opts.code}` : '/api/links';
    return this.request<UploadResult>(opts.code ? 'PUT' : 'POST', path, {
      headers,
      body: opts.body,
    });
  }

  get(code: string): Promise<LinkInfo> {
    return this.request('GET', `/api/links/${code}`);
  }

  async lookup(codes: string[]): Promise<Record<string, LinkInfo | null>> {
    const res = await this.request<{ links: Record<string, LinkInfo | null> }>(
      'POST',
      '/api/links/lookup',
      { json: { codes } },
    );
    return res.links;
  }

  refresh(code: string, ttlSeconds?: number): Promise<RefreshResult> {
    return this.request('POST', `/api/links/${code}/refresh`, { json: { ttlSeconds } });
  }

  revoke(code: string): Promise<LinkInfo> {
    return this.request('POST', `/api/links/${code}/revoke`);
  }

  async purge(code: string): Promise<void> {
    await this.request('DELETE', `/api/links/${code}`);
  }

  status(): Promise<ServerStatus> {
    return this.request('GET', '/api/status');
  }

  private async request<T>(
    method: string,
    path: string,
    init: { headers?: Record<string, string>; body?: Uint8Array; json?: unknown } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      ...init.headers,
    };
    let body: RequestInit['body'];
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(init.json);
    } else if (init.body) {
      body = init.body as RequestInit['body'];
    }
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.endpoint}${path}`, { method, headers, body });
    } catch (err) {
      throw new ApiError(0, 'network', `Could not reach ${this.endpoint}: ${errorMessage(err)}`);
    }
    if (!res.ok) {
      let parsed: Partial<ApiErrorBody> = {};
      try {
        parsed = (await res.json()) as Partial<ApiErrorBody>;
      } catch {
        // non-JSON error body
      }
      throw new ApiError(
        res.status,
        parsed.error ?? 'http_error',
        parsed.message ?? `Request failed with status ${res.status}`,
      );
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
