import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  addEntry,
  dropEntry,
  pruneEntries,
  MAX_RELEASE_ATTEMPTS,
  type ReleaseEntry,
} from '@/lib/cart/release-queue';

// The durable retry queue behind review item 5: a release that fails (or never completes, because the
// tab closed mid-request) must stay recorded so the cart's tick can retry it — instead of stranding a
// held seat for the full 30-minute TTL with nothing tracking it.
describe('release queue entries', () => {
  const t0 = 1_700_000_000_000;

  it('records a hold write-ahead, with its first-attempt timestamp', () => {
    const list = addEntry([], 'hold-1', t0);
    expect(list).toEqual([{ holdId: 'hold-1', queuedAt: t0, attempts: 1 }]);
  });

  it('re-queuing keeps the ORIGINAL queuedAt and bumps attempts (TTL runs from the first try)', () => {
    const once = addEntry([], 'hold-1', t0);
    const twice = addEntry(once, 'hold-1', t0 + 60_000);
    expect(twice).toHaveLength(1);
    expect(twice[0]).toEqual({ holdId: 'hold-1', queuedAt: t0, attempts: 2 });
  });

  it('keeps distinct holds side by side', () => {
    const list = addEntry(addEntry([], 'hold-1', t0), 'hold-2', t0 + 5);
    expect(list.map((e) => e.holdId)).toEqual(['hold-1', 'hold-2']);
  });

  it('drops a settled hold (released, or permanently refused)', () => {
    const list = addEntry(addEntry([], 'hold-1', t0), 'hold-2', t0);
    expect(dropEntry(list, 'hold-1').map((e) => e.holdId)).toEqual(['hold-2']);
    // Dropping something absent is a no-op, not a throw.
    expect(dropEntry(list, 'nope')).toHaveLength(2);
  });

  it('prunes entries past the hold TTL — that seat already freed itself', () => {
    const list: ReleaseEntry[] = [{ holdId: 'old', queuedAt: t0, attempts: 1 }];
    // 29 minutes in: still worth retrying. 31 minutes: the hold has expired server-side.
    expect(pruneEntries(list, t0 + 29 * 60_000)).toHaveLength(1);
    expect(pruneEntries(list, t0 + 31 * 60_000)).toHaveLength(0);
  });

  it('prunes entries past the attempt cap instead of retrying every tick', () => {
    const atCap: ReleaseEntry[] = [
      { holdId: 'stubborn', queuedAt: t0, attempts: MAX_RELEASE_ATTEMPTS },
    ];
    const underCap: ReleaseEntry[] = [
      { holdId: 'stubborn', queuedAt: t0, attempts: MAX_RELEASE_ATTEMPTS - 1 },
    ];
    expect(pruneEntries(atCap, t0 + 1000)).toHaveLength(0);
    expect(pruneEntries(underCap, t0 + 1000)).toHaveLength(1);
  });

  it('prunes a corrupt timestamp rather than retrying it forever', () => {
    const bad = [{ holdId: 'x', queuedAt: NaN, attempts: 1 }] as ReleaseEntry[];
    expect(pruneEntries(bad, t0)).toHaveLength(0);
  });
});

// The queue only drops an entry when the server confirms the release OR permanently refuses it, so
// releaseHoldRequest has to distinguish the two.
describe('releaseHoldRequest outcome', () => {
  afterEach(() => vi.unstubAllGlobals());

  async function load() {
    vi.resetModules();
    vi.doMock('@/lib/supabase/browser', () => ({
      getBrowserSupabase: () => ({
        auth: { getSession: async () => ({ data: { session: null } }) },
      }),
    }));
    return (await import('@/lib/cart/holdClient')).releaseHoldRequest;
  }

  it('reports success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    expect(await (await load())('hold-1')).toEqual({ ok: true });
  });

  it('marks a 4xx PERMANENT so the queue drops it (401 guest, 403 not-owner, 409 attached)', async () => {
    for (const status of [401, 403, 404, 409]) {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => new Response('{}', { status })),
      );
      const outcome = await (await load())('hold-1');
      expect(outcome).toEqual({ ok: false, permanent: true, status });
    }
  });

  it('marks a 5xx TRANSIENT (retryable) after its in-line retry', async () => {
    const fetchMock = vi.fn(async () => new Response('{}', { status: 503 }));
    vi.stubGlobal('fetch', fetchMock);
    const outcome = await (await load())('hold-1');
    expect(outcome).toEqual({ ok: false, permanent: false, status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(2); // tried twice before giving the caller the queue
  });

  it('marks a network rejection TRANSIENT and never throws', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    expect(await (await load())('hold-1')).toEqual({
      ok: false,
      permanent: false,
      status: undefined,
    });
  });

  it('succeeds on the second try after one transient failure', async () => {
    let call = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        call += 1;
        return call === 1
          ? new Response('{}', { status: 500 })
          : new Response('{}', { status: 200 });
      }),
    );
    expect(await (await load())('hold-1')).toEqual({ ok: true });
  });
});
