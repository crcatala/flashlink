import type { Env } from './env.ts';

/** The one and only registry instance. Never derive names from users, IPs or links. */
const REGISTRY_NAME = 'registry';

export function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME));
}
