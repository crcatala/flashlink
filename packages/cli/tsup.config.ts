import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  clean: true,
  banner: { js: '#!/usr/bin/env node' },
  // The shared core is workspace-only TypeScript source: bundle it into the CLI.
  noExternal: ['@r2-fastlink/core'],
});
