import { paymentView, type BookingRow } from '@/lib/admin/bookings';
import type { QuoteRow } from '@/lib/admin/quotes';
import { euro } from '@/lib/admin/dashboard';
import { mauDay, serviceWhen } from '@/lib/admin/format';
import { quoteTodayUtc } from '@/lib/quotes/validity';
import { balanceAction, type NeedAction, type RunRow } from '@/components/admin/today/rules';
import {
  WORK_GROUPS,
  balanceLinkQuestion,
  parseQuoteStage,
  quoteStage,
  validDaysLeft,
} from '@/components/admin/quotes/worklist';

/**
 * The side chat's own rules, kept free of React so they can be tested on fixtures (the sandbox has
 * too little data to show most of them).
 *
 * Nothing here decides anything new about money. A balance is what Today calls a balance
 * (`paymentView === 'part_paid'`), and the one thing a row can send is what Today's "Needs you" can
 * send for it (`balanceAction`: the next installment's reminder, or a quote's balance link). A quote's
 * validity is counted on the UTC day, as the send route refuses it; trip days are Mauritius days.
 */

const MAU_HOUR = new Intl.DateTimeFormat('en-GB', {
  hour: 'numeric',
  hourCycle: 'h23',
  timeZone: 'Indian/Mauritius',
});
const SHORT_DAY = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  timeZone: 'UTC',
});

export function plural(n: number, one: string, many: string = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** What a chat link opens: a booking's panel, a quote's panel, or a day (and line) on the calendar. */
export type ChatOpenTarget =
  | { kind: 'booking'; id: string }
  | { kind: 'quote'; id: string; stage: string | null }
  | { kind: 'day'; day: string; line: string | null };

/**
 * The thing a chat link points at, read from its address. The panel hands it to the screen through
 * context (the screens read their address only on arrival); null for a link that opens a whole
 * screen and nothing in it.
 */
export function openTargetFor(href: string): ChatOpenTarget | null {
  const url = new URL(href, 'https://admin.invalid');
  const q = url.searchParams;
  if (url.pathname === '/admin/bookings') {
    const id = q.get('open');
    return id ? { kind: 'booking', id } : null;
  }
  if (url.pathname === '/admin/quotes') {
    const id = q.get('quote');
    return id ? { kind: 'quote', id, stage: q.get('stage') } : null;
  }
  if (url.pathname === '/admin/calendar') {
    const day = q.get('day');
    return day && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(day)
      ? { kind: 'day', day, line: q.get('line') }
      : null;
  }
  return null;
}

function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/** "19 Oct" for a yyyy-mm-dd day. */
export function shortDay(day: string): string {
  return SHORT_DAY.format(new Date(`${day}T00:00:00Z`));
}

/** The home view's greeting, by the hour in Mauritius and the person's first name. */
export function greeting(name: string | null | undefined, now: Date): string {
  const hour = Number(MAU_HOUR.format(now));
  const who = firstName(name);
  if (hour < 5) return who ? `Burning the midnight oil, ${who}?` : 'Burning the midnight oil?';
  const part = hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return who ? `Good ${part}, ${who}.` : `Good ${part}.`;
}

/**
 * What the panel says it is looking at: the screen, and the part of it the address names ("Quotes ·
 * Balance to collect", "Calendar · 20 Nov"). Also what the model is told, so it knows which list the
 * operator means by "these".
 */
export function seeingLabel(
  screen: string,
  path: string,
  params: { get(name: string): string | null } | null,
): string {
  if (!params) return screen;
  if (path.startsWith('/admin/quotes')) {
    const stage = parseQuoteStage(params.get('stage'));
    const title = stage ? WORK_GROUPS.find((g) => g.id === stage)?.title : null;
    return title ? `${screen} · ${title}` : screen;
  }
  if (path.startsWith('/admin/calendar')) {
    const day = params.get('day');
    return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${screen} · ${shortDay(day)}` : screen;
  }
  return screen;
}

/* ---------------------------------------------------------------------------------------------- */
/* Balances                                                                                        */
/* ---------------------------------------------------------------------------------------------- */

export interface BalanceRow {
  id: string;
  ref: string;
  name: string;
  email: string;
  phone: string | null;
  /** The first service day in Mauritius, or null when the booking has none. */
  tripDay: string | null;
  owedEur: number;
  totalEur: number;
  /** Today's one action for this balance: a reminder, a balance link, or opening the booking. */
  action: NeedAction;
  /** A reminder or a balance link can go from the panel; anything else has to be opened. */
  sendable: boolean;
}

/**
 * Every balance still to collect, biggest first. A quote's balance link is only offered while the
 * quotes worklist itself files that quote under "Balance to collect" (`balanceAction`), and only
 * when the quotes were read at all (that needs the Quotes section).
 */
export function balanceRows(
  bookings: readonly BookingRow[],
  quotes: readonly QuoteRow[] | null,
  todayUtc: string = quoteTodayUtc(),
): BalanceRow[] {
  const quoteByBooking = new Map<string, QuoteRow>();
  for (const q of quotes ?? []) if (q.bookingId) quoteByBooking.set(q.bookingId, q);
  return bookings
    .filter((b) => paymentView(b) === 'part_paid')
    .map((b) => {
      const at = serviceWhen(b)?.at ?? null;
      const action = balanceAction(b, quoteByBooking, todayUtc);
      return {
        id: b.id,
        ref: b.ref,
        name: b.customerName,
        email: b.customerEmail,
        phone: b.customerPhone,
        tripDay: at ? mauDay(at) : null,
        owedEur: b.balanceDueEur,
        totalEur: b.totalEur,
        action,
        sendable: action.kind !== 'link',
      };
    })
    .sort((a, b) => b.owedEur - a.owedEur);
}

/** The balances whose trip day has already passed (Mauritius days): the ones to chase first. */
export function overdue(rows: readonly BalanceRow[], today: string): BalanceRow[] {
  return rows.filter((r) => r.tripDay !== null && r.tripDay < today);
}

export function owedTotal(rows: readonly BalanceRow[]): number {
  return rows.reduce((sum, r) => sum + r.owedEur, 0);
}

/** What a balance row will send, in words, for the row and for the confirm question. */
export function sendWhat(row: BalanceRow): string {
  if (row.action.kind === 'reminder') return `Reminder for ${row.action.label}`;
  if (row.action.kind === 'balance-link') return `Balance link · quote ${row.action.quote.ref}`;
  return 'Open the booking to collect it';
}

/** The rows a press of "Email" will act on: sendable, ticked, and not already sent. */
export function sendList(
  rows: readonly BalanceRow[],
  ticked: ReadonlySet<string>,
  sent: ReadonlySet<string> = new Set(),
): BalanceRow[] {
  return rows.filter((r) => r.sendable && ticked.has(r.id) && !sent.has(r.id));
}

/**
 * The one question asked before anything is emailed. A single balance link asks the Quotes screen's
 * own question, word for word; more than one names every guest, address and what each gets, and
 * keeps that question's warning about the earlier link.
 */
export function sendQuestion(rows: readonly BalanceRow[], showMoney: boolean): string {
  const [only] = rows;
  if (rows.length === 1 && only && only.action.kind === 'balance-link') {
    return balanceLinkQuestion(only.action.quote.ref, only.action.quote.customerEmail);
  }
  const lines = rows.map((r) => {
    const owed = showMoney ? `, ${euro(r.owedEur)} owed` : '';
    return `• ${r.name} (${r.email}): ${sendWhat(r).toLowerCase()}${owed}`;
  });
  const anyLink = rows.some((r) => r.action.kind === 'balance-link');
  return [
    `Email ${plural(rows.length, 'guest')}?`,
    '',
    ...lines,
    ...(anyLink
      ? ['', 'A balance link sent earlier stops working; the guest’s quote link is not affected.']
      : []),
  ].join('\n');
}

/**
 * The chat's answer to "chase the balances", worked out here rather than by the model: every
 * figure is the same one Today shows. `context` is what the model is told about this turn if the
 * conversation goes on, so "write Steven a message" still knows who Steven is.
 */
export function balancesAnswer(
  all: readonly BalanceRow[],
  today: string,
  showMoney: boolean,
): { text: string; steps: string[]; rows: BalanceRow[]; context: string } {
  const late = overdue(all, today);
  const steps = [`Checked ${plural(all.length, 'balance')}`, 'Compared trip dates'];
  if (late.length === 0) {
    const text =
      all.length === 0
        ? 'No balances to collect. Every part-paid booking is settled.'
        : `No trip that has already happened still owes a balance. ${plural(all.length, 'booking')} with a trip still to come ${all.length === 1 ? 'has' : 'have'} one to collect.`;
    return { text, steps, rows: [...all], context: text };
  }
  const [biggest] = late;
  const sendable = late.filter((r) => r.sendable).length;
  const owes = showMoney ? ` still owe ${euro(owedTotal(late))}` : ' still owe a balance';
  const lead =
    late.length === 1
      ? `1 guest has had their trip but${owes.replace('owe', 'owes')}.`
      : `${late.length} guests have had their trip but${owes}.`;
  const most =
    showMoney && biggest && late.length > 1
      ? ` ${biggest.name} owes the most, ${euro(biggest.owedEur)}.`
      : '';
  const can =
    sendable === late.length
      ? late.length === 1
        ? ' I can email them a reminder or balance link from here.'
        : ` I can email all ${late.length} a reminder or balance link from here.`
      : sendable === 0
        ? ' None of them has a reminder or balance link to send, so open each booking to collect.'
        : ` ${sendable} of them can be emailed from here; open the others to collect.`;
  const text = `${lead}${most}${can} Worth checking with your driver whether anyone paid cash on the day.`;
  const context = [
    text,
    ...late.map(
      (r) =>
        `${r.name} (${r.ref}), trip ${r.tripDay ? shortDay(r.tripDay) : 'not dated'}${showMoney ? `, ${euro(r.owedEur)} owed` : ''}`,
    ),
  ].join('\n');
  return { text, steps, rows: late, context };
}

/* ---------------------------------------------------------------------------------------------- */
/* Quotes                                                                                          */
/* ---------------------------------------------------------------------------------------------- */

export interface ExpiringQuote {
  id: string;
  ref: string;
  name: string;
  totalMinor: number;
  daysLeft: number;
}

/**
 * The sent, still-valid quote closest to lapsing within `within` days (biggest first on a tie), or
 * null. "Still valid" is the quotes worklist's own Waiting stage, on the send route's UTC day.
 */
export function expiringQuote(
  quotes: readonly QuoteRow[],
  todayUtc: string = quoteTodayUtc(),
  within = 3,
): ExpiringQuote | null {
  const soon = quotes
    .filter((q) => quoteStage(q, todayUtc).group === 'waiting')
    .map((q) => ({ q, daysLeft: validDaysLeft(q.validUntil, todayUtc) }))
    .filter(({ daysLeft }) => daysLeft >= 0 && daysLeft <= within)
    .sort((a, b) => a.daysLeft - b.daysLeft || b.q.totalMinor - a.q.totalMinor);
  const first = soon[0];
  if (!first) return null;
  return {
    id: first.q.id,
    ref: first.q.ref,
    name: first.q.customerName,
    totalMinor: first.q.totalMinor,
    daysLeft: first.daysLeft,
  };
}

export function expiresIn(daysLeft: number): string {
  if (daysLeft <= 0) return 'expires today';
  if (daysLeft === 1) return 'expires tomorrow';
  return `expires in ${daysLeft} days`;
}

/* ---------------------------------------------------------------------------------------------- */
/* Today's departures                                                                              */
/* ---------------------------------------------------------------------------------------------- */

/** The departures still running today (a called-off one is not something to pick up for). */
export function liveDepartures(rows: readonly RunRow[]): RunRow[] {
  return rows.filter((r) => !r.cancelled);
}

export function departuresAnswer(rows: readonly RunRow[]): {
  text: string;
  steps: string[];
  rows: RunRow[];
  context: string;
} {
  const live = liveDepartures(rows);
  const steps = ['Read today’s run sheet'];
  if (live.length === 0) {
    const text = 'Nothing departs today.';
    return { text, steps, rows: [], context: text };
  }
  const guests = live.reduce((s, r) => s + r.guests, 0);
  const pickups = live.reduce((s, r) => s + r.pickups, 0);
  const text = `${plural(live.length, 'departure')} today with ${plural(guests, 'guest')}${
    pickups ? ` and ${plural(pickups, 'pickup')}` : ''
  }. Open one for the names and pickup places.`;
  const context = [
    text,
    ...live.map(
      (r) =>
        `${r.allDay ? 'All day' : (r.time ?? 'Time not set')} ${r.title}, ${plural(r.guests, 'guest')}`,
    ),
  ].join('\n');
  return { text, steps, rows: live, context };
}

/* ---------------------------------------------------------------------------------------------- */
/* The home view's suggestions                                                                     */
/* ---------------------------------------------------------------------------------------------- */

export type SuggestionIcon = 'wallet' | 'clock' | 'spark' | 'pin' | 'chat';

export type Suggestion =
  | {
      key: string;
      kind: 'balances' | 'departures' | 'email';
      title: string;
      sub: string;
      icon: SuggestionIcon;
      urgent?: boolean;
    }
  | { key: string; kind: 'open'; title: string; sub: string; icon: SuggestionIcon; href: string }
  | {
      key: string;
      kind: 'prompt';
      title: string;
      sub: string;
      icon: SuggestionIcon;
      prompt: string;
    };

export interface AssistantViewer {
  /** money.revenue: totals and amounts. */
  showMoney: boolean;
  /** section.bookings: guest names and balances. */
  showBookings: boolean;
  /** section.quotes. */
  showQuotes: boolean;
  /** section.bookings or section.calendar: the day's departures. */
  showDepartures: boolean;
}

export interface HomeInput {
  /** null while loading or when not read; [] when there are none. */
  balances: readonly BalanceRow[] | null;
  quotes: readonly QuoteRow[] | null;
  departures: readonly RunRow[] | null;
  /** Today in Mauritius. */
  today: string;
  todayUtc?: string;
  path: string;
}

/** Questions for the model when there is nothing live to suggest, by screen. */
export function promptsFor(path: string): Array<{ title: string; sub: string; prompt: string }> {
  if (path.startsWith('/admin/activities')) {
    return [
      {
        title: 'Draft a new tour',
        sub: 'A sunset catamaran cruise, say',
        prompt: 'Build a draft tour for a sunset catamaran cruise',
      },
      {
        title: 'Warm up a description',
        sub: 'More specific, less generic',
        prompt: 'Rewrite this tour’s description to be warmer and more specific',
      },
    ];
  }
  return [
    {
      title: 'What runs this week?',
      sub: 'Tours with departures in the next 7 days',
      prompt: 'Which tours run this week?',
    },
    {
      title: 'Price a transfer',
      sub: 'Round trip from Belle Mare for 6',
      prompt: 'Round-trip transfer from Belle Mare for 6 people?',
    },
    {
      title: 'Rental fleet rates',
      sub: 'What each car costs per day',
      prompt: 'What does our rental fleet cost per day?',
    },
  ];
}

/** Up to this many cards on the home view. */
export const HOME_CARDS = 4;

/**
 * The home view's cards: what needs the person right now, from live data and only what their role
 * may see, topped up with plain questions for the model. Never a name or figure that is not in the
 * data: an empty list makes no card.
 */
export function homeSuggestions(input: HomeInput, viewer: AssistantViewer): Suggestion[] {
  const out: Suggestion[] = [];

  if (viewer.showBookings && input.balances && input.balances.length > 0) {
    const late = overdue(input.balances, input.today);
    const rows = late.length > 0 ? late : input.balances;
    const money = viewer.showMoney ? ` · ${euro(owedTotal(rows))} owed` : '';
    out.push(
      late.length > 0
        ? {
            key: 'balances',
            kind: 'balances',
            title: 'Chase overdue balances',
            sub: `${plural(late.length, 'past trip')}${money}`,
            icon: 'wallet',
            urgent: true,
          }
        : {
            key: 'balances',
            kind: 'balances',
            title: 'Balances to collect',
            sub: `${plural(rows.length, 'trip')} still to come${money}`,
            icon: 'wallet',
          },
    );
  }

  if (viewer.showQuotes && input.quotes) {
    const soon = expiringQuote(input.quotes, input.todayUtc);
    if (soon) {
      const who = firstName(soon.name) || soon.ref;
      out.push({
        key: 'quote',
        kind: 'open',
        title: `Nudge ${who}`,
        sub: viewer.showMoney
          ? `${euro(soon.totalMinor / 100)} quote ${expiresIn(soon.daysLeft)}`
          : `Quote ${expiresIn(soon.daysLeft)}`,
        icon: 'clock',
        href: `/admin/quotes?stage=waiting&quote=${encodeURIComponent(soon.id)}`,
      });
    }
    out.push({
      key: 'email',
      kind: 'email',
      title: 'Turn an email into a quote',
      sub: 'Paste it here and I’ll draft it',
      icon: 'spark',
    });
  }

  if (viewer.showDepartures && input.departures) {
    const live = liveDepartures(input.departures);
    if (live.length > 0) {
      const guests = live.reduce((s, r) => s + r.guests, 0);
      out.push({
        key: 'departures',
        kind: 'departures',
        title: 'Today’s departures',
        sub: `${plural(live.length, 'departure')} · ${plural(guests, 'guest')}`,
        icon: 'pin',
      });
    }
  }

  for (const p of promptsFor(input.path)) {
    if (out.length >= HOME_CARDS) break;
    out.push({ key: `prompt-${p.title}`, kind: 'prompt', icon: 'chat', ...p });
  }
  return out.slice(0, HOME_CARDS);
}
