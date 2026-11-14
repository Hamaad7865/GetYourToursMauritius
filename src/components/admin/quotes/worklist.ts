import { balanceIsOutstanding } from '@/lib/quotes/deposit';
import { quoteTodayUtc } from '@/lib/quotes/validity';
import type {
  QuoteBookingSummary,
  QuoteLineBrief,
  QuoteRow,
  QuoteStatus,
} from '@/lib/admin/quotes';
import type { StatusTone } from '@/components/admin/ui';
import { convertedBookingKind, emptyQuoteForm, sendRefusal } from '@/components/admin/quotes/state';
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
  { id: 'expired', title: 'Expired without paying', meta: 'Past their valid-until date' },
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
    balance: quoteStage(row, today).group === 'balance',
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
