import { balanceIsOutstanding } from '@/lib/quotes/deposit';
import { quoteTodayUtc } from '@/lib/quotes/validity';
import type {
  QuoteBookingSummary,
  QuoteLineBrief,
  QuoteRow,
  QuoteStatus,
} from '@/lib/admin/quotes';
import type { StatusTone } from '@/components/admin/ui';
import { fmtTime, mauDay } from '@/lib/admin/format';
import {
  convertedBookingKind,
  emptyQuoteForm,
  eurFromMinor,
  sendRefusal,
} from '@/components/admin/quotes/state';
import { searchKey } from '@/components/admin/quotes/suggest';

/**
 * THE QUOTES WORKLIST'S RULES, with none of its markup: which group a quote sits in, when it reads as
 * expired, and which actions its row offers. Pure, like `state.ts` beside it.
 *
 * ── "EXPIRED" IS DERIVED, NEVER WRITTEN ────────────────────────────────────────────────────────
 * Nothing in the app sets `quotes.status = 'expired'`; a quote goes stale by its `valid_until`
 * passing, and fourteen real ones still read "Sent" for that reason. This module reads a SENT quote
 * past its date as expired for display only. It compares 'yyyy-mm-dd' strings with `<` against the
 * UTC day, exactly as `sendRefusal` and `assertQuoteStillValid` do, so the list can never call a quote
 * expired that the send route would still send (or the other way round).
 *
 * ── CONVERTED IS NOT PAID ──────────────────────────────────────────────────────────────────────
 * `converted_at` means the guest opened checkout. Whether money arrived is the BOOKING's status, and
 * whether a balance is still owed is `balanceIsOutstanding` over the booking's own deposit, balance
 * and total (a stored `balance_due_minor` alone is not a debt — see src/lib/quotes/deposit.ts). A
 * converted quote whose booking could not be read is never filed as paid or done.
 */

export type QuoteWorkGroup = 'waiting' | 'balance' | 'draft' | 'expired' | 'done';

/** The groups, in the order the owner works through them (the mock-up's order). */
export const WORK_GROUPS: ReadonlyArray<{ id: QuoteWorkGroup; title: string; meta: string }> = [
  { id: 'waiting', title: 'Waiting for payment', meta: 'Sent and still valid' },
  { id: 'balance', title: 'Balance to collect', meta: 'Deposit paid, the rest is still owed' },
  { id: 'draft', title: 'Drafts to finish', meta: 'Not sent yet' },
  { id: 'expired', title: 'Expired unpaid', meta: 'Past their valid-until date' },
  { id: 'done', title: 'Done', meta: 'Paid, withdrawn or closed' },
];

/** What the stage rules read off a quote. `booking`: undefined = not read; null = no booking row. */
export interface StageInput {
  status: QuoteStatus;
  validUntil: string;
  convertedAt: string | null;
  booking?: QuoteBookingSummary | null;
}

export interface QuoteStage {
  group: QuoteWorkGroup;
  /** The chip's words. */
  label: string;
  tone: StatusTone;
  /** Minor units still owed, only in the balance group. */
  balanceOwedMinor: number | null;
  /** Minor units already paid, only in the balance group. */
  paidMinor: number | null;
}

/** True once the last valid day has gone by. Valid until today is still valid. */
export function isPastValidity(validUntil: string, today: string = quoteTodayUtc()): boolean {
  return Boolean(validUntil) && validUntil.slice(0, 10) < today.slice(0, 10);
}

function stage(group: QuoteWorkGroup, label: string, tone: StatusTone): QuoteStage {
  return { group, label, tone, balanceOwedMinor: null, paidMinor: null };
}

/** Where a quote belongs on the worklist, and the chip it carries there. */
export function quoteStage(input: StageInput, today: string = quoteTodayUtc()): QuoteStage {
  const past = isPastValidity(input.validUntil, today);
  if (input.convertedAt) {
    const booking = input.booking;
    if (booking && convertedBookingKind(booking.status) === 'paid') {
      const owed = balanceIsOutstanding({
        deposit: booking.depositMinor,
        balanceDue: booking.balanceDueMinor,
        total: booking.totalMinor,
      });
      if (owed) {
        return {
          ...stage('balance', 'Balance due', 'warn'),
          balanceOwedMinor: booking.balanceDueMinor,
          paidMinor: booking.totalMinor - booking.balanceDueMinor,
        };
      }
      return stage('done', 'Paid', 'ok');
    }
  }
  // Withdrawn before the converted cases below: a quote may be withdrawn once its booking died
  // unpaid, and it is closed then, not waiting.
  if (input.status === 'cancelled') return stage('done', 'Withdrawn', 'neutral');
  if (input.convertedAt) {
    const booking = input.booking;
    if (booking === undefined) return stage('waiting', 'Payment unknown', 'info');
    switch (convertedBookingKind(booking?.status ?? null)) {
      case 'pending':
        return stage('waiting', 'Checkout opened', 'warn');
      case 'abandoned':
        // The guest's link re-arms an abandoned checkout, but only while the quote is valid.
        return past
          ? stage('expired', 'Expired', 'bad')
          : stage('waiting', 'Checkout not finished', 'warn');
      default:
        return stage('done', 'Booking closed', 'neutral');
    }
  }
  if (input.status === 'draft') return stage('draft', 'Draft', 'neutral');
  if (input.status === 'expired') return stage('expired', 'Expired', 'bad');
  if (input.status === 'sent' && past) return stage('expired', 'Expired', 'bad');
  return stage('waiting', 'Sent', 'warn');
}

/** Every quote in exactly one group, newest first inside each (the order the rows arrive in). */
export function groupQuotes<T extends StageInput>(
  rows: readonly T[],
  today: string = quoteTodayUtc(),
): Record<QuoteWorkGroup, T[]> {
  const out: Record<QuoteWorkGroup, T[]> = {
    waiting: [],
    balance: [],
    draft: [],
    expired: [],
    done: [],
  };
  for (const row of rows) out[quoteStage(row, today).group].push(row);
  return out;
}

type PaidLaterInput = StageInput & Pick<QuoteRow, 'id' | 'ref' | 'customerEmail' | 'createdAt'>;

/** The later quote this guest paid, named on an open quote's row. */
export interface PaidLaterFlag {
  id: string;
  ref: string;
}

/**
 * Open quotes (waiting, draft, expired) whose guest — same email, case and spaces aside — PAID a quote
 * made after this one (paid in full or a deposit with a balance owed). Keyed by the open quote's id.
 *
 * A FLAG, NOT A REGROUPING. The usual story is a re-quote after an abandoned checkout, and the open one
 * should be withdrawn — while it is valid its link can still re-arm a checkout and take a second
 * payment. But a guest may also buy two different trips on two quotes, so the rule never moves the
 * row or changes the counts; it tells the owner, who decides.
 */
export function paidLaterFlags(
  rows: ReadonlyArray<PaidLaterInput>,
  today: string = quoteTodayUtc(),
): Map<string, PaidLaterFlag> {
  const emailKey = (email: string) => email.trim().toLowerCase();
  const paidByGuest = new Map<string, Array<{ id: string; ref: string; at: number }>>();
  const open: PaidLaterInput[] = [];
  for (const row of rows) {
    const s = quoteStage(row, today);
    if (s.label === 'Paid' || s.group === 'balance') {
      const key = emailKey(row.customerEmail);
      if (!key) continue;
      const list = paidByGuest.get(key) ?? [];
      list.push({ id: row.id, ref: row.ref, at: Date.parse(row.createdAt) });
      paidByGuest.set(key, list);
    } else if (s.group !== 'done') {
      open.push(row);
    }
  }
  const out = new Map<string, PaidLaterFlag>();
  for (const row of open) {
    const at = Date.parse(row.createdAt);
    let best: { id: string; ref: string; at: number } | null = null;
    for (const paid of paidByGuest.get(emailKey(row.customerEmail)) ?? []) {
      if (paid.at > at && (!best || paid.at > best.at)) best = paid;
    }
    if (best) out.set(row.id, { id: best.id, ref: best.ref });
  }
  return out;
}

export interface WorklistTotals {
  waiting: { count: number; totalMinor: number };
  balance: { count: number; owedMinor: number };
  expired: number;
  drafts: number;
  paid: number;
}

/** The headline figures above the groups. */
export function worklistTotals(
  rows: ReadonlyArray<StageInput & { totalMinor: number }>,
  today: string = quoteTodayUtc(),
): WorklistTotals {
  const totals: WorklistTotals = {
    waiting: { count: 0, totalMinor: 0 },
    balance: { count: 0, owedMinor: 0 },
    expired: 0,
    drafts: 0,
    paid: 0,
  };
  for (const row of rows) {
    const s = quoteStage(row, today);
    if (s.group === 'waiting') {
      totals.waiting.count += 1;
      totals.waiting.totalMinor += row.totalMinor;
    } else if (s.group === 'balance') {
      totals.balance.count += 1;
      totals.balance.owedMinor += s.balanceOwedMinor ?? 0;
    } else if (s.group === 'expired') totals.expired += 1;
    else if (s.group === 'draft') totals.drafts += 1;
    else if (s.label === 'Paid') totals.paid += 1;
  }
  return totals;
}

/**
 * Why this quote cannot be sent from its row — `sendRefusal` itself, fed the row, so the list and the
 * editor cannot disagree about it. Null when it can.
 */
export function rowSendRefusal(
  row: Pick<QuoteRow, 'id' | 'status' | 'validUntil' | 'convertedAt'>,
  today: string = quoteTodayUtc(),
): string | null {
  return sendRefusal(
    {
      ...emptyQuoteForm(today),
      id: row.id,
      status: row.status,
      validUntil: row.validUntil,
      convertedAt: row.convertedAt,
    },
    today,
  );
}

export interface RowActions {
  /** "Send again" (and WhatsApp, which sends again): a sent, valid, unconverted quote only. */
  resend: boolean;
  /** "Send balance link": a paid deposit booking with a balance genuinely owed. */
  balance: boolean;
}

export function rowActions(
  row: StageInput & Pick<QuoteRow, 'id'>,
  today: string = quoteTodayUtc(),
): RowActions {
  return {
    resend: row.status === 'sent' && rowSendRefusal(row, today) === null,
    // Only on a CONFIRMED booking: a completed one still sits under "Balance due" (the money is still
    // owed) but the balance route refuses it, so the button would only ever 409.
    balance: quoteStage(row, today).group === 'balance' && row.booking?.status === 'confirmed',
  };
}

/** The list's search: ref, name, email and phone digits, without case or accents. */
export function matchesQuoteSearch(
  row: Pick<QuoteRow, 'ref' | 'customerName' | 'customerEmail' | 'customerPhone'>,
  query: string,
): boolean {
  const q = searchKey(query);
  if (!q) return true;
  if (
    searchKey(row.ref).includes(q) ||
    searchKey(row.customerName).includes(q) ||
    searchKey(row.customerEmail).includes(q)
  ) {
    return true;
  }
  const digits = q.replace(/\D/g, '');
  return digits.length >= 3 && (row.customerPhone ?? '').replace(/\D/g, '').includes(digits);
}

/** A quote's lines, as the list names them: the first line, how many more, the earliest date. */
export interface LineSummary {
  first: string;
  more: number;
  firstDate: string | null;
}

/** One stored line, as `loadQuoteLineBriefs` reads it. */
export type LineSummaryRow = QuoteLineBrief;

export function lineSummaries(rows: readonly LineSummaryRow[]): Map<string, LineSummary> {
  const byQuote = new Map<string, LineSummaryRow[]>();
  for (const r of rows) {
    const list = byQuote.get(r.quoteId) ?? [];
    list.push(r);
    byQuote.set(r.quoteId, list);
  }
  const out = new Map<string, LineSummary>();
  for (const [quoteId, list] of byQuote) {
    const ordered = [...list].sort((a, b) => a.position - b.position);
    const head = ordered[0]!;
    const dates = ordered
      .map((r) => r.startsAt)
      .filter((d): d is string => Boolean(d))
      .sort((a, b) => Date.parse(a) - Date.parse(b));
    out.set(quoteId, {
      first: head.description?.trim() || head.priceLabel || 'Untitled line',
      more: ordered.length - 1,
      firstDate: dates[0] ?? null,
    });
  }
  return out;
}

/** "LW" for Lukas Weber — the avatar on a row. */
export function guestInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? [parts[0]![0], parts[parts.length - 1]![0]] : [parts[0]?.[0]];
  return letters.filter(Boolean).join('').toUpperCase() || '?';
}

/* ───────────────────────────────────────────────────────────────────────────────────────────────
 * THE WORKLIST'S STAGES, ROWS AND PANEL (the owner's mock-up, 16 Nov 2026)
 *
 * The groups above became tabs: five stage cards, one list at a time, each with its own order and a
 * note per row (days left, the trip date, what is owed), and a panel that opens on a row. Two clocks,
 * on purpose: VALIDITY is counted on the UTC day, like `isPastValidity` and the send route, so a row
 * never says "1 day left" on a quote the route already refuses; the TRIP DATE is a Mauritius day
 * (`mauDay`), so an early-morning transfer is not shown on the day before.
 * ─────────────────────────────────────────────────────────────────────────────────────────────── */

/** `?stage=` → a stage, or null for anything else. */
export function parseQuoteStage(value: string | null): QuoteWorkGroup | null {
  return WORK_GROUPS.some((g) => g.id === value) ? (value as QuoteWorkGroup) : null;
}

/** The stage to open on: the first, in working order, with anything in it. */
export function defaultQuoteStage(
  groups: Record<QuoteWorkGroup, readonly unknown[]>,
): QuoteWorkGroup {
  return WORK_GROUPS.find((g) => g.id !== 'done' && groups[g.id].length > 0)?.id ?? 'done';
}

export interface StageCard {
  id: QuoteWorkGroup;
  label: string;
  /** Always the stage's list length (with no search typed). */
  count: number;
  sub: string;
}

/** The five cards on top. Each count is its list's length, so a card never promises rows it lacks. */
export function stageCards(
  groups: Record<QuoteWorkGroup, ReadonlyArray<StageInput & { totalMinor: number }>>,
  today: string = quoteTodayUtc(),
): StageCard[] {
  const all = WORK_GROUPS.flatMap((g) => [...groups[g.id]]);
  const totals = worklistTotals(all, today);
  const empty = (g: QuoteWorkGroup) => groups[g].length === 0;
  const sub: Record<QuoteWorkGroup, string> = {
    waiting: empty('waiting')
      ? 'Nothing waiting'
      : `${eurFromMinor(totals.waiting.totalMinor)} sent, still valid`,
    balance: empty('balance')
      ? 'Nothing owed'
      : `${eurFromMinor(totals.balance.owedMinor)} still owed`,
    draft: empty('draft') ? 'Nothing to finish' : 'Not sent yet',
    expired: empty('expired') ? 'None lapsed' : 'Past their valid-until date',
    done: totals.paid === 0 ? 'None paid yet' : `${totals.paid} paid`,
  };
  return WORK_GROUPS.map((g) => ({
    id: g.id,
    label: g.title,
    count: groups[g.id].length,
    sub: sub[g.id],
  }));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "25 Nov" for a yyyy-mm-dd day, without any clock or time zone in the way. */
export function dayMonth(day: string): string {
  const [, m, d] = day.slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1] ?? ''}`;
}

function dayNumber(day: string): number {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number);
  return Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1) / 86_400_000;
}

/** Whole days from `from` to `to` (both yyyy-mm-dd): 0 = the same day, negative = before. */
export function daysBetween(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from));
}

/**
 * The question asked before a quote's balance link is emailed, everywhere one can be sent (the
 * Quotes list and panel, Today, the side chat). One wording, because it carries the warning that
 * matters: sending a new balance link stops the earlier one working.
 */
export function balanceLinkQuestion(ref: string, email: string): string {
  return `Email a balance payment link for quote ${ref} to ${email}? A balance link sent earlier stops working; the guest’s quote link is not affected.`;
}

/** Days still to go on a quote's validity: 0 = today is the last valid day, negative = expired. */
export function validDaysLeft(validUntil: string, today: string = quoteTodayUtc()): number {
  return daysBetween(today, validUntil);
}

export interface RowNote {
  text: string;
  /** Needs doing soon: shown in coral. */
  urgent: boolean;
}

/** How long a sent quote can still be paid, in words. */
export function validityNote(validUntil: string, today: string = quoteTodayUtc()): RowNote {
  const left = validDaysLeft(validUntil, today);
  if (left < 0) return { text: `Expired ${dayMonth(validUntil)}`, urgent: true };
  if (left === 0) return { text: 'Last valid day today', urgent: true };
  if (left === 1) return { text: 'Expires tomorrow', urgent: true };
  if (left <= 3) return { text: `Expires in ${left} days`, urgent: true };
  return { text: `Valid to ${dayMonth(validUntil)} · ${left} days left`, urgent: false };
}

/** The same countdown without the date, for a place that already shows the date beside it. */
export function validityCountdown(validUntil: string, today: string = quoteTodayUtc()): RowNote {
  const left = validDaysLeft(validUntil, today);
  if (left > 3) return { text: `${left} days left`, urgent: false };
  return left < 0 ? { text: 'Expired', urgent: true } : validityNote(validUntil, today);
}

export interface TripTile {
  /** "25" */
  day: string;
  /** "Dec" */
  month: string;
  /** The Mauritius day, yyyy-mm-dd. */
  date: string;
  /** The trip's first day is behind us. */
  past: boolean;
}

/** The date tile on a row: the quote's earliest line date, as a Mauritius day. */
export function tripTile(firstDate: string | null | undefined, todayMu: string): TripTile | null {
  if (!firstDate) return null;
  const date = mauDay(firstDate);
  const [day = '', month = ''] = dayMonth(date).split(' ');
  return { day, month, date, past: date < todayMu };
}

interface NoteInput extends StageInput {
  createdAt: string;
  sentAt: string | null;
}

/** The small line under a row's chip: what the owner needs to know about time. */
export function quoteRowNote(
  row: NoteInput,
  stage: QuoteStage,
  trip: TripTile | null,
  today: string,
  todayMu: string,
): RowNote {
  switch (stage.group) {
    case 'waiting': {
      const v = validityNote(row.validUntil, today);
      return trip?.past ? { text: `${v.text} · trip date passed`, urgent: true } : v;
    }
    case 'balance': {
      if (!trip) return { text: 'No trip date', urgent: false };
      const d = daysBetween(todayMu, trip.date);
      if (d < 0) return { text: 'Trip date passed — collect now', urgent: true };
      if (d === 0) return { text: 'Trip today', urgent: true };
      if (d === 1) return { text: 'Trip tomorrow', urgent: true };
      return { text: `Trip in ${d} days`, urgent: false };
    }
    case 'draft':
      return { text: `Started ${dayMonth(mauDay(row.createdAt))}`, urgent: false };
    case 'expired':
      return {
        text: `Expired ${dayMonth(row.validUntil)}${row.sentAt ? ` · sent ${dayMonth(mauDay(row.sentAt))}` : ''}`,
        urgent: false,
      };
    case 'done':
      return {
        text: row.sentAt
          ? `Sent ${dayMonth(mauDay(row.sentAt))}`
          : `Created ${dayMonth(mauDay(row.createdAt))}`,
        urgent: false,
      };
  }
}

/**
 * "Last sent 14 Nov, 10:32" (Mauritius time) for a quote that has been emailed, or null for one that
 * never has. `sent_at` is rewritten on every send (the send route stamps it each time, a resend
 * included), so it is the LATEST send, not the first.
 */
export function lastSentText(sentAt: string | null): string | null {
  if (!sentAt) return null;
  const at = new Date(sentAt);
  if (Number.isNaN(at.getTime())) return null;
  return `Last sent ${dayMonth(mauDay(sentAt))}, ${fmtTime(sentAt)}`;
}

/** The figure on a row's right, and the word under it. Null minor: nothing priced yet. */
export function quoteRowAmount(
  row: StageInput & { totalMinor: number; sentAt: string | null },
  stage: QuoteStage,
): { minor: number | null; sub: string } {
  if (stage.group === 'balance' && stage.balanceOwedMinor !== null) {
    return { minor: stage.balanceOwedMinor, sub: 'owed' };
  }
  switch (stage.group) {
    case 'waiting':
      // The send date is on the row's own "Last sent" line now, with its time.
      return { minor: row.totalMinor, sub: 'quoted' };
    case 'draft':
      return row.totalMinor > 0
        ? { minor: row.totalMinor, sub: 'drafted' }
        : { minor: null, sub: 'nothing priced' };
    case 'expired':
      return { minor: row.totalMinor, sub: 'not paid' };
    default:
      if (stage.label === 'Paid') {
        return { minor: row.booking?.totalMinor ?? row.totalMinor, sub: 'paid' };
      }
      return { minor: row.totalMinor, sub: stage.label === 'Withdrawn' ? 'withdrawn' : 'not paid' };
  }
}

export type QuoteSort = 'expires' | 'trip' | 'amount' | 'newest' | 'expired-recent';

export const SORT_LABELS: Record<QuoteSort, string> = {
  expires: 'Expires soonest',
  trip: 'Trip date',
  amount: 'Amount',
  newest: 'Newest',
  'expired-recent': 'Recently expired',
};

/** The orders each stage offers; the first is the one it opens in. */
export const STAGE_SORTS: Record<QuoteWorkGroup, readonly QuoteSort[]> = {
  waiting: ['expires', 'trip', 'amount', 'newest'],
  balance: ['trip', 'amount', 'newest'],
  draft: ['newest', 'trip', 'amount'],
  expired: ['expired-recent', 'trip', 'amount', 'newest'],
  done: ['newest', 'trip', 'amount'],
};

/** What each stage says about its list under its title. */
export const STAGE_HINTS: Record<QuoteWorkGroup, string> = {
  waiting: 'Sent and still valid',
  balance: 'Deposit paid, the rest is still owed',
  draft: 'Started but not sent yet',
  expired: 'Past their valid-until date · worth a follow-up',
  done: 'Paid, withdrawn or closed',
};

/** `?sort=` → one of the stage's orders, or its first. */
export function parseQuoteSort(value: string | null, stage: QuoteWorkGroup): QuoteSort {
  const allowed = STAGE_SORTS[stage];
  return allowed.includes(value as QuoteSort) ? (value as QuoteSort) : allowed[0]!;
}

type SortRow = { id: string; createdAt: string; validUntil: string };

/**
 * One stage's rows in the chosen order. `tripDate` and `amount` come from the screen (the line dates
 * and the row's figure). Rows with no trip date go last; ties keep the newest first.
 */
export function sortQuotes<T extends SortRow>(
  rows: readonly T[],
  sort: QuoteSort,
  by: { tripDate: (row: T) => string | null; amount: (row: T) => number },
): T[] {
  const newest = (a: T, b: T) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
  const cmp: Record<QuoteSort, (a: T, b: T) => number> = {
    expires: (a, b) => a.validUntil.localeCompare(b.validUntil),
    'expired-recent': (a, b) => b.validUntil.localeCompare(a.validUntil),
    amount: (a, b) => by.amount(b) - by.amount(a),
    newest: () => 0,
    trip: (a, b) => {
      const x = by.tripDate(a);
      const y = by.tripDate(b);
      if (x === y) return 0;
      if (!x) return 1;
      if (!y) return -1;
      return Date.parse(x) - Date.parse(y);
    },
  };
  return [...rows].sort((a, b) => cmp[sort](a, b) || newest(a, b));
}

export type StepState = 'done' | 'current' | 'todo' | 'stopped';

export interface ProgressStep {
  label: string;
  when: string;
  state: StepState;
}

/** Created → Sent → Checkout → Paid, as far as this quote got, with the day each step happened. */
export function quoteProgress(row: NoteInput, stage: QuoteStage): ProgressStep[] {
  const short = (iso: string) => dayMonth(mauDay(iso));
  const created: ProgressStep = { label: 'Created', when: short(row.createdAt), state: 'done' };
  const sent: ProgressStep = row.sentAt
    ? { label: 'Sent', when: short(row.sentAt), state: 'done' }
    : stage.group === 'draft'
      ? { label: 'Sent', when: 'Not yet', state: 'current' }
      : { label: 'Sent', when: '—', state: 'todo' };

  let checkout: ProgressStep;
  if (row.convertedAt) {
    checkout = { label: 'Checkout', when: short(row.convertedAt), state: 'done' };
  } else if (row.status === 'cancelled') {
    checkout = { label: 'Withdrawn', when: '', state: 'stopped' };
  } else if (stage.group === 'expired') {
    checkout = { label: 'Expired', when: dayMonth(row.validUntil), state: 'stopped' };
  } else if (stage.group === 'waiting') {
    checkout = { label: 'Checkout', when: 'Not started', state: 'current' };
  } else {
    checkout = { label: 'Checkout', when: '—', state: 'todo' };
  }

  let paid: ProgressStep;
  if (stage.label === 'Paid') {
    paid = { label: 'Paid', when: 'In full', state: 'done' };
  } else if (stage.group === 'balance') {
    paid = {
      label: 'Paid',
      when: `Deposit in · ${eurFromMinor(stage.balanceOwedMinor ?? 0)} owed`,
      state: 'current',
    };
  } else if (stage.label === 'Booking closed') {
    paid = { label: 'Paid', when: 'Never', state: 'stopped' };
  } else if (row.convertedAt && stage.group === 'waiting') {
    paid = { label: 'Paid', when: 'Waiting', state: 'current' };
  } else {
    paid = { label: 'Paid', when: '—', state: 'todo' };
  }

  return [created, sent, checkout, paid];
}

export interface PanelMoney {
  label: string;
  minor: number;
  sub: string;
  /** Balance stage only: how much of the booking is paid. */
  bar: { paidMinor: number; totalMinor: number } | null;
}

/** The panel's dark band: the one figure that matters at this stage, and a line under it. */
export function quotePanelMoney(
  row: StageInput & { totalMinor: number },
  stage: QuoteStage,
  today: string = quoteTodayUtc(),
): PanelMoney {
  if (stage.group === 'balance' && stage.balanceOwedMinor !== null && stage.paidMinor !== null) {
    const total = row.booking?.totalMinor ?? row.totalMinor;
    return {
      label: 'Still owed',
      minor: stage.balanceOwedMinor,
      sub: `${eurFromMinor(stage.paidMinor)} of ${eurFromMinor(total)} paid`,
      bar: { paidMinor: stage.paidMinor, totalMinor: total },
    };
  }
  const plain = (label: string, sub: string, minor = row.totalMinor): PanelMoney => ({
    label,
    minor,
    sub,
    bar: null,
  });
  switch (stage.group) {
    case 'waiting':
      return plain('Quote total', validityNote(row.validUntil, today).text);
    case 'draft':
      return plain('Drafted total', 'Not sent yet');
    case 'expired':
      return plain('Quote total', `Expired ${dayMonth(row.validUntil)} without being paid`);
    default:
      if (stage.label === 'Paid') {
        return plain('Paid', 'Accepted and paid', row.booking?.totalMinor ?? row.totalMinor);
      }
      if (stage.label === 'Withdrawn') {
        return plain('Quote total', 'Withdrawn: its link no longer opens');
      }
      return plain('Quote total', 'The booking closed without being paid');
  }
}

/** The one main action for a quote, by stage. Null: nothing obvious to do next. */
export type QuotePrimary = 'resend' | 'balance' | 'finish' | 'duplicate' | 'booking';

export function quotePrimary(
  row: StageInput & Pick<QuoteRow, 'id' | 'bookingId'>,
  today: string = quoteTodayUtc(),
): QuotePrimary | null {
  const stage = quoteStage(row, today);
  const actions = rowActions(row, today);
  if (actions.balance) return 'balance';
  if (actions.resend) return 'resend';
  if (stage.group === 'draft') return 'finish';
  if (stage.group === 'expired') return 'duplicate';
  if (stage.label === 'Paid' && row.bookingId) return 'booking';
  if (stage.group === 'done') return 'duplicate';
  return null;
}
