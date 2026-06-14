import { describe, expect, it } from 'vitest';
import { supabaseRpc } from '@/lib/supabase/rpc';

/**
 * Regression guard: supabase-js's client.rpc() reads `this.rest`, so the adapter must
 * preserve `this`. Calling a detached reference throws
 * "Cannot read properties of undefined (reading 'rest')" — which only surfaced against
 * a real Supabase (the PGlite adapter is used in every other test).
 */
describe('supabaseRpc', () => {
  it('preserves `this` so client.rpc can reach this.rest', async () => {
    const fakeClient = {
      rest: { id: 'rest-client' },
      rpc(name: string, args: { p: Record<string, unknown> }) {
        return Promise.resolve({ data: { name, p: args.p, via: this.rest.id }, error: null });
      },
    };
    const db = supabaseRpc(fakeClient as never);
    const result = await db.rpc('api_search_activities', { q: 'x', page: 1 });
    expect(result).toEqual({
      name: 'api_search_activities',
      p: { q: 'x', page: 1 },
      via: 'rest-client',
    });
  });

  it('wraps the function args under the single jsonb `p` param', async () => {
    let received: unknown;
    const fakeClient = {
      rest: {},
      rpc(_name: string, args: unknown) {
        received = args;
        return Promise.resolve({ data: null, error: null });
      },
    };
    await supabaseRpc(fakeClient as never).rpc('api_get_activity', { slug: 'a' });
    expect(received).toEqual({ p: { slug: 'a' } });
  });

  it('throws the PostgREST error message', async () => {
    const fakeClient = {
      rest: {},
      rpc() {
        return Promise.resolve({ data: null, error: { message: 'boom' } });
      },
    };
    await expect(supabaseRpc(fakeClient as never).rpc('api_x', {})).rejects.toThrow('boom');
  });
});
