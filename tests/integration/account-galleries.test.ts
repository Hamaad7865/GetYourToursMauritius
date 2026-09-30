import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SignJWT } from 'jose';
import { PHOTOGRAPHY_COVER_KEY } from '@/lib/catalogue/photography';

/**
 * GET /api/v1/account/galleries — the signed-in customer's photography galleries.
 *
 * The route reads through the SERVICE ROLE (RLS is bypassed), so everything that keeps it safe lives
 * in the route itself, and that is what these tests pin against a fake PostgREST client:
 *
 *   - it only ever reads the CALLER's own bookings (one customer never sees another's photos);
 *   - an undelivered gallery, a booking with no photos, a non-photography booking and a booking that
 *     is not live never list at all;
 *   - a LOCKED gallery (delivered, balance owed) never puts a gallery file URL on the wire — the
 *     files sit in a public bucket, so a URL is a bearer credential. It shows the package's public
 *     catalogue cover instead;
 *   - an OPEN gallery shows its first photo.
 *
 * The fake applies eq / in / not filters for real, so a route that forgot the user filter (or read
 * every booking) would leak the other customer's rows here.
 */
type Row = Record<string, unknown>;
type Filter =
  | { op: 'eq'; col: string; val: unknown }
  | { op: 'in'; col: string; val: readonly unknown[] }
  | { op: 'not'; col: string; operator: string; val: unknown };

const tables: Record<string, Row[]> = {};
const reads: Array<{ table: string; filters: Filter[] }> = [];

function matches(row: Row, f: Filter): boolean {
  if (f.op === 'eq') return row[f.col] === f.val;
  if (f.op === 'in') return f.val.includes(row[f.col]);
  if (f.operator === 'is' && f.val === null) return row[f.col] != null; // .not(col, 'is', null)
  throw new Error(`fake db: unsupported not(${f.col}, ${f.operator})`);
}

function from(table: string) {
  const filters: Filter[] = [];
  const builder = {
    select: () => builder,
    eq: (col: string, val: unknown) => (filters.push({ op: 'eq', col, val }), builder),
    in: (col: string, val: readonly unknown[]) => (filters.push({ op: 'in', col, val }), builder),
    not: (col: string, operator: string, val: unknown) => (
      filters.push({ op: 'not', col, operator, val }),
      builder
    ),
    order: () => builder,
    then: <T>(resolve: (v: { data: Row[]; error: null }) => T, reject?: (e: unknown) => T) => {
      reads.push({ table, filters: [...filters] });
      const data = (tables[table] ?? []).filter((row) => filters.every((f) => matches(row, f)));
      return Promise.resolve({ data, error: null }).then(resolve, reject);
    },
  };
  return builder;
}

vi.mock('@/lib/supabase/admin', () => ({ createServiceRoleClient: () => ({ from }) }));
const { GET } = await import('../../app/api/v1/account/galleries/route');

const USER_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const USER_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const USER_NONE = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const SECRET = process.env.SUPABASE_JWT_SECRET ?? 'test-jwt-secret-must-be-long-enough-1234567890';
const DELIVERED = '2026-10-14T09:00:00.000Z';
const COUPLES_COVER = 'https://cdn.example/covers/couples.jpg';
const FAMILY_CATALOGUE_IMAGE = 'https://cdn.example/activities/family/1.jpg';

async function call(sub?: string): Promise<Response> {
  const headers: Record<string, string> = {};
  if (sub) {
    const token = await new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setExpirationTime('1h')
      .sign(new TextEncoder().encode(SECRET));
    headers.authorization = `Bearer ${token}`;
  }
  return GET(new Request('http://localhost/api/v1/account/galleries', { headers }), undefined);
}

const booking = (id: string, user: string, over: Row = {}): Row => ({
  id,
  ref: id.toUpperCase(),
  user_id: user,
  status: 'confirmed',
  balance_due_minor: 0,
  gallery_ready_at: DELIVERED,
  created_at: '2026-10-01T00:00:00Z',
  ...over,
});
const photo = (bookingId: string, n: number, ext = 'jpg'): Row => ({
  booking_id: bookingId,
  url: `https://cdn.example/gallery-${bookingId}/${n}.${ext}`,
  position: n,
});
const item = (
  bookingId: string,
  title: string,
  category = 'Photography',
  extra: Row = {},
): Row => ({
  booking_id: bookingId,
  session_occurrences: { starts_at: '2026-10-10T06:00:00.000Z' },
  activity_options: { activity_id: `act-${title}`, activities: { title, category, extra } },
});

beforeEach(() => {
  reads.length = 0;
  for (const k of Object.keys(tables)) delete tables[k];
  tables.bookings = [
    booking('open1', USER_A),
    booking('lock1', USER_A, { balance_due_minor: 32500 }),
    booking('undel', USER_A, { gallery_ready_at: null }),
    booking('nophoto', USER_A),
    booking('tour1', USER_A),
    booking('cancelled', USER_A, { status: 'cancelled' }),
    booking('other', USER_B),
  ];
  tables.booking_photos = [
    photo('open1', 1),
    photo('open1', 2),
    photo('open1', 3, 'mp4'),
    photo('lock1', 1),
    photo('lock1', 2),
    photo('undel', 1),
    photo('tour1', 1),
    photo('cancelled', 1),
    photo('other', 1),
  ];
  tables.booking_items = [
    item('open1', 'Couples shoot', 'Photography', { [PHOTOGRAPHY_COVER_KEY]: COUPLES_COVER }),
    item('lock1', 'Family shoot'),
    item('undel', 'Couples shoot'),
    item('nophoto', 'Couples shoot'),
    item('tour1', 'North tour', 'Tours'),
    item('cancelled', 'Couples shoot'),
    item('other', 'Couples shoot'),
  ];
  tables.activity_images = [
    { activity_id: 'act-Family shoot', url: FAMILY_CATALOGUE_IMAGE, position: 0 },
  ];
});

describe('GET /api/v1/account/galleries', () => {
  it('requires a signed-in user', async () => {
    expect((await call()).status).toBe(401);
  });

  it('lists only the caller’s delivered photography galleries, in the { ok, data } envelope', async () => {
    const res = await call(USER_A);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; data: { galleries: Row[] } };
    expect(body.ok).toBe(true);
    // Not: the undelivered, photo-less, non-photography, cancelled or the OTHER customer's booking.
    expect(body.data.galleries.map((g) => g.ref).sort()).toEqual(['LOCK1', 'OPEN1']);
  });

  it('only ever reads the caller’s own bookings (the service role bypasses RLS, so the route must)', async () => {
    await call(USER_A);
    const bookingReads = reads.filter((r) => r.table === 'bookings');
    expect(bookingReads).toHaveLength(1);
    expect(bookingReads[0]!.filters).toContainEqual({ op: 'eq', col: 'user_id', val: USER_A });
  });

  it('never leaks another customer’s rows into the response', async () => {
    const asA = JSON.stringify(await (await call(USER_A)).json());
    expect(asA).not.toContain('gallery-other');
    expect(asA).not.toContain('OTHER');
    const asB = (await (await call(USER_B)).json()) as { data: { galleries: Row[] } };
    expect(asB.data.galleries.map((g) => g.ref)).toEqual(['OTHER']);
    expect(JSON.stringify(asB)).not.toContain('gallery-open1');
  });

  it('OPEN: counts photos and videos apart and uses the first photo as the cover', async () => {
    const body = (await (await call(USER_A)).json()) as { data: { galleries: Row[] } };
    const open = body.data.galleries.find((g) => g.ref === 'OPEN1');
    expect(open).toMatchObject({
      access: 'open',
      packageTitle: 'Couples shoot',
      shootDate: '2026-10-10T06:00:00.000Z',
      photoCount: 2,
      videoCount: 1,
      balanceDueMinor: 0,
      coverUrl: 'https://cdn.example/gallery-open1/1.jpg',
    });
  });

  it('LOCKED: shows the public catalogue cover and puts NO gallery file URL on the wire', async () => {
    const res = await call(USER_A);
    const text = await res.text();
    const body = JSON.parse(text) as { data: { galleries: Row[] } };
    const locked = body.data.galleries.find((g) => g.ref === 'LOCK1');
    expect(locked).toMatchObject({
      access: 'locked',
      balanceDueMinor: 32500,
      photoCount: 2,
      coverUrl: FAMILY_CATALOGUE_IMAGE,
    });
    // The locked booking's own files must appear nowhere in the body (only OPEN1's first photo may).
    expect(text).not.toContain('gallery-lock1');
  });

  it('prefers the package’s own cover (extra.photographyCover) over its generic catalogue images', async () => {
    tables.booking_items = [
      item('lock1', 'Family shoot', 'Photography', { [PHOTOGRAPHY_COVER_KEY]: COUPLES_COVER }),
    ];
    const body = (await (await call(USER_A)).json()) as { data: { galleries: Row[] } };
    expect(body.data.galleries.find((g) => g.ref === 'LOCK1')?.coverUrl).toBe(COUPLES_COVER);
  });

  it('returns an empty list — not an error — for a customer with no galleries', async () => {
    const res = await call(USER_NONE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, data: { galleries: [] } });
  });
});
