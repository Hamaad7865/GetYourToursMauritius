import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createTestDb, type TestDb } from '../db/pglite';
import { apiBook } from '../db/book';
import { pgliteRpc } from '../db/rpc';
import { setRouteContext } from '../db/route-context';
import { StubPaymentProvider } from '@/lib/payments/stub';
import { createStubAiProvider } from '@/lib/ai/stub';

vi.mock('@/lib/http/context', async () => {
  const mod = await import('../db/route-context');
  return {
    buildServiceContext: () => mod.requireRouteContext(),
    serviceRoleRpcContext: () => mod.requireRouteContext(),
  };
});

const { GET: hotelsGet } = await import('../../app/api/v1/transfers/hotels/route');
const { GET: areasGet } = await import('../../app/api/v1/transfers/areas/route');
const { GET: quoteGet } = await import('../../app/api/v1/transfers/quote/route');

const CUSTOMER = 'a7a7a7a7-a7a7-a7a7-a7a7-a7a7a7a7a7a7';

async function call<T = unknown>(db: TestDb, fn: string, params: unknown): Promise<T> {
  const { rows } = await db.pg.query<{ data: T }>(`select ${fn}($1::jsonb) as data`, [
    JSON.stringify(params),
  ]);
  return rows[0]!.data;
}

describe('transfers (read endpoints)', () => {
  let db: TestDb;
  let airportOccurrenceId: string;
  let hotelOccurrenceId: string;

  async function seedTransferProduct(
    operatorId: string,
    slug: string,
    flagColumn: 'is_airport_transfer' | 'is_hotel_transfer',
  ): Promise<string> {
    const act = await db.pg.query<{ id: string }>(
      `insert into activities (operator_id, slug, type, title, category, status, pricing_mode, ${flagColumn})
       values ($1, $2, 'transport', $3, 'Airport transfers', 'published', 'vehicle', true) returning id`,
      [operatorId, slug, slug],
    );
    const opt = await db.pg.query<{ id: string }>(
      `insert into activity_options (activity_id, name) values ($1, 'Per transfer') returning id`,
      [act.rows[0]!.id],
    );
    await db.pg.query(
      `insert into activity_option_prices (activity_option_id, label, amount_minor, max_guests)
       values ($1, 'Transfer', 9999, null)`,
      [opt.rows[0]!.id],
    );
    const occ = await db.pg.query<{ id: string }>(
      `insert into session_occurrences (activity_option_id, operator_id, starts_at, ends_at, capacity)
       values ($1, $2, now() + interval '2 days', now() + interval '2 days 1 hour', 80) returning id`,
      [opt.rows[0]!.id, operatorId],
    );
    return occ.rows[0]!.id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    await db.asOwner();
    await db.pg.query(
      `insert into operators (name, slug) values ('Belle Mare Tours', 'belle-mare-tours')`,
    );
    const operatorId = (await db.pg.query<{ id: string }>(`select id from operators limit 1`))
      .rows[0]!.id;
    await db.pg.query(`insert into auth.users (id) values ($1)`, [CUSTOMER]);
    await db.pg.query(`insert into profiles (id, role) values ($1, 'customer')`, [CUSTOMER]);
    airportOccurrenceId = await seedTransferProduct(
      operatorId,
      'airport-transfer',
      'is_airport_transfer',
    );
    hotelOccurrenceId = await seedTransferProduct(
      operatorId,
      'hotel-transfer',
      'is_hotel_transfer',
    );

    setRouteContext({
      db: pgliteRpc(db.pg),
      payments: new StubPaymentProvider(),
      ai: createStubAiProvider(),
      now: () => new Date(),
    });
  });

  afterAll(async () => {
    setRouteContext(null);
    await db.close();
  });

  it('lists curated areas with server-authoritative region + zone', async () => {
    const areas = await call<Array<{ name: string; region: string; zone: string }>>(
      db,
      'api_list_transfer_areas',
      {},
    );
    expect(areas.length).toBe(36);
    const mahebourg = areas.find((a) => a.name === 'Mahébourg');
    expect(mahebourg).toMatchObject({ region: 'South', zone: 'zone2' }); // near-airport south-east
    const grandBaie = areas.find((a) => a.name === 'Grand Baie');
    expect(grandBaie).toMatchObject({ region: 'North', zone: 'zone1' });
  });

  it('route: GET /transfers/areas returns the envelope', async () => {
    const res = await areasGet(new Request('http://localhost/api/v1/transfers/areas'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.data.length).toBe(36);
  });

  it('route: GET /transfers/hotels typeahead returns enriched hotels + meta', async () => {
    const res = await hotelsGet(
      new Request('http://localhost/api/v1/transfers/hotels?q=shandrani&pageSize=5'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    const hotel = body.data[0];
    expect(typeof hotel.slug).toBe('string');
    expect(typeof hotel.region).toBe('string');
    expect(['zone1', 'zone2']).toContain(hotel.zone);
    expect(typeof hotel.fromPriceEur).toBe('number');
    expect(typeof body.meta.total).toBe('number');
  });

  it('route: GET /transfers/quote returns a fare estimate; invalid transferSlug is 400', async () => {
    const ok = await quoteGet(
      new Request(
        'http://localhost/api/v1/transfers/quote?transferSlug=airport-transfer&dropoffSlug=shandrani-beachcomber&pax=2',
      ),
    );
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.data).toMatchObject({ tripType: 'one_way', zoneOrBand: 'zone2', vehicle: 'Sedan' });
    expect(body.data.totalEur).toBe(35);

    const bad = await quoteGet(
      new Request('http://localhost/api/v1/transfers/quote?transferSlug=bus'),
    );
    expect(bad.status).toBe(400);
  });

  it('route: GET /transfers/quote requires a destination per transfer kind (400)', async () => {
    const noDropoff = await quoteGet(
      new Request('http://localhost/api/v1/transfers/quote?transferSlug=airport-transfer&pax=2'),
    );
    expect(noDropoff.status).toBe(400);
    const hotelNoDropoff = await quoteGet(
      new Request(
        'http://localhost/api/v1/transfers/quote?transferSlug=hotel-transfer&pickupSlug=lux-belle-mare&pax=2',
      ),
    );
    expect(hotelNoDropoff.status).toBe(400);
  });

  // The acceptance criterion: a quote must equal the api_book charge for the same inputs, cent-for-cent.
  describe('quote == api_book charge (parity)', () => {
    let bookSeq = 0;
    async function bookCharge(occurrenceId: string, slug: string, extra: Record<string, unknown>) {
      bookSeq += 1;
      await db.as({ sub: CUSTOMER, role: 'authenticated' });
      const b = await apiBook<{ totalEur: number }>(db, {
        occurrenceId,
        expectedSlug: slug,
        party: { Transfer: 2 },
        customerName: 'Parity',
        customerEmail: 'parity@example.com',
        source: 'web',
        idempotencyKey: `parity-${slug}-${bookSeq}-00000`,
        ...extra,
      });
      await db.asOwner();
      return b.totalEur;
    }
    // Drive the quote through the PRODUCTION path: the /transfers/quote route sends scalar `pax`
    // (never a party object), so parity must hold for scalar pax vs api_book's party of the same count.
    const quote = (params: Record<string, unknown>) =>
      call<{ totalEur: number }>(db, 'api_transfer_quote', { pax: 2, ...params });

    it('airport one-way Zone 2 (slug)', async () => {
      const charged = await bookCharge(airportOccurrenceId, 'airport-transfer', {
        dropoffSlug: 'shandrani-beachcomber',
        tripDirection: 'arrival',
      });
      const q = await quote({
        transferSlug: 'airport-transfer',
        dropoffSlug: 'shandrani-beachcomber',
      });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(35);
    });

    it('airport return Zone 2', async () => {
      const charged = await bookCharge(airportOccurrenceId, 'airport-transfer', {
        dropoffSlug: 'shandrani-beachcomber',
        tripDirection: 'return',
      });
      const q = await quote({
        transferSlug: 'airport-transfer',
        dropoffSlug: 'shandrani-beachcomber',
        tripType: 'return',
      });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(63);
    });

    it('airport one-way Zone 1 (free-text area)', async () => {
      const charged = await bookCharge(airportOccurrenceId, 'airport-transfer', {
        dropoffArea: 'Grand Baie',
        tripDirection: 'arrival',
      });
      const q = await quote({ transferSlug: 'airport-transfer', dropoffArea: 'Grand Baie' });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(55);
    });

    it('hotel-to-hotel FAR one-way', async () => {
      const charged = await bookCharge(hotelOccurrenceId, 'hotel-transfer', {
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'paradis-beachcomber',
        tripType: 'one_way',
      });
      const q = await quote({
        transferSlug: 'hotel-transfer',
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'paradis-beachcomber',
      });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(60);
    });

    it('hotel-to-hotel SAME band', async () => {
      const charged = await bookCharge(hotelOccurrenceId, 'hotel-transfer', {
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'ambre-mauritius',
        tripType: 'one_way',
      });
      const q = await quote({
        transferSlug: 'hotel-transfer',
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'ambre-mauritius',
      });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(25);
    });

    it('hotel-to-hotel NEAR return', async () => {
      const charged = await bookCharge(hotelOccurrenceId, 'hotel-transfer', {
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'trou-aux-biches-beachcomber',
        tripType: 'return',
      });
      const q = await quote({
        transferSlug: 'hotel-transfer',
        pickupSlug: 'lux-belle-mare',
        dropoffSlug: 'trou-aux-biches-beachcomber',
        tripType: 'return',
      });
      expect(q.totalEur).toBe(charged);
      expect(charged).toBe(72);
    });

    it('quote is symmetric: scalar pax == party object of the same count', async () => {
      const viaPax = await call<{ totalEur: number }>(db, 'api_transfer_quote', {
        transferSlug: 'airport-transfer',
        dropoffSlug: 'shandrani-beachcomber',
        pax: 3,
      });
      const viaParty = await call<{ totalEur: number }>(db, 'api_transfer_quote', {
        transferSlug: 'airport-transfer',
        dropoffSlug: 'shandrani-beachcomber',
        party: { Adult: 2, Child: 1 },
      });
      expect(viaParty.totalEur).toBe(viaPax.totalEur);
    });
  });
});
