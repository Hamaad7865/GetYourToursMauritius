import { paymentView, type BookingRow, type BookingStatus, type PaymentState } from './bookings';
import { mauDay, serviceWhen } from './format';

/**
 * THE BOOKINGS SCREEN'S SAVED VIEWS (back-office redesign, phase 2): the tabs above the list, their
 * counts, and the order each one sorts in. Pure, so every rule is pinned by a unit test and the
 * screen only draws them.
 *
 * ── COUNTS COME FROM THE FULL LIST ────────────────────────────────────────────────────────────
 * A tab's count is over every booking `loadBookings` read (all of them, paged past PostgREST's row
 * cap by `readAll`), never over the current search or filters — so "Awaiting payment 3" here is the
 * same 3 as Today's "Awaiting payment" card, which runs {@link isAwaitingPayment} over that same list.
 * The tab then COMBINES with the search and filters to choose the rows shown.
 *
 * ── DAYS ARE MAURITIUS DAYS, AND A TRIP'S DAY IS WHEN THE GUEST IS COLLECTED ──────────────────
 * "Today" and "Next 7 days" read the trip date through `serviceWhen` (a transfer's own pickup, never
 * the day-slot's placeholder clock) in Mauritius time, exactly like the date filter beside them, and
 * like that filter they keep every status: a cancelled trip today still shows, its chip says so.
 */

export type BookingView =
  | 'all'
  | 'awaiting'
  | 'today'
  | 'next7'
  | 'part_paid'
  | 'completed'
  | 'cancelled';

export const BOOKING_VIEWS: ReadonlyArray<{ id: BookingView; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'awaiting', label: 'Awaiting payment' },
  { id: 'today', label: 'Today' },
  { id: 'next7', label: 'Next 7 days' },
  { id: 'part_paid', label: 'Part paid' },
  { id: 'completed', label: 'Completed' },
  { id: 'cancelled', label: 'Cancelled' },
];

/** A `?view=` value, or "all" for anything else. */
export function parseBookingView(raw: string | null | undefined): BookingView {
  return BOOKING_VIEWS.some((v) => v.id === raw) ? (raw as BookingView) : 'all';
}

/** A booking that is over: nothing more will be paid on it. */
const NOT_ACTIVE: ReadonlySet<BookingStatus> = new Set([
  'cancelled',
  'expired',
  'failed',
  'refunded',
  'refund_pending',
]);

/**
 * Money still expected on a live booking: the ledger says pending and the booking is not over. The
 * ONE rule behind Today's "Awaiting payment" card, its "Needs you" rows and this screen's tab.
 * (A raw `payment_state = 'pending'` filter would also catch expired and cancelled bookings, which
 * read "Not paid" — never paid, and never going to be.)
 */
export function isAwaitingPayment(b: {
  paymentState: PaymentState;
  status: BookingStatus;
}): boolean {
  return b.paymentState === 'pending' && !NOT_ACTIVE.has(b.status);
}

/** "Cancelled" covers every way a booking ends without the trip: a paid cancel is `refund_pending`,
 *  then `refunded` — never `cancelled`. Expired checkouts and failed ones stay under All only. */
const CANCELLED_VIEW: ReadonlySet<BookingStatus> = new Set([
  'cancelled',
  'refund_pending',
  'refunded',
]);

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The booking fields the views read. */
export type ViewRow = Pick<
  BookingRow,
  | 'status'
  | 'paymentState'
  | 'depositEur'
  | 'balanceDueEur'
  | 'totalEur'
  | 'startsAt'
  | 'transfer'
  | 'pickupTime'
  | 'departureTime'
>;

/** Whether a booking belongs in a view, as of the Mauritius day `today` ('yyyy-mm-dd'). */
export function inBookingView(b: ViewRow, view: BookingView, today: string): boolean {
  switch (view) {
    case 'all':
      return true;
    case 'awaiting':
      return isAwaitingPayment(b);
    case 'today':
    case 'next7': {
      const d = serviceWhen(b)?.day ?? null;
      if (!d) return false;
      return view === 'today' ? d === today : d >= today && d <= addDays(today, 6);
    }
    case 'part_paid':
      return paymentView(b) === 'part_paid';
    case 'completed':
      return b.status === 'completed';
    case 'cancelled':
      return CANCELLED_VIEW.has(b.status);
    default:
      return false;
  }
}

/** Every view's count over the full list. */
export function bookingViewCounts(
  rows: readonly ViewRow[],
  today: string = mauDay(new Date()),
): Record<BookingView, number> {
  const counts = {
    all: 0,
    awaiting: 0,
    today: 0,
    next7: 0,
    part_paid: 0,
    completed: 0,
    cancelled: 0,
  } satisfies Record<BookingView, number>;
  for (const b of rows) {
    for (const v of BOOKING_VIEWS) if (inBookingView(b, v.id, today)) counts[v.id] += 1;
  }
  return counts;
}

export type BookingSortKey = 'ref' | 'customer' | 'date' | 'booked' | 'total';
export type SortDir = 'asc' | 'desc';

/**
 * The order a view opens in. All (and the status views) lead with the newest booking — what just
 * came in; the date views and Part paid lead with the soonest trip — what has to happen first (a
 * balance whose trip has already run is the most overdue, as on Today).
 */
export function viewSort(view: BookingView): { key: BookingSortKey; dir: SortDir } {
  switch (view) {
    case 'today':
    case 'next7':
    case 'part_paid':
      return { key: 'date', dir: 'asc' };
    default:
      return { key: 'booked', dir: 'desc' };
  }
}

/** The order, said on screen in words ("Sorted by trip date, soonest first"). */
export function sortSentence(key: BookingSortKey, dir: SortDir): string {
  switch (key) {
    case 'date':
      return dir === 'asc'
        ? 'Sorted by trip date, soonest first'
        : 'Sorted by trip date, latest first';
    case 'booked':
      return dir === 'desc' ? 'Newest booking first' : 'Oldest booking first';
    case 'total':
      return dir === 'desc' ? 'Highest total first' : 'Lowest total first';
    case 'customer':
      return dir === 'asc' ? 'Sorted by guest name, A to Z' : 'Sorted by guest name, Z to A';
    default:
      return dir === 'asc' ? 'Sorted by reference, A to Z' : 'Sorted by reference, Z to A';
  }
}
