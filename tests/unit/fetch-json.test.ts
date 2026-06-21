import { describe, expect, it } from 'vitest';
import { parseApiJson } from '@/lib/http/fetch-json';

const res = (body: string, init?: ResponseInit): Response => new Response(body, init);

describe('parseApiJson', () => {
  it('parses a success envelope', async () => {
    const env = await parseApiJson<{ ref: string }>(
      res(JSON.stringify({ ok: true, data: { ref: 'BMT-1' } }), {
        headers: { 'content-type': 'application/json' },
      }),
    );
    expect(env.ok).toBe(true);
    expect(env.data.ref).toBe('BMT-1');
  });

  it('returns a JSON error envelope as-is so the caller handles .ok', async () => {
    const env = await parseApiJson(
      res(JSON.stringify({ ok: false, error: { code: 'bad', message: 'nope' } }), { status: 400 }),
    );
    expect(env.ok).toBe(false);
    expect(env.error?.message).toBe('nope');
  });

  it('throws a clean error (never the raw "Unexpected token") on an HTML error page', async () => {
    const p = parseApiJson(res('<!DOCTYPE html><html><body>500</body></html>', { status: 500 }));
    await expect(p).rejects.toThrow(/HTTP 500/);
    await expect(p).rejects.not.toThrow(/Unexpected token/);
  });

  it('surfaces the x-request-id in the message so it can be traced in the logs', async () => {
    await expect(
      parseApiJson(res('<!DOCTYPE html>', { status: 502, headers: { 'x-request-id': 'req-abc-123' } })),
    ).rejects.toThrow(/req-abc-123/);
  });
});
