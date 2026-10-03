import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          R2FL_TOKEN: 'test-token-test-token-test-token-0123',
          // Small limits so quota paths are cheap to exercise.
          MAX_FILE_BYTES: '1000',
          MAX_TOTAL_BYTES: '3000',
          MAX_UPLOADS_PER_DAY: '6',
        },
      },
    }),
  ],
  test: { include: ['test/**/*.test.ts'] },
});
