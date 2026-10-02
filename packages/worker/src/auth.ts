const encoder = new TextEncoder();

async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

/**
 * Check a bearer token in constant time. Both values are hashed first so the comparison
 * is over fixed-length digests and the token's length can't leak.
 */
export async function isAuthorized(request: Request, token: string): Promise<boolean> {
  const header = request.headers.get('Authorization') ?? '';
  const given = /^Bearer (.+)$/.exec(header)?.[1] ?? '';
  const [a, b] = await Promise.all([sha256(given), sha256(token)]);
  return crypto.subtle.timingSafeEqual(a, b);
}
