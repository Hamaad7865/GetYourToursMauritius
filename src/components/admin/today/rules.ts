import { partyChip, type ChipSpec } from '@/components/admin/BookingFacts';
import {
  quoteStage,
  worklistTotals,
  type WorklistTotals,
} from '@/components/admin/quotes/worklist';
import { isAwaitingPayment } from '@/lib/admin/booking-views';
import { paymentView, type BookingRow, type PaymentView } from '@/lib/admin/bookings';
import {
  ALL_TYPES_ON,
  PEOPLE_TYPES,
  addDays,
  capacityUse,
  shortDay,
  summarize,
  type CalLine,
  type CapacityUse,
} from '@/lib/admin/calendar-view';
import type { DayEntry } from '@/lib/admin/calendar';
import { euro, type DashStatView, type DashViewer } from '@/lib/admin/dashboard';
import { fmtDateShort, serviceWhen } from '@/lib/admin/format';
import { nextInstallment } from '@/lib/admin/installments';
import type { LeadRow } from '@/lib/admin/leads';
import type { QuoteRow } from '@/lib/admin/quotes';

/**
 * TODAY'S RULES (the back office's home, phase 2 of the redesign), with none of its markup: the
 * figures across the top, the run sheet and tomorrow's preview, and the "Needs you" list. Pure, like
 * the quotes worklist's rules, so every permission combination is pinned by a unit test.
 *
 * ── THE RUN SHEET IS THE CALENDAR'S DAY SHEET ──────────────────────────────────────────────────
 * Today's departures are read with the Calendar's own loader and counted with its own rule
 * (`summarize`): one card per departure, guests on PAID parties only, unpaid parties as "+N unpaid".
 * The old dashboard counted one row per BOOKING, unpaid included, so the two screens could disagree;
 * this is the Calendar's rule on both.
 *
 * ── EVERY EXTRA READ FAILS ON ITS OWN ─────────────────────────────────────────────────────────
 * The bookings list, the day sheets, quotes and enquiries load separately. A failed one is passed in
 * as 'error' and only ITS figures say "Could not load"; nothing here ever falls back to another
 * rule's number.
 */

/** A read that may still be loading (null), have failed ('error'), or be ready. */
export type Loaded<T> = T | null | 'error';

export function isReady<T>(v: Loaded<T>): v is T {
  return v !== null && v !== 'error';
}

/** What the signed-in person may see on Today — {@link DashViewer} plus the sections Today links to. */
export interface TodayViewer extends DashViewer {
  /** section.calendar — the day-sheet links and the print button's source. */
  showCalendar: boolean;
  /** section.quotes — the "Quotes waiting" card and quote rows in Needs you. */
  showQuotes: boolean;
  /** section.leads — new enquiries in Needs you. */
  showLeads: boolean;
}

// ── The day ─────────────────────────────────────────────────────────────────────────────────────

export interface DaySummary {
  /** Live departures that carry people (a rental or a fee is not a departure). */
  departures: number;
  calledOff: number;
  /** Guests on paid parties. */
  guests: number;
  /** Paid parties with a pickup place on record. */
  pickups: number;
}

/** Whether a line's party is collected somewhere we know of. */
function pickupsOn(line: CalLine): number {
  const e = line.entry;
  if (line.cancelled) return 0;
  if (e.kind === 'occurrence') {
    return e.bookings.filter((b) => b.counted && Boolean(b.pickupLocation || b.transportPickup))
      .length;
  }
  if (e.kind === 'custom') {
    return e.counted && PEOPLE_TYPES.has(line.type) && Boolean(e.pickupLabel || e.transportPickup)
      ? 1
      : 0;
  }
  return e.counted && e.pickup ? 1 : 0;
}

/** One day's figures, by the Calendar's rule. */
export function daySummary(lines: readonly CalLine[], day: string): DaySummary {
  const onDay = lines.filter((l) => l.day === day);
  const s = summarize(onDay, day, day, { types: ALL_TYPES_ON, attentionOnly: false });
  return {
    departures: s.departures,
    calledOff: s.calledOff,
    guests: s.guests,
    pickups: onDay.reduce((n, l) => n + pickupsOn(l), 0),
  };
}

/**
 * Departures on each of the next `days` days, today first, by the same rule as the day summary —
 * the trend line under "Departures, next 7 days". The days add up to that card's figure.
 */
export function departuresByDay(lines: readonly CalLine[], today: string, days = 7): number[] {
  return Array.from({ length: days }, (_, i) => daySummary(lines, addDays(today, i)).departures);
}

function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

// ── The KPI cards ───────────────────────────────────────────────────────────────────────────────

export interface TodayKpi {
  key: string;
  label: string;
  value: string;
  detail: string;
  href: string | null;
}

export interface TodayKpiInput {
  /** `statsFor(data.stats, viewer)` — which of the four base cards this person may see. */
  stats: readonly DashStatView[];
  today: string;
  /** The 7-day revenue change already computed for the chart, or null (no prior week). */
  revenueDeltaPct: number | null;
  pendingCount: number;
  pendingTotalEur: number;
  /** The Calendar's figures for today and for the next seven days (today included). */
  calendar: Loaded<{ today: DaySummary; next7Departures: number }>;
  /** The quotes worklist's totals; undefined when the viewer may not see quotes. */
  quotes: Loaded<WorklistTotals> | undefined;
}

const COULD_NOT_LOAD = 'Could not load';

/**
 * The figures across the top, in the viewer's words. Departures come from the Calendar's day sheet
 * (never the old per-booking count); "Awaiting payment" is a COUNT with the euros beside it only for
 * money.revenue; "Quotes waiting" only with section.quotes, its euros only with money.revenue too.
 */
export function todayKpis(input: TodayKpiInput, viewer: TodayViewer): TodayKpi[] {
  const out: TodayKpi[] = [];
  const cal = input.calendar;
  for (const s of input.stats) {
    switch (s.key) {
      case 'today': {
        const ready = isReady(cal) ? cal.today : null;
        out.push({
          key: s.key,
          label: 'Departures today',
          value: ready ? String(ready.departures) : cal === 'error' ? '—' : '…',
          detail: ready
            ? [plural(ready.guests, 'guest'), plural(ready.pickups, 'pickup')].join(', ')
            : cal === 'error'
              ? COULD_NOT_LOAD
              : 'Loading',
          href: viewer.showCalendar
            ? `/admin/calendar?day=${input.today}`
            : s.linked
              ? '/admin/bookings?view=today'
              : null,
        });
        break;
      }
      case 'revenue':
        out.push({
          key: s.key,
          label: 'Taken, last 7 days',
          value: s.value,
          detail:
            input.revenueDeltaPct === null
              ? 'On bookings made in the last 7 days'
              : `${input.revenueDeltaPct >= 0 ? '+' : '−'}${Math.abs(input.revenueDeltaPct)}% against the 7 days before`,
          href: s.linked ? '/admin/bookings?pay=paid' : null,
        });
        break;
      case 'pending':
        out.push({
          key: s.key,
          label: 'Awaiting payment',
          value: String(input.pendingCount),
          detail: viewer.showMoney
            ? `${euro(input.pendingTotalEur)} not yet paid`
            : 'Bookings not yet paid',
          href: s.linked ? '/admin/bookings?view=awaiting' : null,
        });
        break;
      case 'upcoming': {
        const ready = isReady(cal) ? cal.next7Departures : null;
        out.push({
          key: s.key,
          label: 'Departures, next 7 days',
          value: ready !== null ? String(ready) : cal === 'error' ? '—' : '…',
          detail: ready !== null ? 'Today included' : cal === 'error' ? COULD_NOT_LOAD : 'Loading',
          href: viewer.showCalendar
            ? '/admin/calendar'
            : s.linked
              ? '/admin/bookings?view=next7'
              : null,
        });
        break;
      }
      default:
        break;
    }
  }
  if (viewer.showQuotes && input.quotes !== undefined) {
    const q = input.quotes;
    out.push({
      key: 'quotes',
      label: 'Quotes waiting',
      value: isReady(q) ? String(q.waiting.count) : q === 'error' ? '—' : '…',
      detail: isReady(q)
        ? viewer.showMoney
          ? `${euro(q.waiting.totalMinor / 100)} sent and still valid`
          : 'Sent and still valid'
        : q === 'error'
          ? COULD_NOT_LOAD
          : 'Loading',
      href: '/admin/quotes',
    });
  }
  return out;
}

/** The quotes worklist's headline figures, by its own rules. */
export function quoteTotals(quotes: readonly QuoteRow[], todayUtc?: string): WorklistTotals {
  return worklistTotals(quotes, todayUtc);
}

// ── The run sheet ───────────────────────────────────────────────────────────────────────────────

export interface RunRow {
  /** The calendar line's key — `/admin/calendar?day=…&line=<key>` opens it. */
  key: string;
  day: string;
  /** "HH:MM", or null: no time set on the tour ("Time TBC"), or a whole-day line. */
  time: string | null;
  allDay: boolean;
  title: string;
  subtitle: string | null;
  guests: number;
  pendingGuests: number;
  capacity: CapacityUse | null;
  pickups: number;
  cancelled: boolean;
  chip: ChipSpec;
}

interface Party {
  status: BookingRow['status'];
  counted: boolean;
  payView: PaymentView;
  balanceDueEur: number;
}

function partiesOf(entry: DayEntry): Party[] {
  if (entry.kind === 'occurrence') {
    return entry.bookings.map((b) => ({
      status: b.status,
      counted: b.counted,
      payView: b.payView ?? b.paymentState,
      balanceDueEur: b.balanceDueEur,
    }));
  }
  return [
    {
      status: entry.status,
      counted: entry.counted,
      payView: entry.payView ?? entry.paymentState,
      balanceDueEur: entry.balanceDueEur,
    },
  ];
}

/**
 * The one chip a run-sheet row wears, worst news first: called off; parties still to pay; a balance
 * to collect (its amount only for money.revenue); every party paid in full. Anything else (a refund
 * on the line) reads as its single party's own chip, or "Check the day sheet".
 */
export function runChip(line: CalLine, showMoney: boolean): ChipSpec {
  if (line.cancelled) return { label: 'Called off', tone: 'bad' };
  const parties = partiesOf(line.entry);
  const unpaid = parties.filter((p) => !p.counted).length;
  if (unpaid > 0) return { label: `${unpaid} awaiting payment`, tone: 'warn' };
  const partPaid = parties.filter((p) => p.payView === 'part_paid');
  if (partPaid.length > 0) {
    const owed = partPaid.reduce((s, p) => s + p.balanceDueEur, 0);
    return {
      label: showMoney ? `Balance ${euro(owed)}` : 'Balance to collect',
      tone: 'warn',
    };
  }
  if (parties.every((p) => p.payView === 'paid')) return { label: 'All paid', tone: 'ok' };
  if (parties.length === 1) return partyChip(parties[0]!);
  return { label: 'Check the day sheet', tone: 'neutral' };
}

/** A day's lines as run-sheet rows, in the day sheet's order (timed first, then untimed). */
export function runSheetRows(lines: readonly CalLine[], day: string, showMoney: boolean): RunRow[] {
  return lines
    .filter((l) => l.day === day)
    .map((l) => ({
      key: l.key,
      day: l.day,
      time: l.time,
      allDay: l.allDay,
      title: l.title,
      subtitle: l.subtitle,
      guests: l.guests,
      pendingGuests: l.pendingGuests,
      capacity: capacityUse(l.entry),
      pickups: pickupsOn(l),
      cancelled: l.cancelled,
      chip: runChip(l, showMoney),
    }));
}

/** "Sun 15 Nov, 3 departures, 14 guests" — the tomorrow preview's line. */
export function tomorrowLine(summary: DaySummary, day: string): string {
  return [
    shortDay(day),
    plural(summary.departures, 'departure'),
    plural(summary.guests, 'guest'),
  ].join(', ');
}

/**
 * The run sheet on a quiet day: one line instead of two empty boxes, and something useful in their
 * place. Today with departures needs none of this (`message` null). Today empty but tomorrow booked says
 * so in one line. Both empty: the next departures later in the week already loaded (days 2 to 6), at
 * most `limit` of them, or one line saying the week is clear.
 */
export interface QuietDays {
  message: string | null;
  /** The next departures after tomorrow, soonest first — only when today and tomorrow are both empty. */
  later: RunRow[];
  /** Departures later in the week beyond those listed. */
  moreLater: number;
}

export function quietDays(
  lines: readonly CalLine[],
  today: string,
  showMoney: boolean,
  limit = 3,
): QuietDays {
  const on = (day: string) => lines.filter((l) => l.day === day).length;
  if (on(today) > 0) return { message: null, later: [], moreLater: 0 };
  if (on(addDays(today, 1)) > 0)
    return { message: 'No departures today.', later: [], moreLater: 0 };
  const rest: RunRow[] = [];
  for (let i = 2; i <= 6; i += 1) rest.push(...runSheetRows(lines, addDays(today, i), showMoney));
  return {
    message:
      rest.length > 0 ? 'No departures today or tomorrow.' : 'No departures in the next 7 days.',
    later: rest.slice(0, limit),
    moreLater: Math.max(0, rest.length - limit),
  };
}

/** Tomorrow, as a Mauritius day. */
export function tomorrowOf(today: string): string {
  return addDays(today, 1);
}

// ── Needs you ───────────────────────────────────────────────────────────────────────────────────

export type NeedAction =
  /** "Send reminder" — the per-date installment reminder (`sendInstallmentReminder`). */
  | { kind: 'reminder'; ref: string; seq: number; label: string }
  /** "Send balance link" — a quote-born deposit balance (`sendBalanceLink`, keyed on the QUOTE). */
  | { kind: 'balance-link'; quote: QuoteRow }
  /** A plain link: open the booking, the quotes or the enquiries. */
  | { kind: 'link'; href: string; label: string };

export interface NeedRow {
  key: string;
  group: 'balance' | 'awaiting' | 'quotes' | 'leads';
  /** The problem, in the owner's words. */
  title: string;
  /** Who and which: guest, ref, trip date. */
  meta: string;
  action: NeedAction;
}

export interface NeedsYou {
  rows: NeedRow[];
  /** Everything waiting, counted (not just the rows shown) — the heading's number. */
  total: number;
  balances: { count: number; owedEur: number };
  awaiting: number;
  /** "See all" links for the groups cut short. */
  more: Array<{ href: string; label: string }>;
  /** A part of the list that could not be read, said in its own words. */
  notes: string[];
}

export interface NeedsInput {
  bookings: readonly BookingRow[];
  /** All quotes, or 'error' / null (loading) — only read with section.quotes. */
  quotes?: Loaded<readonly QuoteRow[]>;
  /** All enquiries — only read with section.leads. */
  leads?: Loaded<readonly LeadRow[]>;
  /** For the quote rules' "still valid" (UTC day, as the quotes worklist compares). */
  todayUtc?: string;
}

/** Rows shown per booking group; the rest are one "See all" away (the old panels' sizes). */
export const BALANCE_ROWS = 5;
export const AWAITING_ROWS = 4;

function tripOrBooked(b: BookingRow): string {
  const at = serviceWhen(b)?.at ?? null;
  return at ? `trip ${fmtDateShort(at)}` : `booked ${fmtDateShort(b.createdAt)}`;
}

/** Earliest trip first (an overdue balance leads), undated last in newest-booked order. */
function byTrip(a: BookingRow, b: BookingRow): number {
  const x = serviceWhen(a)?.at ?? null;
  const y = serviceWhen(b)?.at ?? null;
  return Number(x == null) - Number(y == null) || (x && y ? Date.parse(x) - Date.parse(y) : 0);
}

/**
 * The single action a balance row offers. A per-date schedule has a sender for exactly its next
 * installment; a quote-born deposit balance has the quote's balance link (with section.quotes, and
 * only while the quotes worklist itself files that quote under "Balance to collect"). Anything else
 * opens the booking.
 */
export function balanceAction(
  b: BookingRow,
  quoteByBooking: ReadonlyMap<string, QuoteRow>,
  todayUtc?: string,
): NeedAction {
  // A COMPLETED booking can still owe money (paymentView counts it as part paid), but the reminder and
  // balance-link routes refuse anything not 'confirmed', so it only gets "Open".
  if (b.status !== 'confirmed') {
    return { kind: 'link', href: `/admin/bookings?open=${b.id}`, label: 'Open' };
  }
  const next = nextInstallment(b.installments);
  if (next) return { kind: 'reminder', ref: b.ref, seq: next.seq, label: next.label };
  const quote = quoteByBooking.get(b.id);
  if (quote && quoteStage(quote, todayUtc).group === 'balance') {
    return { kind: 'balance-link', quote };
  }
  return { kind: 'link', href: `/admin/bookings?open=${b.id}`, label: 'Open' };
}

/**
 * What needs the owner today. Bookings rows need section.bookings (guest names and per-booking
 * amounts) and keep the old panels' rules exactly: a balance is `paymentView === 'part_paid'`; a
 * payment awaited is {@link isAwaitingPayment}. Quote and enquiry rows need their own sections and
 * link to those screens.
 */
export function needsYou(input: NeedsInput, viewer: TodayViewer): NeedsYou {
  const rows: NeedRow[] = [];
  const more: NeedsYou['more'] = [];
  const notes: string[] = [];
  let total = 0;

  const quotes =
    viewer.showQuotes && isReady(input.quotes ?? null) ? (input.quotes as QuoteRow[]) : [];
  const quoteByBooking = new Map<string, QuoteRow>();
  for (const q of quotes) if (q.bookingId) quoteByBooking.set(q.bookingId, q);

  let balances = { count: 0, owedEur: 0 };
  let awaitingCount = 0;
  if (viewer.showBookings) {
    const partPaid = input.bookings.filter((b) => paymentView(b) === 'part_paid').sort(byTrip);
    balances = {
      count: partPaid.length,
      owedEur: partPaid.reduce((s, b) => s + b.balanceDueEur, 0),
    };
    for (const b of partPaid.slice(0, BALANCE_ROWS)) {
      rows.push({
        key: `balance-${b.id}`,
        group: 'balance',
        title: `Balance of ${euro(b.balanceDueEur)} to collect, of ${euro(b.totalEur)}`,
        meta: [b.customerName, b.ref, tripOrBooked(b)].join(' · '),
        action: balanceAction(b, quoteByBooking, input.todayUtc),
      });
    }
    if (partPaid.length > BALANCE_ROWS) {
      more.push({
        href: '/admin/bookings?view=part_paid',
        label: `See all ${partPaid.length} part paid`,
      });
    }

    const awaiting = input.bookings.filter(isAwaitingPayment);
    awaitingCount = awaiting.length;
    for (const b of awaiting.slice(0, AWAITING_ROWS)) {
      rows.push({
        key: `awaiting-${b.id}`,
        group: 'awaiting',
        title: `Payment of ${euro(b.totalEur)} not made yet`,
        meta: [b.customerName, b.ref, tripOrBooked(b)].join(' · '),
        action: { kind: 'link', href: `/admin/bookings?open=${b.id}`, label: 'Open' },
      });
    }
    if (awaiting.length > AWAITING_ROWS) {
      more.push({
        href: '/admin/bookings?view=awaiting',
        label: `See all ${awaiting.length} awaiting payment`,
      });
    }
    total += partPaid.length + awaiting.length;
  }

  if (viewer.showQuotes) {
    const q = input.quotes ?? null;
    if (q === 'error') notes.push('Quotes could not be loaded.');
    else if (q) {
      const t = worklistTotals(q, input.todayUtc);
      if (t.waiting.count > 0) {
        rows.push({
          key: 'quotes-waiting',
          group: 'quotes',
          title: `${plural(t.waiting.count, 'quote')} waiting for payment`,
          meta: viewer.showMoney
            ? `${euro(t.waiting.totalMinor / 100)} sent and still valid`
            : 'Sent and still valid',
          action: { kind: 'link', href: '/admin/quotes', label: 'Open quotes' },
        });
        total += t.waiting.count;
      }
    }
  }

  if (viewer.showLeads) {
    const l = input.leads ?? null;
    if (l === 'error') notes.push('Enquiries could not be loaded.');
    else if (l) {
      const fresh = l.filter((x) => x.status === 'new');
      if (fresh.length > 0) {
        const oldest = fresh.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
        rows.push({
          key: 'leads-new',
          group: 'leads',
          title: `${plural(fresh.length, 'new enquiry', 'new enquiries')}`,
          meta: `Oldest received ${fmtDateShort(oldest.createdAt)}`,
          action: { kind: 'link', href: '/admin/leads', label: 'Open enquiries' },
        });
        total += fresh.length;
      }
    }
  }

  return { rows, total, balances, awaiting: awaitingCount, more, notes };
}

// ── The heading ─────────────────────────────────────────────────────────────────────────────────

/**
 * "4 departures today, 23 guests, and 4 things that need you." — only the parts this person may
 * see, from figures already on the screen. Null parts (still loading, or not theirs) are left out.
 */
export function todaySentence(parts: {
  departures: number | null;
  guests: number | null;
  needs: number | null;
}): string {
  const bits: string[] = [];
  if (parts.departures === 0) {
    bits.push('No departures today');
  } else {
    if (parts.departures !== null) bits.push(`${plural(parts.departures, 'departure')} today`);
    if (parts.guests !== null) bits.push(plural(parts.guests, 'guest'));
  }
  if (parts.needs !== null) {
    bits.push(parts.needs === 1 ? '1 thing that needs you' : `${parts.needs} things that need you`);
  }
  if (bits.length === 0) return '';
  if (bits.length === 1) return `${bits[0]}.`;
  return `${bits.slice(0, -1).join(', ')}, and ${bits[bits.length - 1]}.`;
}
