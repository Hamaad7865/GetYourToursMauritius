import {
  bookingLineDays,
  paymentView,
  type BookingDetail,
  type BookingStatus,
} from '@/lib/admin/bookings';
import { eur, fmtDateShort, serviceWhen, type ServiceWhen } from '@/lib/admin/format';
import { nextInstallment } from '@/lib/admin/installments';
import { resolvePickup } from '@/components/admin/BookingFacts';

/**
 * THE BOOKING PANEL'S RULES (Bookings screen, the panel a booking opens in), with none of its markup:
 * its tabs, the "needs attention" tiles at the top, the money band on the Payment tab, the footer's
 * main action and the colour of each payment event. Pure, so every rule is pinned by a unit test.
 *
 * Nothing here decides money. The figures are the ones the panel always printed (`netPaidEur`,
 * `grossPaidEur`, `refundedEur`, `balanceDueEur`), and "still to collect" goes through
 * {@link paymentView}, the one reading of "Part paid": `balance_due` alone is not a debt (it is also set
 * on a never-paid quote and after a declined payment).
 */

export type DrawerTab = 'overview' | 'payment' | 'notes';

export const DRAWER_TABS: ReadonlyArray<{ id: DrawerTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'payment', label: 'Payment' },
  { id: 'notes', label: 'Notes' },
];

export function parseDrawerTab(raw: string | null | undefined): DrawerTab {
  return DRAWER_TABS.some((t) => t.id === raw) ? (raw as DrawerTab) : 'overview';
}

/** The fields these rules read; a full {@link BookingDetail} satisfies it. */
export type DrawerBooking = Pick<
  BookingDetail,
  | 'status'
  | 'paymentState'
  | 'totalEur'
  | 'depositEur'
  | 'balanceDueEur'
  | 'netPaidEur'
  | 'grossPaidEur'
  | 'refundedEur'
  | 'installments'
  | 'pickupLocation'
  | 'dropoffLocation'
  | 'pickupPending'
  | 'transportPickup'
  | 'transportDropoff'
  | 'transfer'
  | 'pickupTime'
  | 'items'
> &
  // Optional so a fixture without quote lines still type-checks; a real BookingDetail always has it.
  Partial<Pick<BookingDetail, 'customItems'>>;

/** When each line of the booking happens, in line order (null for a line with no date). */
export function itemWhens(b: Pick<DrawerBooking, 'items' | 'transfer' | 'pickupTime'>) {
  return b.items.map((it) =>
    serviceWhen({
      startsAt: it.startsAt,
      transfer: b.transfer,
      pickupTime: b.pickupTime,
      departureTime: it.departureTime,
    }),
  );
}

/** The booking's first and last service day, from its lines: tour lines first (they carry a pickup
 *  or departure time), then a quote booking's own dated lines (custom, rental), which may be all it
 *  has. Without those, a quote booking had no trip date: no "Mark as completed", no date on the
 *  "Pickup to be arranged" tile. */
function serviceSpan(b: DrawerBooking): { first: ServiceWhen | null; lastDay: string | null } {
  const whens = itemWhens(b).filter((w): w is ServiceWhen => w !== null);
  const days = bookingLineDays(b);
  if (whens.length === 0 && days.length === 0) return { first: null, lastDay: null };
  const sorted = [...whens].sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
  const tourFirst = sorted[0] ?? null;
  const firstDay = days[0] ?? null;
  // A quote line earlier than every tour line is the trip's start (day only: it has no pickup time).
  const first =
    tourFirst && (!firstDay || tourFirst.day <= firstDay)
      ? tourFirst
      : { at: `${firstDay}T12:00:00+04:00`, day: firstDay!, time: null };
  const lastTour = sorted[sorted.length - 1]?.day ?? null;
  const lastLine = days[days.length - 1] ?? null;
  const lastDay =
    [lastTour, lastLine]
      .filter((d): d is string => d !== null)
      .sort()
      .pop() ?? null;
  return { first, lastDay };
}

/** One of the tiles at the top of the Overview: something on this booking that needs doing. */
export interface AttentionItem {
  id: 'refund' | 'balance' | 'pickup';
  title: string;
  detail: string;
  /** Where choosing the tile takes you: a tab, or the pickup card on the Overview. */
  target: 'payment' | 'pickup';
}

/**
 * What on this booking needs doing, most urgent first. Only things someone can act on:
 *  - a refund waiting to be recorded (worded for whoever can record it, or not);
 *  - a balance still to collect on a live booking (Part paid), with the next installment if any;
 *  - a confirmed trip, today or later, whose pickup the guest left "to be arranged".
 */
export function drawerAttention(
  b: DrawerBooking,
  opts: { canRefund: boolean; today: string },
): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (b.status === 'refund_pending') {
    out.push(
      opts.canRefund
        ? {
            id: 'refund',
            title: 'Refund to record',
            detail: `${eur(b.netPaidEur)} to send back in Peach`,
            target: 'payment',
          }
        : {
            id: 'refund',
            title: 'Refund waiting',
            detail: 'The owner records it once it’s sent in Peach',
            target: 'payment',
          },
    );
  }
  if (paymentView(b) === 'part_paid') {
    const next = nextInstallment(b.installments);
    out.push({
      id: 'balance',
      title: `${eur(b.balanceDueEur)} still to collect`,
      detail: next
        ? `Next: ${eur(next.amountEur - next.coveredEur)} due ${fmtDateShort(next.dueOn)}`
        : `Of ${eur(b.totalEur)} in total`,
      target: 'payment',
    });
  }
  if (b.status === 'confirmed') {
    const { pickup } = resolvePickup({
      pickupLocation: b.pickupLocation,
      dropoffLocation: b.dropoffLocation,
      pickupPending: b.pickupPending,
      transportPickup: b.transportPickup,
      transportDropoff: b.transportDropoff,
      transferDirection: b.transfer?.direction ?? null,
    });
    const { first, lastDay } = serviceSpan(b);
    if (pickup.kind === 'pending' && (lastDay === null || lastDay >= opts.today)) {
      out.push({
        id: 'pickup',
        title: 'Pickup to be arranged',
        detail: first
          ? `Trip ${fmtDateShort(first.at)}${first.time ? `, ${first.time}` : ''}`
          : 'The guest hasn’t said where yet',
        target: 'pickup',
      });
    }
  }
  return out;
}

/** One figure in the Payment tab's money band. */
export interface MoneyFigure {
  label: string;
  amountEur: number;
  /** warn = money still to move (to collect, to refund); info = money that went back. */
  tone: 'plain' | 'warn' | 'info';
}

const IN_CHECKOUT: readonly BookingStatus[] = ['draft', 'held', 'payment_pending'];

/**
 * The money band: the total, what was paid, and the one figure that says where the money stands.
 * "Paid" is the money taken before any refund, so it sits beside "Refunded" without double counting.
 */
export function drawerMoney(b: DrawerBooking): MoneyFigure[] {
  const figures: MoneyFigure[] = [
    { label: 'Total', amountEur: b.totalEur, tone: 'plain' },
    { label: 'Paid', amountEur: b.grossPaidEur, tone: 'plain' },
  ];
  if (b.status === 'refund_pending') {
    figures.push({ label: 'To refund', amountEur: b.netPaidEur, tone: 'warn' });
  } else if (b.refundedEur > 0.005) {
    figures.push({ label: 'Refunded', amountEur: b.refundedEur, tone: 'info' });
  } else if (paymentView(b) === 'part_paid') {
    figures.push({ label: 'Still to collect', amountEur: b.balanceDueEur, tone: 'warn' });
  } else if (IN_CHECKOUT.includes(b.status)) {
    figures.push({
      label: 'Not paid yet',
      amountEur: Math.max(0, b.totalEur - b.netPaidEur),
      tone: 'plain',
    });
  } else if (b.status === 'confirmed' || b.status === 'completed') {
    figures.push({ label: 'Balance', amountEur: 0, tone: 'plain' });
  }
  return figures;
}

/** The footer's main button: the one thing this booking most likely needs next, or none. */
export type DrawerPrimary =
  | { kind: 'review-refund'; label: 'Review refund' }
  | { kind: 'complete'; label: 'Mark as completed' }
  | null;

/**
 * - A refund to record → "Review refund", which opens the Payment tab where it is recorded (none
 *   while that tab is already showing; its own button is right there).
 * - A confirmed booking whose last day has passed → "Mark as completed".
 * Anything else has no main action; the rest live under "More".
 */
export function drawerPrimary(
  b: DrawerBooking,
  opts: { canRefund: boolean; today: string; tab: DrawerTab },
): DrawerPrimary {
  if (b.status === 'refund_pending' && opts.canRefund) {
    return opts.tab === 'payment' ? null : { kind: 'review-refund', label: 'Review refund' };
  }
  if (b.status === 'confirmed') {
    const { lastDay } = serviceSpan(b);
    if (lastDay !== null && lastDay < opts.today) {
      return { kind: 'complete', label: 'Mark as completed' };
    }
  }
  return null;
}

/** A payment event's colour on the timeline: the provider's words are free text, so by keyword. */
export function paymentEventTone(type: string): 'ok' | 'bad' | 'info' | 'neutral' {
  const t = type.toLowerCase();
  if (/fail|declin|cancel|expir|reject|chargeback|error/.test(t)) return 'bad';
  if (/refund|revers/.test(t)) return 'info';
  if (/paid|captur|settl|success|complete/.test(t)) return 'ok';
  return 'neutral';
}

/**
 * How many OTHER bookings in the list share the open booking's email, for the panel's "Other bookings"
 * link. An erased guest's bookings all carry the same placeholder address (`deleted@privacy.invalid`),
 * which is nobody's: it never groups.
 */
export function otherBookingCount(
  rows: ReadonlyArray<{ id: string; customerEmail: string }>,
  openId: string | null,
): number {
  const open = openId === null ? undefined : rows.find((r) => r.id === openId);
  const email = open?.customerEmail.trim().toLowerCase() ?? '';
  if (!email || email.endsWith('.invalid')) return 0;
  return rows.filter((r) => r.id !== openId && r.customerEmail.trim().toLowerCase() === email)
    .length;
}

/** The neighbours of the open booking in the list as it is filtered and sorted, for Previous / Next. */
export function listNeighbours(
  ids: readonly string[],
  openId: string | null,
): { prev: string | null; next: string | null; index: number } {
  const index = openId === null ? -1 : ids.indexOf(openId);
  if (index === -1) return { prev: null, next: null, index };
  return { prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null, index };
}
