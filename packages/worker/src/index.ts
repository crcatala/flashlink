import { Hono } from 'hono';
import { api } from './api.ts';
import type { Env } from './env.ts';
import { errorResponse } from './http.ts';
import { serveLink } from './serve.ts';

export { Registry } from './registry.ts';

const app = new Hono<{ Bindings: Env }>();

// Static assets (landing page, robots.txt) are served by the platform before this Worker
// runs; only unmatched paths (short codes and /api/*) arrive here.
app.use('*', async (c, next) => {
  await next();
  c.res.headers.set('X-Robots-Tag', 'noindex, nofollow');
  // Nothing this Worker returns may be cached: a cached 404/410 would hide a refreshed link.
  if (!c.res.headers.has('Cache-Control')) c.res.headers.set('Cache-Control', 'no-store');
});

app.route('/api', api);
app.on(['GET', 'HEAD'], '/:code', serveLink);
app.on(['GET', 'HEAD'], '/:code/*', serveLink);

app.notFound(() => errorResponse(404, 'not_found', 'Not found.'));
app.onError((err) => {
  console.error('unhandled error', err);
  return errorResponse(500, 'internal_error', 'Internal error.');
});

export default { fetch: app.fetch };
