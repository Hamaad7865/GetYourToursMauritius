import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createBooking } from '@/lib/services/bookings';
import { ValidationError } from '@/lib/services/errors';
import type { ServiceContext } from '@/lib/services/context';
import type { CreateBookingInput } from '@/lib/validation/booking';

/**
 * WHICH ROUTE ENDS UP ON THE BOOKING, AND WHEN A BOOKING IS REFUSED OUTRIGHT.
 *
 * A Custom Road Trip's route used to reach the server only at pay, carried across the
 * planner→checkout gap by one sessionStorage key. When that key vanished the booking completed
 * anyway: BMTFF77DC5CDD471 was confirmed and PAID for a full day of private driving with
 * `custom_itinerary` NULL, unrecoverable because nothing server-side had ever held a copy.
 *
 * The route is now also stored on the hold, so this layer has two possible sources and has to pick
 * correctly — and, if neither has one, refuse rather than sell a trip nobody can drive.
 */
const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/services/rpc', () => ({ callRpc: rpc }));

const CLIENT_ROUTE = [{ title: 'Le Morne', area: 'South' }];
const HOLD_ROUTE = [{ title: 'Bois Cheri', area: 'South', lat: -20.4, lng: 57.5 }];
const ctx = {} as ServiceContext;

/** A booking payload with the fields api_book needs; the rest default inside createBooking. */
const input = (over: Partial<CreateBookingInput> = {}): CreateBookingInput =>
  ({
    occurrenceId: '11111111-1111-1111-1111-111111111111',
    holdId: '22222222-2222-2222-2222-222222222222',
    party: { Adult: 2 },
    customer: { name: 'Martin', email: 'm@example.com' },
    ...over,
  }) as CreateBookingInput;

/** api_book's reply only has to satisfy bookingSchema — these tests are about what it was CALLED with. */
const BOOKING = {
  id: '33333333-3333-3333-3333-333333333333',
  ref: 'BMTTEST',
  status: 'payment_pending',
  paymentState: 'pending',
  customerName: 'Martin',
  customerEmail: 'm@example.com',
  totalEur: 100,
  currency: 'EUR',
  source: 'web',
  createdAt: '2026-08-09T11:00:00.000Z',
  items: [],
};

/** Route each RPC by name so a test only states the reply it cares about. Anything else answers with
 *  an empty object rather than throwing: every assertion below selects its call BY NAME, so being
 *  permissive here cannot weaken one, while throwing would make this file fail for reasons that have
 *  nothing to do with what it is pinning. */
function stub(holdRoute: { pricingMode: string | null; itinerary: unknown }): void {
  rpc.mockImplementation(async (_ctx: unknown, fn: string) => {
    if (fn === 'api_hold_route') return holdRoute;
    if (fn === 'api_book') return BOOKING;
    return {};
  });
}

const itinerarySentToApiBook = (): unknown =>
  (rpc.mock.calls.find((c) => c[1] === 'api_book')?.[2] as { itinerary: unknown }).itinerary;

beforeEach(() => rpc.mockReset());

describe('resolving a custom trip’s route', () => {
  it('prefers the browser’s route — the customer may have edited the day after holding', async () => {
    stub({ pricingMode: 'vehicle_custom', itinerary: HOLD_ROUTE });
    await createBooking(ctx, input({ itinerary: CLIENT_ROUTE }));
    expect(itinerarySentToApiBook()).toEqual(CLIENT_ROUTE);
  });

  it('does not even ask the hold when the browser has a route', async () => {
    // The hold lookup is a round trip on the money path; it earns its place only as a fallback.
    stub({ pricingMode: 'vehicle_custom', itinerary: HOLD_ROUTE });
    await createBooking(ctx, input({ itinerary: CLIENT_ROUTE }));
    expect(rpc.mock.calls.some((c) => c[1] === 'api_hold_route')).toBe(false);
  });

  it('falls back to the hold’s copy when the browser lost its own — the whole point', async () => {
    stub({ pricingMode: 'vehicle_custom', itinerary: HOLD_ROUTE });
    await createBooking(ctx, input({ itinerary: null }));
    expect(itinerarySentToApiBook()).toEqual(HOLD_ROUTE);
  });

  it('treats an empty client array as no route, not as a route', async () => {
    // `[]` is a day with every stop removed. Passing it through would put an empty itinerary on the
    // booking and skip the fallback — undeliverable, exactly as before, one layer along.
    stub({ pricingMode: 'vehicle_custom', itinerary: HOLD_ROUTE });
    await createBooking(ctx, input({ itinerary: [] }));
    expect(itinerarySentToApiBook()).toEqual(HOLD_ROUTE);
  });

  it('REFUSES a custom trip when neither side has a route', async () => {
    // The booking that started all this. An error the customer can retry is recoverable; a paid
    // full-day vehicle with nowhere to go is not.
    stub({ pricingMode: 'vehicle_custom', itinerary: null });
    await expect(createBooking(ctx, input({ itinerary: null }))).rejects.toThrow(ValidationError);
    expect(rpc.mock.calls.some((c) => c[1] === 'api_book')).toBe(false);
  });

  it('says something the customer can act on', async () => {
    stub({ pricingMode: 'vehicle_custom', itinerary: null });
    await expect(createBooking(ctx, input({ itinerary: null }))).rejects.toThrow(/planner/i);
  });
});

describe('every other activity is untouched', () => {
  it('books a per-person tour with no route at all', async () => {
    // The refusal is scoped to vehicle_custom. A catamaran cruise has no itinerary and never will;
    // widening the check would refuse most of the catalogue.
    stub({ pricingMode: 'per_person', itinerary: null });
    await createBooking(ctx, input({ itinerary: null }));
    expect(itinerarySentToApiBook()).toBeNull();
  });

  it('books a fixed-route sightseeing vehicle tour with no route', async () => {
    stub({ pricingMode: 'vehicle', itinerary: null });
    await createBooking(ctx, input({ itinerary: null }));
    expect(itinerarySentToApiBook()).toBeNull();
  });

  it('still books when the lookup answers with nothing it can read', async () => {
    // A malformed/absent reply must not become a 500 on the money path for an ordinary booking —
    // only a CONFIRMED vehicle_custom mode is allowed to refuse.
    stub({ pricingMode: null, itinerary: 'not-an-array' });
    await createBooking(ctx, input({ itinerary: null }));
    expect(itinerarySentToApiBook()).toBeNull();
  });
});
