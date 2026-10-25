import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { makeSupabaseShim, type SupabaseShim } from '../db/supabase-pglite';
import { pgliteServiceRoleRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { seedTeamRole } from '../db/team';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';
import type { PermissionKey } from '@/lib/admin/permissions';

/**
 * The section gate on the admin routes that have no suite of their own: AI assistant, installment
 * reminder, the two document routes, SEO AI fix, Search Console and live Google reviews.
 *
 * Each route requires ONE permission, read from the caller's `profiles` row + team role through the
 * service-role client (`loadCallerAccess`) — never from `requireUser().role`, which is the JWT's
 * Postgres selector ('authenticated') for staff and customer alike. So per route this pins: the
 * Owner and a role holding exactly that section get past the gate; a role holding a DIFFERENT
 * section, a staff account with no role at all, a customer and a signed-in user with no profile are
 * all refused 403 with a message naming the section. "Past the gate" means anything but 401/403 —
 * these routes' real work (a model, Google, a mailbox) is not what is under test.
 */

const OWNER = 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
const BARE = 'b2b2b2b2-b2b2-b2b2-b2b2-b2b2b2b2b2b2';
const CUSTOMER = 'c3c3c3c3-c3c3-c3c3-c3c3-c3c3c3c3c3c3';
const NO_PROFILE = 'e5e5e5e5-e5e5-e5e5-e5e5-e5e5e5e5e5e5';
const WRONG_SECTION = '16161616-1616-1616-1616-161616161616';
const CONTENT = '17171717-1717-1717-1717-171717171717';

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

// The documents routes read as the CALLER; the shim stands in for that client (an empty table is a 404).
vi.mock('@/lib/supabase/client', () => ({
  createUserClient: () => {
    if (!hoisted.shim) throw new Error('shim not initialised');
    return hoisted.shim;
  },
}));

// The SEO AI fix lists every page before it does anything; an empty site keeps it quick and quiet.
vi.mock('@/lib/seo/page-groups', () => ({
  buildSeoPageGroups: async () => [],
  buildAuditPages: async () => [],
}));
vi.mock('@/lib/content/blog-live', () => ({ loadPosts: async () => [] }));

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
    publicServiceContext: () => mod.requireRouteContext(),
  };
});

vi.mock('@/lib/http/auth', async () => {
  const { UnauthorizedError } = await import('@/lib/services/errors');
  return {
    getBearerToken: (req: Request) => req.headers.get('authorization')?.slice(7) ?? null,
    requireUser: async (req: Request) => {
      const header = req.headers.get('authorization') ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const id = hoisted.users.get(token);
      if (!id) throw new UnauthorizedError();
      // The POSTGRES role selector a real Supabase JWT carries, never the business role.
      return { id, email: 'someone@example.com', role: 'authenticated' };
    },
  };
});

const DOC_ID = '99999999-9999-9999-9999-999999999999';

interface Case {
  name: string;
  permission: PermissionKey;
  /** The section named in the refusal message. */
  section: string;
  /** Whether a Content-only role may hold the permission (so passes the gate). */
  contentMay: boolean;
  call(token: string | null): Promise<Response>;
}

function req(url: string, method: string, token: string | null, body?: unknown): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (token) headers.set('authorization', `Bearer ${token}`);
  return new Request(url, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const CASES: Case[] = [
  {
    name: 'POST /admin/assistant',
    permission: 'section.assistant',
    section: 'the AI assistant',
    contentMay: false,
    call: async (t) => {
      const { POST } = await import('../../app/api/v1/admin/assistant/route');
      return POST(
        req('https://x/api/v1/admin/assistant', 'POST', t, {
          messages: [{ role: 'user', content: 'hello' }],
          page: { path: '/admin', screen: 'Dashboard' },
        }),
      );
    },
  },
  {
    name: 'POST /admin/bookings/:ref/installments/:seq/remind',
    permission: 'section.bookings',
    section: 'Bookings',
    contentMay: false,
    call: async (t) => {
      const { POST } =
        await import('../../app/api/v1/admin/bookings/[ref]/installments/[seq]/remind/route');
      return POST(req('https://x/remind', 'POST', t, {}), {
        params: Promise.resolve({ ref: 'BMTNOPE', seq: '1' }),
      });
    },
  },
  {
    name: 'GET /admin/documents/:id/pdf',
    permission: 'section.documents',
    section: 'Documents',
    contentMay: false,
    call: async (t) => {
      const { GET } = await import('../../app/api/v1/admin/documents/[id]/pdf/route');
      return GET(req('https://x/pdf', 'GET', t), { params: Promise.resolve({ id: DOC_ID }) });
    },
  },
  {
    name: 'POST /admin/documents/:id/email',
    permission: 'section.documents',
    section: 'Documents',
    contentMay: false,
    call: async (t) => {
      const { POST } = await import('../../app/api/v1/admin/documents/[id]/email/route');
      return POST(req('https://x/email', 'POST', t, {}), {
        params: Promise.resolve({ id: DOC_ID }),
      });
    },
  },
  {
    name: 'POST /seo/ai-fix',
    permission: 'section.seo',
    section: 'SEO',
    contentMay: true,
    call: async (t) => {
      const { POST } = await import('../../app/api/v1/seo/ai-fix/route');
      return POST(req('https://x/api/v1/seo/ai-fix', 'POST', t, { path: '/' }));
    },
  },
  {
    name: 'GET /seo/search-console',
    permission: 'section.seo',
    section: 'SEO',
    contentMay: true,
    call: async (t) => {
      const { GET } = await import('../../app/api/v1/seo/search-console/route');
      return GET(req('https://x/api/v1/seo/search-console?days=28', 'GET', t));
    },
  },
  {
    name: 'GET /reviews/google-live',
    permission: 'section.reviews',
    section: 'Reviews',
    contentMay: false,
    call: async (t) => {
      const { GET } = await import('../../app/api/v1/reviews/google-live/route');
      return GET(req('https://x/api/v1/reviews/google-live?placeId=abc', 'GET', t));
    },
  },
];

describe('the section gate on the remaining admin routes', () => {
  let db: TestDb;
  /** permission -> token of an account whose role holds exactly that permission. */
  const holders = new Map<PermissionKey, string>();

  beforeAll(async () => {
    db = await createTestDb();
    hoisted.shim = makeSupabaseShim(db.pg);
    await db.asOwner();

    const holderPerms = [...new Set(CASES.map((c) => c.permission))];
    const holderIds = holderPerms.map((_, i) => `2${i}000000-0000-0000-0000-000000000000`);
    const everyone = [OWNER, BARE, CUSTOMER, WRONG_SECTION, CONTENT, ...holderIds];
    for (const id of everyone) {
      await db.pg.query(`insert into auth.users (id) values ($1)`, [id]);
    }
    await db.pg.query(
      `insert into profiles (id, full_name, role)
       values ($1, 'Owner', 'admin'), ($2, 'Bare', 'staff'), ($3, 'Guest', 'customer'),
              ($4, 'Calendar', 'staff'), ($5, 'Writer', 'seo')`,
      [OWNER, BARE, CUSTOMER, WRONG_SECTION, CONTENT],
    );
    for (const [i, permission] of holderPerms.entries()) {
      const id = holderIds[i]!;
      await db.pg.query(
        `insert into profiles (id, full_name, role) values ($1, 'Holder', 'staff')`,
        [id],
      );
      await seedTeamRole(db, id, [permission]);
      hoisted.users.set(`holder-${permission}`, id);
      holders.set(permission, `holder-${permission}`);
    }
    // A role with a section none of these routes need: the "wrong section" refusal.
    await seedTeamRole(db, WRONG_SECTION, ['section.calendar']);
    // A Content-only role that holds the SEO section and the blog.
    await seedTeamRole(db, CONTENT, ['section.seo', 'section.blog'], 'content');

    hoisted.users.set('owner-token', OWNER);
    hoisted.users.set('bare-token', BARE);
    hoisted.users.set('customer-token', CUSTOMER);
    hoisted.users.set('wrong-section-token', WRONG_SECTION);
    hoisted.users.set('content-token', CONTENT);
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

  const passedGate = (res: Response) => res.status !== 401 && res.status !== 403;

  describe.each(CASES)('$name', (c) => {
    it('refuses a caller with no bearer token', async () => {
      expect((await c.call(null)).status).toBe(401);
    });

    it.each([
      ['a signed-in customer — the JWT role claim is not the business role', 'customer-token'],
      ['a signed-in user with no profile row', 'no-profile-token'],
      ['a staff account with no team role yet (fail closed)', 'bare-token'],
      ['a staff role that holds a different section', 'wrong-section-token'],
    ])('refuses %s', async (_label, token) => {
      const res = await c.call(token);
      expect(res.status).toBe(403);
      const body = (await res.json()) as { error?: { message?: string } };
      expect(body.error?.message).toContain(c.section);
    });

    it(`${c.contentMay ? 'admits' : 'refuses'} a Content-only account`, async () => {
      const res = await c.call('content-token');
      if (c.contentMay) expect(passedGate(res)).toBe(true);
      else expect(res.status).toBe(403);
    });

    it(`admits a role holding ${c.permission}`, async () => {
      const res = await c.call(holders.get(c.permission)!);
      expect(passedGate(res)).toBe(true);
    });

    it('admits the Owner', async () => {
      expect(passedGate(await c.call('owner-token'))).toBe(true);
    });
  });
});
