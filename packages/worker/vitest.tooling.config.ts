import { defineConfig } from 'vitest/config';

// Source checks that read files from disk (test/tooling): plain node, not the Workers pool.
export default defineConfig({
  test: { include: ['test/tooling/**/*.test.ts'], environment: 'node' },
});
