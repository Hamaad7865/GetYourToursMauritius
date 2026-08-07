import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

/**
 * POST /api/v1/admin/quotes/draft-from-email — the AI email→draft entry point (plan Task A4).
 *
 * Two things are pinned here: the STAFF gate and the AI-UNAVAILABLE path.
 *
 *  - The gate is `profiles.role`, never `requireUser().role` — which is the JWT's Postgres role
 *    selector 'authenticated', identical for staff and customer. So a customer, an SEO hire and a
 *    signed-in user with no profile are all refused 403, exactly as on the send route (a drafted quote
 *    carries the guest's name/email and shapes an offer we will price and send).
 *  - The test ctx carries the STUB ai provider (no Gemini key), so `extractQuoteFromEmail` returns
 *    available:false BEFORE any catalogue read — the billing-blocker behaviour the editor shows as "add
 *    lines by hand". The SUCCESS path (a scripted model → an extraction → the browser draft) is covered
 *    where it lives, deterministically: tests/unit/quote-extraction.test.ts (scripted model) and
 *    tests/integration/quote-draft-from-email.test.ts (injected candidates + departures).
 */

const ADMIN = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const STAFF = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const SEO = 'd4d4d4d4-d4d4-d4d4-d4d4-d4d4d4d4d4d4';
const NO_PROFILE = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';

const hoisted = vi.hoisted(() => ({
  shim: null as SupabaseShim | null,
  /** Bearer token -> auth user id. A token not in here is rejected, like a bad JWT. */
  users: new Map<string, string>(),
}));

vi.mock('@/lib/supabase/admin', () => ({
  createServiceRoleClient: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

vi.mock('@/lib/http/auth', async () => {
  const { UnauthorizedError } = await import('@/lib/services/errors');
  return {
    requireUser: async (req: Request) => {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const id = hoisted.users.get(token);
      if (!id) throw new UnauthorizedError();
      // The POSTGRES role selector a real Supabase JWT carries, never the business role: a gate
      // written against this admits every signed-in customer.
      return { id, email: 'staff@example.com', role: 'authenticated' };
    },
  };
});

const { POST } = await import('../../app/api/v1/admin/quotes/draft-from-email/route');

interface DraftBody {
  ok?: boolean;
  data?: { available: boolean; extraction: unknown; candidates: unknown };
  error?: { message?: string };
}

describe('POST /api/v1/admin/quotes/draft-from-email', () => {
  let db: TestDb;

  const EMAIL = 'Bonjour, we are 2 adults visiting 1-9 September and would love a dolphin tour.';

  async function draft(email: unknown, bearer: string | null = 'admin-token'): Promise<Response> {
    const headers = new Headers({ 'content-type': 'application/json' });
    if (bearer) headers.set('authorization', `Bearer ${bearer}`);
    return POST(
      new Request('https://x/api/v1/admin/quotes/draft-from-email', {
        method: 'POST',
        headers,
        body: JSON.stringify({ email }),
      }),
    );
  }

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.asOwner();

    await db.pg.query(`insert into auth.users (id) values ($1), ($2), ($3), ($4), ($5)`, [
      ADMIN,
      STAFF,
      CUSTOMER,
      SEO,
      NO_PROFILE,
    ]);
    await db.pg.query(
      `insert into profiles (id, full_name, role)
       values ($1, 'Owner', 'admin'), ($2, 'Guide', 'staff'), ($3, 'Guest', 'customer'),
              ($4, 'SEO hire', 'seo')`,
      [ADMIN, STAFF, CUSTOMER, SEO],
    );
    hoisted.users.set('admin-token', ADMIN);
    hoisted.users.set('staff-token', STAFF);
    hoisted.users.set('customer-token', CUSTOMER);
    hoisted.users.set('seo-token', SEO);
    hoisted.users.set('no-profile-token', NO_PROFILE);

    setRouteContext({
      db: pgliteServiceRoleRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
      locale: 'en',
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  // ── The staff gate ────────────────────────────────────────────────────────
  it('refuses a caller with no bearer token', async () => {
    expect((await draft(EMAIL, null)).status).toBe(401);
  });

  it('refuses a signed-in customer — the JWT role claim is not the business role', async () => {
    expect((await draft(EMAIL, 'customer-token')).status).toBe(403);
  });

  it('refuses a signed-in user with no profile row', async () => {
    expect((await draft(EMAIL, 'no-profile-token')).status).toBe(403);
  });

  it('refuses the SEO hire', async () => {
    expect((await draft(EMAIL, 'seo-token')).status).toBe(403);
  });

  it('refuses an empty email', async () => {
    expect((await draft('', 'staff-token')).status).toBe(400);
  });

  // ── The AI-unavailable path (no Gemini configured) ──────────────────────────
  it('admits staff and reports available:false when no model is configured', async () => {
    const res = await draft(EMAIL, 'staff-token');
    expect(res.status).toBe(200);
    const body = (await res.json()) as DraftBody;
    expect(body.ok).toBe(true);
    expect(body.data?.available).toBe(false);
    expect(body.data?.extraction).toBeNull();
    expect(body.data?.candidates).toBeNull();
  });

  it('admits an admin too', async () => {
    expect((await draft(EMAIL, 'admin-token')).status).toBe(200);
  });
});
