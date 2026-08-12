import { quoteTotalMinor } from '@/lib/quotes/totals';
import { defaultValidUntil, quoteTodayUtc } from '@/lib/quotes/validity';
import { fmtDate, fmtTime, mauDay } from '@/lib/admin/format';
import { rentalDays, regionFromCoords } from '@/lib/services/pricing';
import { ValidationError } from '@/lib/services/errors';
import type {
  QuoteDetail,
  QuoteInput,
  QuoteItemInput,
  QuoteItemKind,
  QuoteStatus,
} from '@/lib/admin/quotes';
import type { QuoteEmailInput } from '@/lib/email/quote';

/**
 * THE QUOTES EDITOR'S DECISIONS, with none of its markup — the same split as the tour editor's
 * `activity/sections.ts`, and for the same reason: what this screen gets wrong is not a layout, it
 * is a figure or a line SHAPE, and neither is visible in a screenshot.
 *
 * Everything here is pure. The screen (AdminQuotes.tsx) loads, saves and sends; this module decides
 * what a typed price means, what a picked departure costs, which lines the money path will accept,
 * and what the operator is shown before an email leaves.
 *
 * ── MONEY IS MINOR UNITS, AND THE STRING IS PARSED, NOT MULTIPLIED ────────────────────────────
 * The operator types euros; every consumer downstream — `quote_items.unit_amount_minor`,
 * `quotes.total_minor`, `bookings.total_minor`, the card — is an integer number of cents. The
 * conversion happens ONCE, here, by reading the digits (`parseEurosToMinor`), and the euro string is
 * never a `number` at any point in between. `Math.round(parseFloat(text) * 100)` would look
 * identical for two-decimal input and quietly turn a mistyped '45.678' into 4568 — a price nobody
 * wrote, charged to a card. src/lib/admin/quotes.ts's header states the same rule from the other
 * end: a float on the way through the editor is exactly how the stored total and the stored lines
 * stop agreeing, and api_convert_quote refuses to charge a quote where they have.
 *
 * ── AN OVERRIDDEN TOUR PRICE IS NOT A CATALOGUE LINE ──────────────────────────────────────────
 * `assertQuotedPricesStillStand` in app/api/v1/quotes/[ref]/pay/route.ts re-derives EVERY catalogue
 * line from `activity_option_prices` at pay time and refuses (409) unless the recomputed total
 * equals `quotes.total_minor`. So a catalogue line held at a negotiated price is not a discount —
 * it is an offer the guest is emailed, opens, and cannot pay. {@link quoteInputFromForm} therefore
 * writes an overridden tour line as a CUSTOM line: the negotiated figure is charged as typed, the
 * departure it was quoted against survives in `starts_at` and in the description, and the trade —
 * documented in the plan's "a free-text line holds no capacity" — is that it reserves no seat.
 */

/* ------------------------------------------------------------------------------------------- */
/* Money                                                                                         */
/* ------------------------------------------------------------------------------------------- */

/** `12999` -> `'129.99'`. Integer arithmetic; no division, so no float ever holds a price. */
export function formatMinorAsEuros(minorAmount: number): string {
  const whole = Math.trunc(Math.abs(minorAmount));
  const sign = minorAmount < 0 ? '-' : '';
  return `${sign}${Math.floor(whole / 100)}.${String(whole % 100).padStart(2, '0')}`;
}

/** `12999` -> `'€129.99'`, for anywhere the currency is not already on screen. */
export function eurFromMinor(minorAmount: number): string {
  return `€${formatMinorAsEuros(minorAmount)}`;
}

/**
 * The euro string the operator typed, as whole minor units — or a {@link ValidationError} naming the
 * field. `label` is what the operator sees ("Line 2 unit price"), so the message points at the box.
 *
 * Accepts a leading €, spaces, and a comma for the decimal point (a French keyboard types '55,00').
 * Refuses a third decimal outright rather than rounding it: rounding money the operator did not type
 * is the failure this whole module is arranged to prevent, and it is silent — the quote saves, the
 * email goes out, and the card is charged the rounded figure.
 */
export function parseEurosToMinor(input: string, label: string): number {
  const raw = String(input ?? '')
    .replace(/\s/g, '')
    .replace(/^€/, '');
  if (!raw) {
    throw new ValidationError(`${label} is empty. Type an amount in euros, e.g. 129.99.`);
  }
  if (/^\d+[.,]\d{3,}$/.test(raw)) {
    throw new ValidationError(
      `${label} has more than two decimals ("${raw}"). Money is charged in whole cents, so type at ` +
        `most two — nothing here will round it for you.`,
    );
  }
  if (!/^\d+([.,]\d{1,2})?$/.test(raw)) {
    throw new ValidationError(
      `${label} is not an amount in euros ("${input}"). Type digits with at most two decimals, ` +
        `e.g. 129.99. Negative amounts are not chargeable.`,
    );
  }
  const [whole = '0', fraction = ''] = raw.replace(',', '.').split('.');
  return Number(whole) * 100 + Number(`${fraction}00`.slice(0, 2));
}

/** A whole party size above zero, or a {@link ValidationError}. `quantity int check (> 0)`. */
export function parseQuantity(input: string, label: string): number {
  const raw = String(input ?? '').trim();
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new ValidationError(
      `${label} must be a whole number of at least 1 ("${input}"). A line for nobody cannot be ` +
        `priced, and a fractional one cannot be held against a departure.`,
    );
  }
  return Number(raw);
}

/* ------------------------------------------------------------------------------------------- */
/* Dates                                                                                         */
/* ------------------------------------------------------------------------------------------- */

/**
 * The validity window itself now lives in src/lib/quotes/validity.ts, beside the rule that reads it
 * (`assertQuoteStillValid`). It moved because `duplicateQuote` — a lib function — has to pick a fresh
 * date for a copy of an offer whose own date has gone by, and a lib importing this components module
 * to learn how long an offer stands would be the wrong direction. Re-exported here so every existing
 * caller and test keeps its import.
 */
export { QUOTE_VALIDITY_DAYS, defaultValidUntil } from '@/lib/quotes/validity';

/**
 * A Mauritius wall-clock date + time as an instant.
 *
 * `quote_items.starts_at` is `timestamptz`, and Part 3 will read `booking_custom_items.starts_at`
 * onto the operations day sheet — which is bounded in Mauritius time (`src/lib/admin/calendar.ts`
 * uses `${day}T00:00:00+04:00`). Mauritius keeps a fixed +04:00 with no DST, so this is exact.
 */
export function mauritiusInstant(date: string, time: string): string | null {
  if (!date) return null;
  const at = new Date(`${date}T${time || '00:00'}:00.000+04:00`);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

/* ------------------------------------------------------------------------------------------- */
/* The form                                                                                      */
/* ------------------------------------------------------------------------------------------- */

/**
 * One line as the editor holds it.
 *
 * Money and quantity are held as the operator's own TEXT, not as numbers: a half-typed '12.' is a
 * legal thing to be looking at, and parsing on every keystroke would either reject it or coerce it.
 * They become integers in exactly one place, {@link quoteInputFromForm}, which is also where the
 * refusals are raised — so nothing part-typed can reach a statement.
 */
export interface QuoteLineDraft {
  /** React key. Stable across reordering, which array indices are not. */
  key: string;
  kind: QuoteItemKind;
  /** What the guest reads. Composed for a tour line, typed for a custom one; always editable. */
  description: string;
  /** Catalogue only: the tier the pay route re-prices against (option + label -> amount). */
  priceLabel: string;
  sessionOccurrenceId: string | null;
  activityOptionId: string | null;
  /** The departure instant of a tour line, kept even if the line is overridden into a custom one. */
  startsAt: string | null;
  /** Custom/rental only: the day and time the operator typed, in Mauritius time. */
  date: string;
  time: string;
  quantityText: string;
  unitText: string;
  /**
   * The catalogue price this line was added at, in minor units. The line stays a CATALOGUE line
   * only while its typed price still equals this — see the module header.
   */
  catalogueUnitMinor: number | null;
  /** Set by {@link rentalLineDraft} for a rental line, null otherwise; the editor must never drop it
   *  on a `kind='rental'` line either. See `formFromQuote` and `quoteItemRows`. */
  rentalVehicleSlug: string | null;
  /**
   * An optional round-trip TRANSPORT add-on attached to THIS line (a tour or a custom line, never a
   * rental — a car IS the transport). null when no transfer is attached. The fare is held as TEXT like
   * every other money field on the draft; {@link quoteInputFromForm} parses it once into
   * `transportFareMinor`, which lifts the quote total (Σ line subtotals + Σ transport fares). The pickup
   * is the guest's hotel — set on the line's own control and remembered across lines.
   */
  transport: { pickupLabel: string; dropoffLabel: string; fareText: string } | null;
}

export interface QuoteFormValues {
  id: string | null;
  /** Null until the first save — the public ref is minted by `saveQuote`. */
  ref: string | null;
  status: QuoteStatus;
  /** Non-null once the quote has been CONVERTED to a booking (the guest opened checkout) — NOT proof of
   *  payment. `bookingStatus` says whether that booking actually settled. The editor refuses to re-price
   *  a converted offer regardless. */
  convertedAt: string | null;
  bookingId: string | null;
  /** The converted booking's LIVE status: 'confirmed'/'completed' = the deposit or full amount actually
   *  settled; 'payment_pending' = the guest opened checkout but hasn't paid; anything else = the booking
   *  expired/failed/was cancelled unpaid. Null until the quote has a booking. Read-only metadata. */
  bookingStatus: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  validUntil: string;
  /** The language the OFFER is written in — copied into the booking, the confirmation and the VAT
   *  invoice at conversion. Not the operator's own language. */
  locale: 'en' | 'fr';
  /** Guest-facing covering note. */
  introNote: string;
  /** Staff-only. Never rendered into the email or the public page — see `previewEmailInput`. */
  internalNotes: string;
  /**
   * The deposit that confirms the booking, in BASIS POINTS of the total (1000 = 10.00%, the default;
   * 10000 = pay-in-full, the unchanged single-charge path). Held as bps, not a float percent: the
   * editor shows `bps / 100` as a whole percent and never round-trips a float, exactly as money is
   * PARSED rather than multiplied. Copied into `quotes.deposit_bps`, which api_convert_quote sizes
   * the first charge from — the rest is chased later with the balance link.
   */
  depositBps: number;
  lines: QuoteLineDraft[];
}

let keySeed = 0;
/** A key for a new line. Unique per session; never persisted. */
export function newLineKey(): string {
  keySeed += 1;
  return `line-${keySeed}-${Math.random().toString(36).slice(2, 8)}`;
}

export function customLineDraft(): QuoteLineDraft {
  return {
    key: newLineKey(),
    kind: 'custom',
    description: '',
    priceLabel: '',
    sessionOccurrenceId: null,
    activityOptionId: null,
    startsAt: null,
    date: '',
    time: '',
    quantityText: '1',
    unitText: '',
    catalogueUnitMinor: null,
    rentalVehicleSlug: null,
    transport: null,
  };
}

export function emptyQuoteForm(today: string = quoteTodayUtc()): QuoteFormValues {
  return {
    id: null,
    ref: null,
    status: 'draft',
    convertedAt: null,
    bookingId: null,
    bookingStatus: null,
    customerName: '',
    customerEmail: '',
    customerPhone: '',
    validUntil: defaultValidUntil(today),
    locale: 'en',
    introNote: '',
    internalNotes: '',
    depositBps: DEFAULT_DEPOSIT_BPS,
    lines: [],
  };
}

/**
 * A saved quote, back in the editor.
 *
 * `catalogueUnitMinor` is seeded from the STORED unit price, so re-opening and saving a quote
 * changes nothing: the line is still the catalogue line it was. Touch the price and it becomes a
 * custom line, exactly as it would have on the way in.
 */
export function formFromQuote(quote: QuoteDetail): QuoteFormValues {
  return {
    id: quote.id,
    ref: quote.ref,
    status: quote.status,
    convertedAt: quote.convertedAt,
    bookingId: quote.bookingId,
    bookingStatus: quote.bookingStatus,
    customerName: quote.customerName,
    customerEmail: quote.customerEmail,
    customerPhone: quote.customerPhone ?? '',
    validUntil: quote.validUntil,
    locale: quote.locale === 'fr' ? 'fr' : 'en',
    introNote: quote.introNote ?? '',
    internalNotes: quote.internalNotes ?? '',
    // The stored deposit comes back EXACTLY — a non-round percent (an AI draft, a manual set)
    // survives re-opening and saving untouched. Defaulted only if a row somehow carries none.
    depositBps: quote.depositBps ?? DEFAULT_DEPOSIT_BPS,
    lines: quote.items.map((item) => ({
      key: newLineKey(),
      kind: item.kind,
      description: item.description ?? '',
      priceLabel: item.priceLabel ?? '',
      sessionOccurrenceId: item.sessionOccurrenceId,
      activityOptionId: item.activityOptionId,
      startsAt: item.startsAt,
      date: item.kind === 'catalogue' || !item.startsAt ? '' : mauDay(item.startsAt),
      time: item.kind === 'catalogue' || !item.startsAt ? '' : fmtTime(item.startsAt),
      quantityText: String(item.quantity),
      unitText: formatMinorAsEuros(item.unitAmountMinor),
      catalogueUnitMinor: item.kind === 'catalogue' ? item.unitAmountMinor : null,
      rentalVehicleSlug: item.rentalVehicleSlug,
      // The stored transport add-on comes back as the line's own transfer, fare re-shown as text.
      transport:
        item.transportFareMinor != null
          ? {
              pickupLabel: item.transportPickupLabel ?? '',
              dropoffLabel: item.transportDropoffLabel ?? '',
              fareText: formatMinorAsEuros(item.transportFareMinor),
            }
          : null,
    })),
  };
}

/**
 * How the editor should describe a CONVERTED quote's booking, from the booking's LIVE status — because
 * `convertedAt` alone means "a booking was minted" (the guest opened checkout), NOT that they paid.
 *  - 'paid'      — the deposit or full amount settled (confirmed/completed): lines locked, live record.
 *  - 'pending'   — checkout opened, not yet paid (payment_pending/held/draft).
 *  - 'abandoned' — the booking expired/failed unpaid: nothing was charged, the guest can pay again.
 *  - 'other'     — cancelled/refunded/unknown: point the operator at the bookings screen.
 */
export type ConvertedBookingKind = 'paid' | 'pending' | 'abandoned' | 'other';
export function convertedBookingKind(bookingStatus: string | null): ConvertedBookingKind {
  switch (bookingStatus) {
    case 'confirmed':
    case 'completed':
      return 'paid';
    case 'payment_pending':
    case 'held':
    case 'draft':
      return 'pending';
    case 'expired':
    case 'failed':
      return 'abandoned';
    default:
      return 'other';
  }
}

/** Move a line one place up (-1) or down (+1). Out of range is a no-op, never a dropped line. */
export function moveLine(lines: QuoteLineDraft[], index: number, delta: number): QuoteLineDraft[] {
  const target = index + delta;
  if (index < 0 || index >= lines.length || target < 0 || target >= lines.length) return lines;
  const next = [...lines];
  const [moved] = next.splice(index, 1);
  next.splice(target, 0, moved!);
  return next;
}

/**
 * The editor's lines as `saveQuote` input — the ONE place a typed string becomes money.
 *
 * Refuses, with the line number in the message, everything the operator can still fix: a quantity
 * that is not a whole party, a price that is not an amount, a line with nothing written on it. The
 * database would refuse the last two as well (`quote_item_shape`, the int/bigint columns), but only
 * at INSERT — which on the edit path is the LAST statement, after the new total is written and the
 * old lines are deleted. src/lib/admin/quotes.ts's `quoteItemRows` documents that state: a stored
 * total with no itemisation behind it, i.e. a quote api_convert_quote then refuses to charge against
 * a link the guest already holds.
 */
export function quoteInputFromForm(form: QuoteFormValues): QuoteInput {
  const items: QuoteItemInput[] = form.lines.map((line, index) => {
    const label = `Line ${index + 1}`;
    const quantity = parseQuantity(line.quantityText, `${label} quantity`);
    const unitAmountMinor = parseEurosToMinor(line.unitText, `${label} unit price`);
    // A tour line survives as a catalogue line only at the catalogue's own price — see the header.
    const catalogue =
      line.kind === 'catalogue' &&
      line.catalogueUnitMinor !== null &&
      line.catalogueUnitMinor === unitAmountMinor;
    const kind: QuoteItemKind = catalogue
      ? 'catalogue'
      : line.kind === 'rental'
        ? 'rental'
        : 'custom';
    const description = line.description.trim();
    if (!description) {
      throw new ValidationError(
        `${label} has no description. It is the sentence the guest reads on the offer and on their ` +
          `booking, so a line without one cannot be sent.`,
      );
    }
    // The transport add-on: a tour/custom line may carry a round-trip transfer, a rental never does (a
    // car IS the transport). Its fare becomes money HERE — the one place a typed string is parsed — and
    // the pickup/dropoff ride through. quoteTotalMinor then adds transportFareMinor on top of the line's
    // own subtotal, so an attached transfer lifts the quote total.
    const transport =
      line.kind !== 'rental' && line.transport
        ? {
            transportPickupLabel: line.transport.pickupLabel.trim() || null,
            transportDropoffLabel: line.transport.dropoffLabel.trim() || null,
            transportFareMinor: parseEurosToMinor(
              line.transport.fareText,
              `${label} transfer fare`,
            ),
          }
        : { transportPickupLabel: null, transportDropoffLabel: null, transportFareMinor: null };
    return {
      kind,
      description,
      priceLabel: catalogue ? line.priceLabel : null,
      sessionOccurrenceId: catalogue ? line.sessionOccurrenceId : null,
      activityOptionId: catalogue ? line.activityOptionId : null,
      // A tour line keeps the departure it was quoted against even after an override drops it to a
      // custom line: it is what the guest recognises, and what the day sheet will read.
      startsAt: line.startsAt ?? mauritiusInstant(line.date, line.time),
      rentalVehicleSlug: line.kind === 'rental' ? line.rentalVehicleSlug : null,
      quantity,
      unitAmountMinor,
      ...transport,
    };
  });

  return {
    id: form.id,
    customerName: form.customerName.trim(),
    customerEmail: form.customerEmail.trim(),
    customerPhone: form.customerPhone.trim() || null,
    validUntil: form.validUntil,
    introNote: form.introNote.trim() || null,
    internalNotes: form.internalNotes.trim() || null,
    currency: 'EUR',
    locale: form.locale,
    depositBps: form.depositBps,
    items,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Deposit                                                                                       */
/* ------------------------------------------------------------------------------------------- */

/* The deposit ARITHMETIC lives in src/lib/quotes/deposit.ts — one definition shared by this editor,
 * the guest's quote email and the guest's quote page, because all three print a figure the card is
 * charged. Re-exported here so the editor's existing imports keep reading from one place. */
export {
  DEFAULT_DEPOSIT_BPS,
  PAY_IN_FULL_BPS,
  balanceMinorOf,
  depositMinorOf,
  depositPercentLabel,
  isPayInFull,
} from '@/lib/quotes/deposit';
// …and imported as well, because `export … from` re-exports without binding the name locally, and
// this module's own defaults (emptyQuoteForm, formFromQuote) read it.
import { DEFAULT_DEPOSIT_BPS } from '@/lib/quotes/deposit';

/** Basis points as a whole percent for the editor's % field. 1000 -> 10, 10000 -> 100. */
export function depositPercentFromBps(bps: number): number {
  return Math.round(bps / 100);
}

/**
 * A whole percent the operator typed, as basis points, clamped to the schema's 1..100% range. 20 ->
 * 2000. Integer arithmetic, so no float ever holds the deposit; a blank or non-number degrades to
 * the default rather than throwing on a keystroke — the editor field is a number input, not free
 * text, and the money-path CHECK (`between 1 and 10000`) is re-asserted at save.
 */
export function depositBpsFromPercent(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_DEPOSIT_BPS;
  const clamped = Math.min(100, Math.max(1, Math.round(percent)));
  return clamped * 100;
}

/** The quote's total in minor units, or null while a line is still half-typed. Display only —
 *  `saveQuote` recomputes the stored figure from the lines it is given. */
export function formTotalMinor(form: QuoteFormValues): number | null {
  try {
    return quoteTotalMinor(quoteInputFromForm(form).items);
  } catch {
    return null;
  }
}

/** The first refusal `quoteInputFromForm` would raise, for the line editor to show inline. */
export function formLineProblem(form: QuoteFormValues): string | null {
  try {
    quoteInputFromForm(form);
    return null;
  } catch (err) {
    return refusalMessage(err, 'One of the lines is not complete yet.');
  }
}

/* ------------------------------------------------------------------------------------------- */
/* Adding a tour                                                                                 */
/* ------------------------------------------------------------------------------------------- */

export interface TourTierPick {
  label: string;
  amountMinor: number;
  quantity: number;
}

export interface TourPick {
  activityTitle: string;
  optionName: string;
  activityOptionId: string;
  sessionOccurrenceId: string;
  /** The departure instant, as stored on `session_occurrences.starts_at`. */
  startsAt: string;
  tiers: TourTierPick[];
}

/** "Catamaran cruise — Full day · 23 Aug 2026, 09:00 · Adult", in Mauritius time like the rest of
 *  the back office. Editable afterwards: it is the guest's line, not a system label. */
export function tourLineDescription(pick: Omit<TourPick, 'tiers'>, tierLabel: string): string {
  const parts = [pick.activityTitle];
  if (pick.optionName && pick.optionName !== pick.activityTitle) {
    parts[0] = `${pick.activityTitle} — ${pick.optionName}`;
  }
  parts.push(`${fmtDate(pick.startsAt)}, ${fmtTime(pick.startsAt)}`);
  if (tierLabel) parts.push(tierLabel);
  return parts.join(' · ');
}

/**
 * One line per price tier the party actually uses, priced from the catalogue.
 *
 * A tier nobody is travelling on is skipped rather than written as a zero-quantity line:
 * `quantity int check (quantity > 0)` would refuse it, and a "0 × Infant" row on a guest's offer is
 * noise. Each line carries its tier LABEL, because `(activity_option_id, price_label)` is the key
 * the pay route re-prices against.
 */
export function tourLineDrafts(pick: TourPick): QuoteLineDraft[] {
  return pick.tiers
    .filter((tier) => tier.quantity > 0)
    .map((tier) => ({
      key: newLineKey(),
      kind: 'catalogue' as QuoteItemKind,
      description: tourLineDescription(pick, tier.label),
      priceLabel: tier.label,
      sessionOccurrenceId: pick.sessionOccurrenceId,
      activityOptionId: pick.activityOptionId,
      startsAt: pick.startsAt,
      date: '',
      time: '',
      quantityText: String(tier.quantity),
      unitText: formatMinorAsEuros(tier.amountMinor),
      catalogueUnitMinor: tier.amountMinor,
      rentalVehicleSlug: null,
      transport: null,
    }));
}

/**
 * Why this option cannot be quoted as a tour line — or null when it can.
 *
 * Each of these is a refusal api_convert_quote or the pay route would raise LATER, at the moment the
 * guest tries to pay, phrased as `quote_not_convertible` ("this quote is not ready to pay yet —
 * please message us"). Saying it here costs the operator a sentence; leaving it to the money path
 * costs a guest an offer they cannot buy.
 */
export function catalogueLineRefusal(option: {
  pricingMode: string;
  isPrivate: boolean;
  priceCount: number;
}): string | null {
  if (option.isPrivate) {
    return (
      'A private option cannot be quoted as a tour line yet: its availability pool counts trips, not ' +
      'guests, so nothing can tell whether a six-guest line means one departure or six. ' +
      'api_convert_quote refuses it outright. Quote it as a custom line instead — the guest pays the ' +
      'figure you type, but no seat is reserved.'
    );
  }
  if (option.pricingMode === 'vehicle' || option.pricingMode === 'vehicle_custom') {
    return (
      'A vehicle-priced tour cannot be quoted as a tour line yet: one booking is one vehicle, not one ' +
      'seat per guest, and api_convert_quote refuses the line rather than guess. Quote it as a custom ' +
      'line — the guest pays the figure you type, but no vehicle is reserved.'
    );
  }
  if (option.priceCount === 0) {
    return (
      'This option has no price tiers, so there is nothing for the payment path to re-price the line ' +
      'against — it refuses any catalogue line whose tier it cannot find. Add prices to the option, ' +
      'or quote it as a custom line.'
    );
  }
  return null;
}

/* ------------------------------------------------------------------------------------------- */
/* Adding a rental                                                                               */
/* ------------------------------------------------------------------------------------------- */

/** The vehicle and dates a rental line is built from. Money is MINOR units, like everything the money
 *  path touches; the daily rate becomes the line's unit price, and the security deposit is not here at
 *  all — a refundable hold is not a charge, so it can never reach the total (see {@link rentalLineDraft}). */
export interface RentalPick {
  slug: string;
  name: string;
  /** The vehicle's daily rate, in minor units — the line's unit price. */
  dailyRateMinor: number;
  /** Pick-up and return days as `yyyy-mm-dd`, read as Mauritius wall-clock like every other date here. */
  pickupDate: string;
  returnDate: string;
}

/**
 * "Nissan March · 23 Aug – 28 Aug 2026 · 5-day rental" — the sentence the guest reads on the offer.
 *
 * `quote_items` CHECKs that a non-catalogue line has a description, so this must be non-empty; it also
 * names the dates the vehicle is held for, which nothing else on a plain rental line records. Mauritius
 * time, like the rest of the back office. Editable afterwards: it is the guest's line, not a label.
 */
export function rentalLineDescription(
  name: string,
  pickupDate: string,
  returnDate: string,
  days: number,
): string {
  const from = fmtDate(`${pickupDate}T00:00:00+04:00`);
  const to = fmtDate(`${returnDate}T00:00:00+04:00`);
  const span = from === to ? from : `${from} – ${to}`;
  return `${name} · ${span} · ${days}-day rental`;
}

/**
 * A rental as one quote line, priced days × daily rate.
 *
 * `kind='rental'` is load-bearing, not cosmetic: {@link quoteInputFromForm} keeps `rentalVehicleSlug`
 * only on a rental line, and `quoteItemRows` CLEARS the slug on any other kind — so a line left 'custom'
 * would drop the vehicle it was sold as, and api_convert_quote's `on delete restrict` FK could never
 * name it again. The day count is `rentalDays` — the SAME whole-days-from-1 arithmetic the public
 * RentalWidget prices with (src/lib/services/pricing.ts), so the quoted figure equals what the guest
 * saw on /rent.
 *
 * The pick-up day goes in `date` (not `startsAt`), so the LinesPane date field stays the editable
 * source of truth exactly as it is for a custom line, and {@link quoteInputFromForm} derives `starts_at`
 * from it. The security deposit is deliberately not a parameter: a refundable hold is not a charge, and
 * a figure the helper never sees cannot leak into `quotes.total_minor` (`quote_total_mismatch`).
 */
export function rentalLineDraft(pick: RentalPick): QuoteLineDraft {
  const days = rentalDays(pick.pickupDate, pick.returnDate);
  return {
    key: newLineKey(),
    kind: 'rental',
    description: rentalLineDescription(pick.name, pick.pickupDate, pick.returnDate, days),
    priceLabel: '',
    sessionOccurrenceId: null,
    activityOptionId: null,
    startsAt: null,
    date: pick.pickupDate,
    time: '',
    quantityText: String(days),
    unitText: formatMinorAsEuros(pick.dailyRateMinor),
    catalogueUnitMinor: null,
    rentalVehicleSlug: pick.slug,
    transport: null,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Adding a transport add-on (transfer)                                                          */
/* ------------------------------------------------------------------------------------------- */

/**
 * The boarding region a transport fare is priced against — `coalesce(region, region_from_coords(lat,
 * lng))`, the SAME resolution the SQL (`transport_fare_minor`, 20260720000000) uses. A quote's
 * transfer must be priced against the region the guest would have been charged from booking the
 * activity directly, so this cannot diverge from the server: it reuses `regionFromCoords`, the one
 * port of those thresholds that the widget, the planner and the server all share.
 *
 * Null when the activity carries neither an explicit region nor coordinates — `transportFareMinor`
 * then returns 0 (no region -> no fee), and the operator types the transfer price by hand.
 */
export function activityRegion(activity: {
  region: string | null;
  lat: number | null;
  lng: number | null;
}): string | null {
  if (activity.region) return activity.region;
  if (activity.lat != null && activity.lng != null) {
    return regionFromCoords(activity.lat, activity.lng);
  }
  return null;
}

/** What a transfer line is built from. The fare is passed in ALREADY COMPUTED (by `transportFareMinor`,
 *  the authoritative mirror) rather than recomputed here — the same split as `tourLineDrafts`, which
 *  takes tier amounts it does not re-derive. Money is MINOR units, like everything the money path
 *  touches. */
export interface TransferPick {
  /** The excursion this transfer serves, as it reads on the guest's line. */
  activityTitle: string;
  /** The pickup point the fare was priced from — the guest's hotel or address. Blank before one is
   *  chosen, in which case the "from …" clause is dropped. */
  pickupLabel: string;
  /** The ROUND-TRIP fare in minor units, from `transportFareMinor`: a whole-vehicle flat price for the
   *  party, NOT per person — so the line is quantity 1 × this, exactly like the email's "Transfert
   *  aller/retour : 60 EUR". 0 when the boarding region is unknown; the line is still built so the
   *  operator can price it rather than being blocked. */
  fareMinor: number;
  /** The excursion day (`yyyy-mm-dd`) this transfer serves, so `booking_custom_items.starts_at` can
   *  place it on the operations day sheet after conversion. Optional — a dateless transfer is legal. */
  date?: string;
}

/** "Round-trip transfer · Dolphin swim at Île aux Bénitiers · from Crystals Beach Resort" — the
 *  sentence the guest reads. `quote_items` CHECKs a non-catalogue line has a description, so this must
 *  be non-empty; it names both what the transfer is for and where it collects from. Editable
 *  afterwards, like every other composed line. */
export function transferLineDescription(activityTitle: string, pickupLabel: string): string {
  const from = pickupLabel.trim();
  return from
    ? `Round-trip transfer · ${activityTitle} · from ${from}`
    : `Round-trip transfer · ${activityTitle}`;
}

/**
 * A transport add-on as one quote line, priced at the fare it was quoted for.
 *
 * It is a `kind='custom'` line, and that is load-bearing, not cosmetic: a transfer has no
 * `session_occurrence` to hold a seat against and no `activity_option_prices` tier for the pay route
 * to re-price it from, so a catalogue line would be refused by api_convert_quote. A custom line is the
 * shape that is chargeable-as-typed — the negotiated figure the operator sees is what the guest pays —
 * and `quoteItemRows` clears the occurrence/option/slug on it so nothing is left dangling. The pick-up
 * day rides in `date` (not `startsAt`), exactly like a rental line, so {@link quoteInputFromForm}
 * derives `starts_at` from it and the LinesPane date field stays the editable source of truth.
 */
export function transportLineDraft(pick: TransferPick): QuoteLineDraft {
  return {
    key: newLineKey(),
    kind: 'custom',
    description: transferLineDescription(pick.activityTitle, pick.pickupLabel),
    priceLabel: '',
    sessionOccurrenceId: null,
    activityOptionId: null,
    startsAt: null,
    date: pick.date ?? '',
    time: '',
    quantityText: '1',
    unitText: formatMinorAsEuros(pick.fareMinor),
    catalogueUnitMinor: null,
    rentalVehicleSlug: null,
    transport: null,
  };
}

/* ------------------------------------------------------------------------------------------- */
/* Preview and send                                                                              */
/* ------------------------------------------------------------------------------------------- */

/** Stands in for the quote's ref while it has none — the preview runs on an unsaved draft too. */
export const PREVIEW_REF = 'QPREVIEW';

/**
 * The token the PREVIEW renders its link with, and it is not a real one.
 *
 * The raw link token exists in exactly two places (the guest's email and the send response), and it
 * is minted by the send route, which is the only writer of `quotes.token_hash`. A preview therefore
 * cannot show the real link — but `renderQuoteEmail` refuses to render at all unless the token is
 * token-SHAPED, so a placeholder of the right shape is what buys the operator a preview instead of
 * an error. Sixty-four zeros is not a token any mint could produce.
 */
export const PREVIEW_LINK_TOKEN = '0'.repeat(64);

/**
 * What the guest would receive, built from the form on screen.
 *
 * Routed through {@link quoteInputFromForm} rather than read off the form directly, so the preview
 * is EVIDENCE and not decoration: the lines are the lines that would be stored, and the total is the
 * figure `saveQuote` would write into `quotes.total_minor` — which is what api_convert_quote copies
 * into `bookings.total_minor` and charges. renderQuoteEmail refuses to print a total its lines do
 * not support, so a preview that renders is a quote that can be emailed.
 *
 * `internalNotes` is not on {@link QuoteEmailInput} at all, and that is the design: the note that is
 * never sent cannot be leaked by a template that never receives it.
 */
export function previewEmailInput(form: QuoteFormValues): QuoteEmailInput {
  const input = quoteInputFromForm(form);
  return {
    ref: form.ref || PREVIEW_REF,
    customerName: input.customerName || 'Guest',
    currency: 'EUR',
    totalMinor: quoteTotalMinor(input.items),
    validUntil: input.validUntil,
    introNote: input.introNote,
    locale: input.locale ?? 'en',
    // The preview is EVIDENCE: it must state the same payment terms the send route will, or the
    // operator signs off on an offer whose deposit sentence they never saw.
    depositBps: form.depositBps,
    items: input.items.map((item) => ({
      // The send route makes the same substitution (`description ?? price_label`), and so does
      // api_convert_quote when it names the booking_items row — so the preview, the email and the
      // voucher cannot end up calling one line three different things.
      description: item.description?.trim() || item.priceLabel || '',
      quantity: item.quantity,
      unitAmountMinor: item.unitAmountMinor,
    })),
    linkToken: PREVIEW_LINK_TOKEN,
  };
}

/**
 * Why Send is unavailable — or null when the quote can be emailed.
 *
 * The route makes every one of these checks again (it is the only thing that can, and the only
 * writer of the token). This is the operator-facing half: a disabled button with no reason beside it
 * is indistinguishable from a broken screen.
 *
 * EVERY REFUSAL NAMES THE WAY OUT, and that is not politeness. Three of the four used to end in
 * "draft a new one for this guest", which is how re-keying an entire offer became the house habit for
 * what is usually a one-line change. A withdrawn quote is reinstated, a stale one is re-dated, and a
 * paid one is duplicated — so the sentence says which button to press instead of implying there is
 * none. (A quote that is merely SENT is not refused at all: editing it and pressing Re-send is the
 * normal path, and always was.)
 *
 * The stale-date check is the one refusal that is not about `status`. Nothing sets `status` to
 * 'expired' — a quote goes stale by its `valid_until` passing — so without it the only warning is the
 * send route's own error AFTER the operator has pressed the button, on the single most common reason
 * an old offer is being re-sent at all. `today` is injectable and compared as 'yyyy-mm-dd' with `<`,
 * exactly as `assertQuoteStillValid` and api_convert_quote compare it, so this cannot refuse a quote
 * the route would have sent.
 */
export function sendRefusal(form: QuoteFormValues, today: string = quoteTodayUtc()): string | null {
  if (!form.id) return 'Save the quote first — sending emails the stored offer, not the form.';
  if (form.convertedAt || form.status === 'accepted') {
    return (
      'This quote has been accepted, so it can no longer be sent: re-sending mints a new link and ' +
      'breaks the one the guest is paying with. Their booking is the live record now — press ' +
      'Duplicate if you need to offer this guest something else.'
    );
  }
  if (form.status === 'cancelled') {
    return (
      'This quote has been withdrawn, so its link no longer opens. Press “Reinstate as a draft” to ' +
      'work on it again — you do not have to retype it.'
    );
  }
  if (form.status === 'expired') {
    return (
      'This quote has expired, so the payment path would refuse it. Move the valid-until date ' +
      'forward, or press Duplicate to copy it into a fresh offer.'
    );
  }
  if (form.validUntil && form.validUntil.slice(0, 10) < today.slice(0, 10)) {
    return (
      `This quote was only valid until ${form.validUntil}, which has passed — the guest’s link would ` +
      `not open and the payment path would refuse it. Move the valid-until date forward on the ` +
      `guest pane and save, then send.`
    );
  }
  return null;
}

/* ------------------------------------------------------------------------------------------- */
/* Refusals                                                                                      */
/* ------------------------------------------------------------------------------------------- */

/**
 * The message an operator should read, out of whatever was thrown.
 *
 * The usual admin idiom, `err instanceof Error ? err.message : 'Action failed.'`, is not enough
 * here. src/lib/admin/quotes.ts talks to PostgREST and does `if (error) throw error` — and a
 * PostgREST error is a PLAIN OBJECT, not an Error. Under that idiom an RLS refusal, a check
 * violation and a foreign key on a deleted occurrence all reach the operator as "Action failed",
 * which is exactly the class of message that turns a fixable quote into a support ticket.
 */
export function refusalMessage(err: unknown, fallback: string): string {
  if (typeof err === 'string' && err.trim()) return err.trim();
  if (err instanceof Error && err.message.trim()) return err.message;
  if (err && typeof err === 'object') {
    const record = err as { message?: unknown; hint?: unknown; details?: unknown };
    const message = typeof record.message === 'string' ? record.message.trim() : '';
    const hint = typeof record.hint === 'string' ? record.hint.trim() : '';
    if (message) return hint ? `${message} — ${hint}` : message;
    const details = typeof record.details === 'string' ? record.details.trim() : '';
    if (details) return details;
  }
  return fallback;
}

/* ------------------------------------------------------------------------------------------- */
/* The rail                                                                                      */
/* ------------------------------------------------------------------------------------------- */

export type QuotePaneId = 'guest' | 'lines' | 'notes' | 'send';

export const QUOTE_PANES: Array<{ id: QuotePaneId; label: string }> = [
  { id: 'guest', label: 'Guest & validity' },
  { id: 'lines', label: 'Lines & prices' },
  { id: 'notes', label: 'Notes' },
  { id: 'send', label: 'Preview & send' },
];

/** Labels for `quotes.status`, in the operator's words. */
export const QUOTE_STATUS_LABEL: Record<QuoteStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  accepted: 'Accepted',
  expired: 'Expired',
  cancelled: 'Withdrawn',
};

/** Pill colours, matching the bookings screen's vocabulary (teal = good, coral = closed). */
export function quoteStatusClass(status: QuoteStatus): string {
  switch (status) {
    case 'accepted':
      return 'bg-teal/10 text-teal-dark';
    case 'sent':
      return 'bg-gold-light/20 text-ink';
    case 'cancelled':
    case 'expired':
      return 'bg-coral/10 text-coral';
    default:
      return 'bg-ink/[0.06] text-ink-muted';
  }
}
