import { env } from 'cloudflare:workers';
import { runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Registry } from '../src/registry.ts';
import {
  TOKEN,
  authed,
  call,
  registry,
  resetState,
  rowCount,
  run,
  setExpiry,
  uploadOk,
} from './helpers.ts';

beforeEach(async () => {
  await resetState();
});

/** Swap the bucket seen by a Registry instance for one whose `delete` we control. */
function withBucket(instance: Registry, bucket: Pick<R2Bucket, 'delete'>) {
  const real = (instance as unknown as { env: typeof env }).env;
  (instance as unknown as { env: unknown }).env = { ...real, BUCKET: bucket };
  return () => {
    (instance as unknown as { env: unknown }).env = real;
  };
}

function gatedBucket() {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  return {
    release,
    bucket: {
      delete: async (keys: string | string[]) => {
        await gate;
        return env.BUCKET.delete(keys);
      },
    } as Pick<R2Bucket, 'delete'>,
  };
}

describe('sweeper vs refresh', () => {
  it('refuses a refresh that lands mid-sweep instead of acknowledging and then losing it', async () => {
    const link = await uploadOk('precious');
    await setExpiry(link.code, -8 * 86400_000); // past the grace period: due for sweeping

    const refreshResult = await runInDurableObject(registry(), async (instance) => {
      const { release, bucket } = gatedBucket();
      const restore = withBucket(instance, bucket);
      const sweeping = instance.alarm(); // flips the row to `purging`, then awaits R2
      const refreshed = await instance.refresh(link.code, 3600); // arrives mid-sweep
      release();
      await sweeping;
      restore();
      return refreshed;
    });

    expect(refreshResult.ok).toBe(false);
    expect(await rowCount()).toBe(0);
    expect(await env.BUCKET.head(`objects/${link.code}`)).toBeNull();
    expect((await call(`/${link.code}`)).status).toBe(404);
  });

  it('keeps purging rows invisible to fetch while the sweep is in flight', async () => {
    const link = await uploadOk('bytes');
    await setExpiry(link.code, -8 * 86400_000);
    const status = await runInDurableObject(registry(), async (instance) => {
      const { release, bucket } = gatedBucket();
      const restore = withBucket(instance, bucket);
      const sweeping = instance.alarm();
      const resolved = await instance.resolve(link.code, true);
      release();
      await sweeping;
      restore();
      return resolved.status;
    });
    expect(status).toBe('notfound');
  });

  it('an explicit purge cannot be undone by a concurrent refresh', async () => {
    const link = await uploadOk('bye');
    const refreshResult = await runInDurableObject(registry(), async (instance) => {
      const { release, bucket } = gatedBucket();
      const restore = withBucket(instance, bucket);
      const purging = instance.purge(link.code);
      const refreshed = await instance.refresh(link.code, 3600);
      release();
      await purging;
      restore();
      return refreshed;
    });
    expect(refreshResult.ok).toBe(false);
    expect((await call(`/${link.code}`)).status).toBe(404);
    expect(await rowCount()).toBe(0);
  });

  it('retries rows left purging when the R2 delete fails', async () => {
    const stub = registry();
    const link = await uploadOk('stubborn');
    await setExpiry(link.code, -8 * 86400_000);

    await runInDurableObject(stub, async (instance) => {
      const restore = withBucket(instance, {
        delete: async () => {
          throw new Error('R2 unavailable');
        },
      });
      await expect(instance.alarm()).rejects.toThrow('R2 unavailable');
      restore();
    });
    // Still stored, but hidden from every public path.
    expect(await rowCount()).toBe(1);
    expect(await env.BUCKET.head(`objects/${link.code}`)).not.toBeNull();
    expect((await call(`/${link.code}`)).status).toBe(404);

    // The next sweep picks the purging row back up and finishes the job.
    await runInDurableObject(stub, (instance) => instance.alarm());
    expect(await rowCount()).toBe(0);
    expect(await env.BUCKET.head(`objects/${link.code}`)).toBeNull();
  });
});

describe('late uploads', () => {
  /** A registry namespace that "reaps" the pending row right after allocation. */
  function reapingRegistry() {
    return new Proxy(env.REGISTRY, {
      get(target, prop) {
        if (prop !== 'get')
          return Reflect.get(target, prop).bind?.(target) ?? Reflect.get(target, prop);
        return (id: DurableObjectId) => {
          const stub = target.get(id);
          return new Proxy(stub, {
            get(s, method) {
              if (method !== 'allocate') return Reflect.get(s, method);
              return async (...args: Parameters<typeof stub.allocate>) => {
                const result = await stub.allocate(...args);
                if (result.ok) {
                  await runInDurableObject(stub, (_i, state) => {
                    state.storage.sql.exec('DELETE FROM links WHERE code = ?', result.code);
                  });
                }
                return result;
              };
            },
          });
        };
      },
    }) as typeof env.REGISTRY;
  }

  it('does not leave an untracked object when the pending row vanished mid-upload', async () => {
    const res = await run(
      '/api/links',
      { REGISTRY: reapingRegistry() },
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          'Content-Length': '500',
          'Content-Type': 'text/plain',
        },
        body: new Uint8Array(500),
      },
    );
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toBe('upload_failed');
    expect((await env.BUCKET.list()).objects).toHaveLength(0);
    const status = (await (await authed('/api/status')).json()) as {
      usage: { totalBytes: number; linkCount: number };
    };
    expect(status.usage).toMatchObject({ totalBytes: 0, linkCount: 0 });
  });
});
