import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The error-log sink runs INSIDE catch blocks that are already handling a failure, on a request the
 * customer is waiting for. Its contracts are load-bearing, and each is asserted here:
 *
 *  1. it never throws — a throw would turn a handled 500 into an unhandled one, i.e. exactly the
 *     invisible crash the error_logs table was built to expose;
 *  2. it aborts after 3s rather than waiting out a sick database on an already-failing response;
 *  3. it does nothing at all without a service-role key, so local dev and preview builds (no Supabase)
 *     don't spew connection errors on every handled error;
 *  4. it imports NOTHING — `instrumentation.ts` is inlined into every edge function, so a shared
 *     chunked import here breaks the next-on-pages build (see the module header). The static-import
 *     assertion at the bottom is the guard for that; it has bitten CI once already.
 */
const { recordError, describeThrown } = await import('@/lib/error-log');

const base = { source: 'api', event: 'unhandled_api_error', message: 'boom' } as const;

const okResponse = () => new Response('{}', { status: 200 });

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
  fetchMock = vi.fn(async () => okResponse());
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const lastCall = (): { url: string; init: RequestInit & { body: string } } => {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit & { body: string }];
  return { url, init };
};

describe('recordError', () => {
  it('POSTs the failure to the api_log_error RPC', async () => {
    await recordError({ ...base, errorName: 'TypeError', route: '/api/v1/bookings', status: 500 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const { url, init } = lastCall();
    expect(url).toBe('https://project.supabase.co/rest/v1/rpc/api_log_error');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body) as { p: Record<string, unknown> };
    expect(body.p).toMatchObject({
      source: 'api',
      event: 'unhandled_api_error',
      message: 'boom',
      errorName: 'TypeError',
      route: '/api/v1/bookings',
      status: 500,
    });
  });

  it('authenticates as the service role', async () => {
    await recordError(base);
    const headers = lastCall().init.headers as Record<string, string>;
    expect(headers.apikey).toBe('service-role-key-present');
    expect(headers.authorization).toBe('Bearer service-role-key-present');
  });

  it('tolerates a trailing slash on the Supabase URL', async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co/';
    await recordError(base);
    expect(lastCall().url).toBe('https://project.supabase.co/rest/v1/rpc/api_log_error');
  });

  it('aborts after 3s rather than stalling an already-failing response', async () => {
    await recordError(base);
    // Without a bound, a hung database would add its full timeout to a 500 the customer is watching.
    expect(lastCall().init.signal).toBeInstanceOf(AbortSignal);
  });

  it('clamps message and stack before they reach the wire', async () => {
    await recordError({ ...base, message: 'm'.repeat(5_000), stack: 's'.repeat(20_000) });

    const body = JSON.parse(lastCall().init.body) as { p: { message: string; stack: string } };
    expect(body.p.message).toHaveLength(2_000);
    expect(body.p.stack).toHaveLength(8_000);
  });

  it('does nothing without a service-role key (dev / preview builds)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    await expect(recordError(base)).resolves.toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected request — the database being down cannot escalate the original error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('supabase unreachable'));

    await expect(recordError(base)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it('swallows a non-2xx response', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 500 }));

    await expect(recordError(base)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });
});

describe('describeThrown', () => {
  it('expands an Error into name / message / stack', () => {
    const described = describeThrown(new TypeError('nope'));
    expect(described.errorName).toBe('TypeError');
    expect(described.message).toBe('nope');
    expect(described.stack).toContain('TypeError');
  });

  it('stringifies a non-Error throw rather than storing "{}"', () => {
    // `throw 'oops'` and `throw {code:1}` are legal JS; both used to serialise to an empty object.
    expect(describeThrown('oops')).toMatchObject({ errorName: 'string', message: 'oops' });
    expect(describeThrown({ code: 1 }).message).toBe('[object Object]');
  });
});

describe('bundle isolation', () => {
  it('has no static imports — instrumentation.ts is inlined into every edge function', async () => {
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(new URL('../../src/lib/error-log.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/^\s*import\s.+$/gm)].map((m) => m[0].trim());

    // A shared chunked module here puts the same webpack identifier in both the instrumentation
    // prelude and the route body of one generated function, and next-on-pages aborts the build:
    // "A duplicated identifier has been detected in the same function file". That failed CI once.
    expect(
      imports,
      `error-log.ts must stay a dependency-free leaf, found: ${imports.join('; ')}`,
    ).toEqual([]);
  });
});
