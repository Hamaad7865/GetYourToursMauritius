import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetServerEnvCache } from '@/lib/config/env';

/**
 * The error-log sink runs INSIDE catch blocks that are already handling a failure, on a request the
 * customer is waiting for. Its three contracts are load-bearing, and each is asserted here:
 *
 *  1. it never throws — a throw would turn a handled 500 into an unhandled one, i.e. exactly the
 *     invisible crash the error_logs table was built to expose;
 *  2. it never waits on the default 15s upstream timeout — a sick database must not add fifteen
 *     seconds to an already-failing response;
 *  3. it does nothing at all without a service-role key, so local dev and preview builds (no Supabase)
 *     don't spew connection errors on every handled error.
 */
const { rpc, createServiceRoleClient } = vi.hoisted(() => ({
  rpc: vi.fn(async (_fn: string, _params: Record<string, unknown>) => ({ ok: true })),
  createServiceRoleClient: vi.fn((_timeoutMs?: number) => ({ tag: 'service-role-client' })),
}));

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient }));
vi.mock('@/lib/supabase/rpc', () => ({ supabaseRpc: () => ({ rpc }) }));

const { recordError, describeThrown } = await import('@/lib/error-log');

const base = { source: 'api', event: 'unhandled_api_error', message: 'boom' } as const;

beforeEach(() => {
  rpc.mockClear();
  createServiceRoleClient.mockClear();
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key-present';
  resetServerEnvCache();
});

afterEach(() => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  resetServerEnvCache();
  vi.restoreAllMocks();
});

describe('recordError', () => {
  it('writes the failure through api_log_error', async () => {
    await recordError({ ...base, errorName: 'TypeError', route: '/api/v1/bookings', status: 500 });

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, params] = rpc.mock.calls[0]!;
    expect(fn).toBe('api_log_error');
    expect(params).toMatchObject({
      source: 'api',
      event: 'unhandled_api_error',
      message: 'boom',
      errorName: 'TypeError',
      route: '/api/v1/bookings',
      status: 500,
    });
  });

  it('uses a short upstream timeout, not the 15s default', async () => {
    await recordError(base);
    // A failing request must not ALSO wait out the default Supabase timeout before rendering its error.
    expect(createServiceRoleClient).toHaveBeenCalledWith(3_000);
  });

  it('clamps message and stack before they reach the wire', async () => {
    await recordError({ ...base, message: 'm'.repeat(5_000), stack: 's'.repeat(20_000) });

    const params = rpc.mock.calls[0]![1] as unknown as { message: string; stack: string };
    expect(params.message).toHaveLength(2_000);
    expect(params.stack).toHaveLength(8_000);
  });

  it('does nothing without a service-role key (dev / preview builds)', async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    resetServerEnvCache();

    await expect(recordError(base)).resolves.toBeUndefined();
    expect(createServiceRoleClient).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it('swallows its own failure — the database being down cannot escalate the original error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    rpc.mockRejectedValueOnce(new Error('supabase unreachable'));

    await expect(recordError(base)).resolves.toBeUndefined();
    expect(consoleError).toHaveBeenCalled();
  });

  it('swallows a client that cannot even be constructed', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    createServiceRoleClient.mockImplementationOnce(() => {
      throw new Error('config error');
    });

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
