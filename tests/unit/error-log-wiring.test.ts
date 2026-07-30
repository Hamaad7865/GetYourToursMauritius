import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfigError, NotFoundError, ValidationError } from '@/lib/services/errors';

/**
 * What actually lands in `error_logs`. The table is only as useful as its signal-to-noise ratio, so
 * the selection rule is the thing worth pinning: real crashes in, caller mistakes out.
 *
 * A 4xx ServiceError is the CALLER's mistake — a bad date, a missing field, a booking that isn't
 * theirs. Recording those would bury the genuine failures under routine 404s within a day, and the
 * operator's `select * from error_logs order by created_at desc` would stop being worth running.
 */
const { record } = vi.hoisted(() => ({ record: vi.fn(async () => {}) }));

vi.mock('@/lib/error-log', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/error-log')>()),
  recordError: record,
}));

const { apiHandler } = await import('@/lib/http/handler');

const req = () => new Request('https://example.test/api/v1/thing', { method: 'POST' });

const throwing = (error: unknown) =>
  apiHandler(async () => {
    throw error;
  });

beforeEach(() => {
  record.mockClear();
});

describe('apiHandler → error_logs', () => {
  it('records an unhandled throw with the REAL message, not the generic response text', async () => {
    const res = await throwing(new TypeError('cannot read properties of undefined'))(req());
    expect(res.status).toBe(500);

    expect(record).toHaveBeenCalledTimes(1);
    const [entry] = record.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      source: 'api',
      event: 'unhandled_api_error',
      errorName: 'TypeError',
      message: 'cannot read properties of undefined',
      route: '/api/v1/thing',
      method: 'POST',
      status: 500,
    });
    // The body only ever carries "Something went wrong"; the internal detail lives in the table.
    const body = (await res.json()) as { error: { message: string } };
    expect(body.error.message).toBe('Something went wrong');
  });

  it('ties the row to the x-request-id the caller was given', async () => {
    const res = await throwing(new Error('boom'))(req());
    const [entry] = record.mock.calls[0] as unknown as [{ requestId: string }];
    // A customer quoting their error id must resolve to exactly one row.
    expect(entry.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('records a 5xx ServiceError under its own event, carrying the code', async () => {
    const res = await throwing(new ConfigError('RESEND_API_KEY is missing'))(req());
    expect(res.status).toBeGreaterThanOrEqual(500);

    const [entry] = record.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(entry).toMatchObject({
      event: 'service_error',
      message: 'RESEND_API_KEY is missing',
      context: { code: 'config_error' },
    });
  });

  it('ignores 4xx ServiceErrors — caller mistakes are not incidents', async () => {
    await throwing(new ValidationError('Invalid request'))(req());
    await throwing(new NotFoundError('No such booking'))(req());
    expect(record).not.toHaveBeenCalled();
  });

  it('ignores a successful response', async () => {
    await apiHandler(async () => new Response('{}', { status: 200 }))(req());
    expect(record).not.toHaveBeenCalled();
  });

  it('ignores a deliberately RETURNED 5xx (a config gate, not a crash)', async () => {
    // e.g. the maintenance route's "not_configured" 503 — a state, not a failure, and it would
    // otherwise write a row on every cron tick of a misconfigured deploy.
    await apiHandler(async () => new Response('{}', { status: 503 }))(req());
    expect(record).not.toHaveBeenCalled();
  });
});
