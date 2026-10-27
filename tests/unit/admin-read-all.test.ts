import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The staff list loaders read EVERY row. They used to `.limit(300)`, so the Bookings screen read
 * "300 of 300 bookings" while prod held 466 — every filter, the search box and the CSV export ran
 * over the newest 300 only, and the dashboard's "Departures today" missed anyone who had booked more
 * than ~6 weeks ahead. Leads (410 in prod) were cut the same way.
 *
 * PGlite cannot show this: the cap that matters is PostgREST's own (1,000 rows on Supabase), which
 * truncates a response silently. So the client here is a fake PostgREST that does exactly that.
 */

type Raw = Record<string, unknown>;
interface Request {
  table: string;
  order: string[];
  range: [number, number] | null;
  limit: number | null;
}

const fake = vi.hoisted(() => {
  /** Supabase's default API "Max rows": anything past it is dropped with no error. */
  const SERVER_CAP = 1000;
  const state = {
    tables: {} as Record<string, Raw[]>,
    requests: [] as Request[],
    /** Runs after each response is cut — lets a test write a row between two pages. */
    afterRequest: null as ((n: number) => void) | null,
  };

  function sortRows(rows: Raw[], order: string[]): Raw[] {
    return [...rows].sort((a, b) => {
      for (const key of order) {
        const [col, dir] = key.split('.') as [string, string];
        const av = String(a[col]);
        const bv = String(b[col]);
        if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  }

  function from(table: string) {
    const req: Request = { table, order: [], range: null, limit: null };
    const q = {
      select: () => q,
      gte: () => q,
      lt: () => q,
      order: (col: string, opts?: { ascending?: boolean }) => {
        req.order.push(`${col}.${opts?.ascending === false ? 'desc' : 'asc'}`);
        return q;
      },
      range: (lo: number, hi: number) => {
        req.range = [lo, hi];
        return q;
      },
      limit: (n: number) => {
        req.limit = n;
        return q;
      },
      returns: () => q,
      then<T>(resolve: (v: { data: Raw[]; error: null }) => T, reject?: (e: unknown) => T) {
        state.requests.push(req);
        const rows = sortRows(state.tables[table] ?? [], req.order);
        const lo = req.range?.[0] ?? 0;
        const hi = req.range ? req.range[1] + 1 : rows.length;
        const data = rows
          .slice(lo, Math.min(hi, lo + (req.limit ?? Infinity)))
          .slice(0, SERVER_CAP);
        state.afterRequest?.(state.requests.length);
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      },
    };
    return q;
  }

  return { state, client: { from } };
});

vi.mock('@/lib/supabase/browser', () => ({ getBrowserSupabase: () => fake.client }));

const { readAll, uniqueById, PAGE } = await import('@/lib/admin/read-all');
const { loadBookings } = await import('@/lib/admin/bookings');
const { loadLeads } = await import('@/lib/admin/leads');
const { loadDashboard } = await import('@/lib/admin/dashboard');

const BASE = Date.UTC(2026, 6, 28);
const minute = (i: number) => new Date(BASE + i * 60_000).toISOString();

/** Booking i, created i minutes after the first. Pairs share a created_at, so the id tiebreak is real. */
function rawBooking(i: number, extra: Raw = {}): Raw {
  return {
    id: `b-${String(i).padStart(5, '0')}`,
    ref: `BMT${String(i).padStart(13, '0')}`,
    status: 'confirmed',
    payment_state: 'paid',
    customer_name: `Guest ${i}`,
    customer_email: `guest${i}@example.com`,
    customer_phone: null,
    source: 'web',
    currency: 'EUR',
    total_minor: 10_000,
    created_at: minute(Math.floor(i / 2)),
    booking_items: [],
    payments: [],
    ...extra,
  };
}

function rawLead(i: number): Raw {
  return {
    id: `l-${String(i).padStart(5, '0')}`,
    name: `Lead ${i}`,
    contact: `lead${i}@example.com`,
    status: 'new',
    source: 'contact',
    message: null,
    page_url: null,
    preferred_date: null,
    party_size: null,
    created_at: minute(i),
    activities: null,
  };
}

beforeEach(() => {
  fake.state.tables = {};
  fake.state.requests = [];
  fake.state.afterRequest = null;
});

describe('readAll', () => {
  const pages = (total: number) => {
    const calls: Array<[number, number]> = [];
    const page = async (lo: number, hi: number) => {
      calls.push([lo, hi]);
      const len = Math.max(0, Math.min(hi, total - 1) - lo + 1);
      return { data: Array.from({ length: len }, (_, k) => lo + k), error: null };
    };
    return { calls, page };
  };

  it('stops on the first short page', async () => {
    const { calls, page } = pages(PAGE - 1);
    expect(await readAll(page)).toHaveLength(PAGE - 1);
    expect(calls).toEqual([[0, PAGE - 1]]);
  });

  it('walks consecutive inclusive ranges and keeps every row', async () => {
    const { calls, page } = pages(PAGE * 2 + 7);
    const rows = await readAll(page);
    expect(rows).toEqual(Array.from({ length: PAGE * 2 + 7 }, (_, k) => k));
    expect(calls).toEqual([
      [0, PAGE - 1],
      [PAGE, PAGE * 2 - 1],
      [PAGE * 2, PAGE * 3 - 1],
    ]);
  });

  it('asks once more when the total is an exact multiple of a page', async () => {
    const { calls, page } = pages(PAGE * 2);
    expect(await readAll(page)).toHaveLength(PAGE * 2);
    expect(calls).toHaveLength(3);
  });

  it('throws the failed page’s error instead of returning a partial list', async () => {
    const boom = { message: 'statement timeout' };
    let n = 0;
    const page = async () =>
      n++ === 0
        ? { data: Array.from({ length: PAGE }, () => 1), error: null }
        : { data: null, error: boom };
    await expect(readAll(page)).rejects.toBe(boom);
  });

  it('uniqueById keeps the first sighting and the order', () => {
    expect(uniqueById([{ id: 'a' }, { id: 'b' }, { id: 'a' }, { id: 'c' }])).toEqual([
      { id: 'a' },
      { id: 'b' },
      { id: 'c' },
    ]);
  });
});

describe('loadBookings', () => {
  it('returns every booking, past both the old 300 cap and the server’s 1,000-row cap', async () => {
    fake.state.tables.bookings = Array.from({ length: 1234 }, (_, i) => rawBooking(i));

    const rows = await loadBookings();

    expect(rows).toHaveLength(1234);
    expect(new Set(rows.map((r) => r.id)).size).toBe(1234);
    // Newest first — the dashboard takes the head of this list for "recent" and "pending".
    const created = rows.map((r) => r.createdAt);
    expect(created).toEqual([...created].sort().reverse());
    // Every page asks for a TOTAL order (created_at alone ties) and none of them is a bare limit.
    expect(fake.state.requests).toHaveLength(3);
    for (const req of fake.state.requests) {
      expect(req.order).toEqual(['created_at.desc', 'id.asc']);
      expect(req.limit).toBeNull();
      expect(req.range![1] - req.range![0] + 1).toBe(PAGE);
    }
  });

  it('does not list a booking twice when one is created between two pages', async () => {
    fake.state.tables.bookings = Array.from({ length: 700 }, (_, i) => rawBooking(i));
    // A guest books while the screen is loading: the new row lands on top, everything shifts down
    // one, and page 2 starts with the row page 1 ended on.
    fake.state.afterRequest = (n) => {
      if (n === 1) fake.state.tables.bookings!.push(rawBooking(5000));
    };

    const rows = await loadBookings();

    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
    expect(rows).toHaveLength(700);
  });

  it('feeds the dashboard every booking, so a guest who booked months ahead still departs today', async () => {
    const now = new Date('2026-10-27T08:00:00Z'); // 12:00 in Mauritius
    const departingToday = rawBooking(0, {
      booking_items: [
        {
          price_label: 'Adult',
          quantity: 2,
          pax: null,
          unit_amount_minor: 5000,
          subtotal_minor: 10_000,
          transport_fare_minor: null,
          transport_pickup_label: null,
          transport_dropoff_label: null,
          session_occurrences: { starts_at: '2026-10-27T05:00:00Z', departure_time: null },
          activity_options: {
            name: 'Shared',
            start_window: null,
            activities: { title: 'Catamaran', startWindow: null },
          },
        },
      ],
    });
    // The OLDEST of 400 — exactly the row the old newest-300 read never fetched.
    fake.state.tables.bookings = [
      departingToday,
      ...Array.from({ length: 399 }, (_, i) => rawBooking(i + 1)),
    ];

    const dash = await loadDashboard(now);

    expect(dash.departuresToday).toBe(1);
    expect(dash.departures[0]?.ref).toBe(departingToday.ref);
  });
});

describe('loadLeads', () => {
  it('returns every lead — prod held 410 when the list stopped at 300', async () => {
    fake.state.tables.leads = Array.from({ length: 410 }, (_, i) => rawLead(i));

    const rows = await loadLeads();

    expect(rows).toHaveLength(410);
    expect(rows[0]?.id).toBe('l-00409');
    expect(fake.state.requests.every((r) => r.limit === null)).toBe(true);
  });
});
