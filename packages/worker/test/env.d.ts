import type { Env as AppEnv } from '../src/env.ts';

declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
    interface GlobalProps {
      mainModule: typeof import('../src/index.ts');
    }
  }
}
