// The sweeper's alarm backstop (docs/ARCHITECTURE.md, "Alarm backstops"): runs at least MIN_ALARM_GAP_MS (a minute)
// apart, whatever is due. Time is faked inside the Durable Object (same isolate) and set a year ahead, so the alarms
// these tests schedule never fire for real while they run.
import { runInDurableObject } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Registry } from '../src/registry.ts';
import { registry, resetState, setExpiry, uploadOk } from './helpers.ts';

const MINUTE = 60_000;
const GRACE_MS = 7 * 86400_000;

beforeEach(async () => {
  await resetState();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Runs the sweeper each time its alarm comes due, for `ms` from now. Returns when it ran. */
async function sweepFor(
  instance: Registry,
  state: DurableObjectState,
  ms: number,
): Promise<number[]> {
  const end = Date.now() + ms;
  const runs: number[] = [];
  for (let at = await state.storage.getAlarm(); at !== null && at <= end && runs.length < 10_000;) {
    vi.setSystemTime(at);
    runs.push(at);
    await instance.alarm();
    at = await state.storage.getAlarm();
    if (at === runs.at(-1)) break; // not rescheduled
  }
  vi.setSystemTime(end);
  return runs;
}

describe('sweeper alarm backstop', () => {
  it('never runs more than once a minute, even if something stays due "now"', async () => {
    const runs = await runInDurableObject(registry(), async (instance, state) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 365 * 86400_000);
      // A bug: the sweeper always finds something due right now. Without the gap it re-runs back to back.
      const stubbed = instance as unknown as { nextDue?: () => number };
      stubbed.nextDue = () => Date.now();
      try {
        await state.storage.setAlarm(Date.now());
        return await sweepFor(instance, state, 10 * MINUTE);
      } finally {
        delete stubbed.nextDue; // the instance is shared by every test
      }
    });

    // The first run, then one a minute: not more (the gap), and not fewer (it still sweeps).
    expect(runs.length).toBe(11);
    for (let i = 1; i < runs.length; i++)
      expect(runs[i]! - runs[i - 1]!).toBeGreaterThanOrEqual(MINUTE);
  });

  it('purges a link that comes due just after a sweep at most a minute later', async () => {
    const first = await uploadOk('first');
    const second = await uploadOk('second');
    const result = await runInDurableObject(registry(), async (instance, state) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const start = Date.now() + 365 * 86400_000;
      vi.setSystemTime(start);
      // Two links whose grace periods end 10 s apart.
      const setDue = (code: string, at: number) =>
        state.storage.sql.exec(
          'UPDATE links SET expires_at = ? WHERE code = ?',
          at - GRACE_MS,
          code,
        );
      setDue(first.code, start + MINUTE);
      setDue(second.code, start + MINUTE + 10_000);
      await state.storage.setAlarm(start + MINUTE);
      const runs = await sweepFor(instance, state, 3 * MINUTE);
      const left = state.storage.sql.exec<{ n: number }>('SELECT COUNT(*) AS n FROM links').one().n;
      return { start, runs, left };
    });

    expect(result.runs).toEqual([result.start + MINUTE, result.start + 2 * MINUTE]);
    expect(result.left).toBe(0);
  });

  it('schedules a normal purge exactly when its grace period ends', async () => {
    const link = await uploadOk('on time');
    await setExpiry(link.code, -MINUTE);
    const { alarm, due } = await runInDurableObject(registry(), async (instance, state) => {
      // A sweep that finds nothing to purge yet reschedules for the link's own time.
      await instance.alarm();
      const row = state.storage.sql
        .exec<{ expires_at: number }>('SELECT expires_at FROM links WHERE code = ?', link.code)
        .one();
      return { alarm: await state.storage.getAlarm(), due: row.expires_at + GRACE_MS };
    });

    expect(alarm).toBe(due);
  });
});
