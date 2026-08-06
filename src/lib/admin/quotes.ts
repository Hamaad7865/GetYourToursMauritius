import { lineSubtotalMinor, quoteTotalMinor, type PricedLine } from '@/lib/quotes/totals';
import { ValidationError } from '@/lib/services/errors';
import { getBrowserSupabase } from '@/lib/supabase/browser';

/* Staff-side quotes: draft, re-price, withdraw, send. Mirrors src/lib/admin/bookings.ts — the
 * authenticated admin talks to Supabase directly through the browser client and the `*_staff` RLS
 * policies (20260909000000) are the gate, so no service-role key is ever in the browser.
 *
 * Two things are NOT done here, and both for the same reason: they need a secret.
 *   * SENDING mints the public link token and emails the guest -> the staff-authenticated route
 *     (`sendQuote` below is the thin client for it).
 *   * CONVERTING mints a payable booking -> api_convert_quote, service_role only, called from the
 *     guest's pay route.
 *
 * The invariant this file owns is that `quotes.total_minor` is DERIVED. It is copied straight into
 * `bookings.total_minor` at conversion and is the figure the guest's card is charged, so a total that
 * arrived from a form is discarded and recomputed from the lines. api_convert_quote re-checks the same
 * thing from the other side (`quote_total_mismatch`, which refuses to charge on any drift) — that is
 * the backstop, not the reason to skip it here.
 *
 * A CATALOGUE LINE IS NOT PAYABLE YET, and nothing in this file stops one being drafted. `quoteItemRows`
 * validates its shape, `saveQuote` stores it and the send route will email it — but api_convert_quote
 * raises `quote_has_catalogue_lines` for any quote carrying one (migration 20260909000000), because
 * the hold path that would reserve the seat has not been written. The module's own motivating example
 * (a catamaran cruise plus a private guide) is therefore an offer the guest cannot pay: they click Pay
 * and are told to message us. Until the hold path lands, the SEND ROUTE is the place to refuse one —
 * it is the only caller holding both the quote and its lines — and that refusal must be deleted in the
 * same commit that deletes `quote_has_catalogue_lines` from the migration, not before.
 */

export type QuoteStatus = 'draft' | 'sent' | 'accepted' | 'expired' | 'cancelled';
export type QuoteItemKind = 'catalogue' | 'custom' | 'rental';

/**
 * The ONLY currency a quote may be written in, and it is a money-path constraint, not a preference.
 * `payments_ledger_currency_eur` (20260830000000) pins `payments.currency = 'EUR'`, and
 * api_create_payment inserts the payments row from `(booking_id, idempotency_key, amount_minor)`
 * without ever reading the booking's currency — so a quote saved as 'MUR' would quote and email
 * "MUR 50000" while the card is charged 500 EUR. A silent denomination mismatch, not a hard failure.
 */
export type QuoteCurrency = 'EUR';

/** `quotes.locale` is the `content_locale` enum. Anything else fails at INSERT with a raw enum error. */
export type QuoteLocale = 'en' | 'fr';

/**
 * Money stays in MINOR UNITS across this module, unlike src/lib/admin/bookings.ts which divides by
 * 100 for display. A quote's total is compared, in the database, against the sum of its lines before
 * a card is charged; a float EUR round-trip on the way through the editor is exactly how those two
 * stop agreeing. Formatting is the UI's job.
 */
export interface QuoteItem {
  id: string;
  position: number;
  kind: QuoteItemKind;
  sessionOccurrenceId: string | null;
  activityOptionId: string | null;
  priceLabel: string | null;
  description: string | null;
  startsAt: string | null;
  endsAt: string | null;
  rentalVehicleSlug: string | null;
  quantity: number;
  unitAmountMinor: number;
  subtotalMinor: number;
}

export interface QuoteRow {
  id: string;
  ref: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  status: QuoteStatus;
  currency: string;
  totalMinor: number;
  /** ISO date (yyyy-mm-dd). api_convert_quote refuses a quote whose validity has passed. */
  validUntil: string;
  introNote: string | null;
  /** Staff-only. Never rendered into the guest email or the public page. */
  internalNotes: string | null;
  sentAt: string | null;
  bookingId: string | null;
  /** Set when the guest paid. The durable conversion record — see below. */
  convertedAt: string | null;
  locale: string;
  createdAt: string;
  updatedAt: string;
}

export interface QuoteDetail extends QuoteRow {
  items: QuoteItem[];
}

/** One line as the editor holds it. `quantity` + `unitAmountMinor` make it a `PricedLine`. */
export interface QuoteItemInput extends PricedLine {
  kind: QuoteItemKind;
  sessionOccurrenceId?: string | null;
  activityOptionId?: string | null;
  priceLabel?: string | null;
  description?: string | null;
  startsAt?: string | null;
  endsAt?: string | null;
  rentalVehicleSlug?: string | null;
}

export interface QuoteInput {
  /** Absent for a new quote; present to edit an existing one. */
  id?: string | null;
  customerName: string;
  customerEmail: string;
  customerPhone?: string | null;
  validUntil: string;
  introNote?: string | null;
  internalNotes?: string | null;
  /** Narrow on purpose, so a UI author cannot widen the money path. See {@link QuoteCurrency}. */
  currency?: QuoteCurrency;
  locale?: QuoteLocale;
  /** Accepted so a form object can be passed straight in, and then DISCARDED. See `quoteRowTotal`. */
  totalMinor?: number;
  items: QuoteItemInput[];
}

/** A `quote_items` row as it is written — snake_case, minor units, `quote_id` attached at insert. */
export interface QuoteItemInsert {
  position: number;
  kind: QuoteItemKind;
  session_occurrence_id: string | null;
  activity_option_id: string | null;
  price_label: string | null;
  description: string | null;
  starts_at: string | null;
  ends_at: string | null;
  rental_vehicle_slug: string | null;
  quantity: number;
  unit_amount_minor: number;
  subtotal_minor: number;
}

/** The stored total is always derived. A total that arrived from the browser is discarded. */
export function quoteRowTotal(input: { totalMinor?: number; items: PricedLine[] }): number {
  return quoteTotalMinor(input.items);
}

/**
 * The `quote_items` rows for a set of editor lines, in the owner's order.
 *
 * Three things happen here rather than in the database:
 *
 *  - `position` is the array index. The editor, the email, the public page and (after conversion)
 *    booking_custom_items all read the lines by position; ordering by id would be ordering by
 *    gen_random_uuid(), i.e. randomly per quote.
 *  - `subtotal_minor` comes from `lineSubtotalMinor`, the same function `quoteRowTotal` sums, so the
 *    stored total and the stored lines cannot drift apart. api_convert_quote refuses to charge a
 *    quote where they have.
 *  - EVERY column that belongs to a kind the line no longer is gets CLEARED. The editor switches a
 *    line's kind in place, so a line that used to be a catalogue one still carries its occurrence and
 *    option ids, and one that used to be a rental still carries its vehicle slug. The ids would raise
 *    a raw `quote_item_shape` violation at the operator; the slug is worse, because nothing catches
 *    it — api_convert_quote copies it into booking_custom_items, whose FK is `on delete restrict`, so
 *    a paid custom line silently pins a rental vehicle it has nothing to do with and deleteRentalVehicle
 *    then reports a reference the operator cannot find.
 *
 * It throws (ValidationError) on a line that is not whole, non-negative money, and on every line
 * SHAPE `quote_item_shape` would reject: a custom/rental line with no description, and a catalogue
 * line that does not name both an occurrence and an option. Both arise the same way — the editor
 * switches a line's kind in place, so a line switched TO catalogue before a slot is picked carries
 * null ids exactly as one switched away from it carries stale ones — and both would otherwise fail
 * only at INSERT. That matters on the edit path, where the INSERT is the LAST statement: by then the
 * new total is written and the old lines are deleted, and because the lines go in as ONE multi-row
 * insert the bad line takes the good ones with it. What is left is a stored total with no itemisation
 * behind it, i.e. a quote api_convert_quote refuses to charge (`quote_total_mismatch`) against a link
 * the guest already holds. Refusing here means saveQuote has written nothing yet.
 *
 * SHAPE is the limit of it: a well-formed line naming an occurrence that has since been deleted, or
 * one belonging to a different option, is a 23503 no client-side check can pre-empt, and there the
 * delete-then-insert ordering does leave that residual behind.
 */
export function quoteItemRows(items: QuoteItemInput[]): QuoteItemInsert[] {
  return items.map((item, index) => {
    const catalogue = item.kind === 'catalogue';
    const description = item.description?.trim() || null;
    if (!catalogue && !description) {
      throw new ValidationError(`Quote line ${index + 1} needs a description.`);
    }
    if (catalogue && !(item.sessionOccurrenceId && item.activityOptionId)) {
      throw new ValidationError(`Quote line ${index + 1} needs an occurrence and an option.`);
    }
    return {
      position: index,
      kind: item.kind,
      session_occurrence_id: catalogue ? (item.sessionOccurrenceId ?? null) : null,
      activity_option_id: catalogue ? (item.activityOptionId ?? null) : null,
      price_label: item.priceLabel?.trim() || null,
      description,
      starts_at: item.startsAt || null,
      ends_at: item.endsAt || null,
      rental_vehicle_slug: item.kind === 'rental' ? (item.rentalVehicleSlug ?? null) : null,
      quantity: item.quantity,
      unit_amount_minor: item.unitAmountMinor,
      subtotal_minor: lineSubtotalMinor(item),
    };
  });
}

/**
 * The quote's public identifier: 'Q' + 12 uppercase hex, minted here because `quotes.ref` is NOT NULL
 * UNIQUE with no default (bookings.ref has one; quotes never got one, and adding it would be a
 * migration this task does not need).
 *
 * 48 bits from the CSPRNG, not a counter or a timestamp: the ref is the public page's path segment
 * (/quotes/{ref}), so a guessable one lets a stranger enumerate other people's offers. The link token
 * is what actually authorises the read — this only has to be unguessable enough not to be a menu.
 */
export function mintQuoteRef(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return `Q${[...bytes]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`;
}

/* ---------------------------------------------------------------------------------------------
 * The typed browser client does not know these tables.
 *
 * The quotes module's three tables landed in 20260909000000 and are not in the generated
 * src/lib/supabase/types.ts (regenerating that needs a live database and would sweep in every other
 * pending schema change), so `from('quotes')` does not typecheck against `Database`. Same structural
 * cast as src/lib/admin/delete-guards.ts, and kept narrow on purpose: it names exactly the builder
 * calls this file makes, so a typo in one of them is still a compile error.
 * ------------------------------------------------------------------------------------------- */

type Row = Record<string, unknown>;

interface SelectBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): SelectBuilder;
  order(column: string, opts: { ascending: boolean }): SelectBuilder;
  limit(n: number): SelectBuilder;
  maybeSingle(): PromiseLike<{ data: Row | null; error: unknown }>;
}

interface InsertBuilder extends PromiseLike<{ error: unknown }> {
  select(columns: string): { single(): PromiseLike<{ data: Row | null; error: unknown }> };
}

interface WriteBuilder extends PromiseLike<{ data: Row[] | null; error: unknown }> {
  eq(column: string, value: string): WriteBuilder;
  /** A null test. `.eq(col, null)` is not it — PostgREST needs `is` for that. */
  is(column: string, value: null): WriteBuilder;
  /** RETURNING. On an update it is how the caller learns whether the filters matched anything. */
  select(columns: string): WriteBuilder;
}

interface QuotesClient {
  from(table: 'quotes' | 'quote_items' | 'bookings'): {
    select(columns: string): SelectBuilder;
    insert(payload: Row | Row[]): InsertBuilder;
    update(payload: Row): WriteBuilder;
    delete(): WriteBuilder;
  };
}

function db(): QuotesClient {
  return getBrowserSupabase() as unknown as QuotesClient;
}

const QUOTE_COLUMNS =
  'id, ref, customer_name, customer_email, customer_phone, status, currency, total_minor, ' +
  'valid_until, intro_note, internal_notes, sent_at, booking_id, converted_at, locale, ' +
  'created_at, updated_at';

const ITEM_COLUMNS =
  'id, position, kind, session_occurrence_id, activity_option_id, price_label, description, ' +
  'starts_at, ends_at, rental_vehicle_slug, quantity, unit_amount_minor, subtotal_minor';

function text(value: unknown): string {
  if (typeof value === 'string') return value;
  // PostgREST answers in JSON, so a timestamp always arrives as an ISO string and this branch never
  // runs in the browser. A driver that speaks the wire protocol (the PGlite test harness) hands back
  // a Date, and `String(date)` would turn a sortable, comparable timestamp into "Wed Aug 06 2026 …".
  if (value instanceof Date) return value.toISOString();
  return String(value ?? '');
}

function textOrNull(value: unknown): string | null {
  return value === null || value === undefined ? null : text(value);
}

/**
 * A `date` column, always as 'yyyy-mm-dd'. PostgREST answers exactly that; a wire-protocol driver
 * answers a Date at UTC midnight, whose ISO form starts with the same ten characters. `valid_until`
 * is compared against `current_date` inside api_convert_quote, so it is a calendar day here too —
 * never a timestamp that could be read as an instant.
 */
function dateText(value: unknown): string {
  return text(value).slice(0, 10);
}

/** `bigint` columns: PostgREST hands back a JSON number, other drivers a string or a BigInt. */
function minor(value: unknown): number {
  return Number(value ?? 0);
}

function mapQuote(raw: Row): QuoteRow {
  return {
    id: text(raw.id),
    ref: text(raw.ref),
    customerName: text(raw.customer_name),
    customerEmail: text(raw.customer_email),
    customerPhone: textOrNull(raw.customer_phone),
    status: text(raw.status) as QuoteStatus,
    currency: text(raw.currency),
    totalMinor: minor(raw.total_minor),
    validUntil: dateText(raw.valid_until),
    introNote: textOrNull(raw.intro_note),
    internalNotes: textOrNull(raw.internal_notes),
    sentAt: textOrNull(raw.sent_at),
    bookingId: textOrNull(raw.booking_id),
    convertedAt: textOrNull(raw.converted_at),
    locale: text(raw.locale),
    createdAt: text(raw.created_at),
    updatedAt: text(raw.updated_at),
  };
}

function mapItem(raw: Row): QuoteItem {
  return {
    id: text(raw.id),
    position: Number(raw.position ?? 0),
    kind: text(raw.kind) as QuoteItemKind,
    sessionOccurrenceId: textOrNull(raw.session_occurrence_id),
    activityOptionId: textOrNull(raw.activity_option_id),
    priceLabel: textOrNull(raw.price_label),
    description: textOrNull(raw.description),
    startsAt: textOrNull(raw.starts_at),
    endsAt: textOrNull(raw.ends_at),
    rentalVehicleSlug: textOrNull(raw.rental_vehicle_slug),
    quantity: Number(raw.quantity ?? 0),
    unitAmountMinor: minor(raw.unit_amount_minor),
    subtotalMinor: minor(raw.subtotal_minor),
  };
}

/**
 * Update a quote ONLY while it is still unconverted, and say so when it is not.
 *
 * The `converted_at is null` test is part of the UPDATE's own WHERE clause, never a SELECT before it.
 * A read-then-write guard is two PostgREST round trips with the guest's pay route free to convert
 * between them — and what it is guarding is the money: api_convert_quote re-arms a quote whose
 * booking has died, so a total rewritten in that window is charged to a returning guest against an
 * offer they never saw. Section 4 of migration 20260909000000 names the same class of mistake ("a
 * guard resting on a column another statement can reset").
 *
 * Zero rows back means the filters did not match. The follow-up read only decides WHICH refusal to
 * report — it is never what permits the write.
 *
 * Returns true when the row was updated; throws otherwise.
 */
async function updateUnconvertedQuote(
  id: string,
  fields: Row,
  convertedMessage: string,
): Promise<true> {
  const { data, error } = await db()
    .from('quotes')
    .update(fields)
    .eq('id', id)
    .is('converted_at', null)
    .select('id');
  if (error) throw error;
  if (data && data.length > 0) return true;

  const { data: existing, error: readError } = await db()
    .from('quotes')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (readError) throw readError;
  if (!existing) throw new Error('This quote no longer exists.');
  throw new Error(convertedMessage);
}

/**
 * Re-assert the unconverted guard AFTER the lines have been rewritten, and report it loudly when it
 * no longer holds.
 *
 * `updateUnconvertedQuote` puts `converted_at is null` in the UPDATE's own WHERE clause, which closes
 * the window around THAT statement — but the two that follow it, the DELETE of the old lines and the
 * re-insert of the new ones, carry no guard at all. A conversion landing in between copies the lines
 * as they then stand into `booking_custom_items`, stamps `converted_at`, and saveQuote rewrites the
 * quote's lines regardless. `quote_total_mismatch` is no backstop for this: it only bites when the
 * TOTAL changed, so an edit that reworded a description or moved a line's `starts_at` converts
 * cleanly and then diverges — the paid booking's itemisation permanently disagreeing with the quote
 * the operator is looking at.
 *
 * It cannot be prevented from here (PostgREST has no transaction), and by the time it is detected the
 * lines are already rewritten — so silence IS the harm, and this exists to break it. The operator is
 * told which booking to reconcile, because that booking's `booking_custom_items` are what the guest
 * actually paid for.
 *
 * A READ, unlike every other guard in this file, and deliberately: nothing is written after it, so a
 * guarded UPDATE would buy no atomicity here — it would only bump `updated_at` a second time on every
 * successful edit and, worse, collapse two different outcomes into one. Zero rows back from
 * `update … eq(id) is(converted_at, null)` means "no row matched", which is equally true when the row
 * is GONE: api_erase_user_data hard-deletes an unconverted quote outright (migration 20260909000000,
 * section 4). Reporting that as a payment sends the operator to reconcile a booking nobody ever
 * minted. So this reads what is actually there and names the case, reusing `updateUnconvertedQuote`'s
 * own refusal for the deleted one.
 */
async function assertStillUnconverted(id: string): Promise<void> {
  const { data, error } = await db()
    .from('quotes')
    .select('converted_at')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('This quote no longer exists.');
  if (textOrNull(data.converted_at) === null) return;
  throw new Error(
    `The guest paid for this quote while it was being saved, so the edit landed on a quote that had ` +
      `already been converted. ${await convertedBookingHint(id)}`,
  );
}

/**
 * "Which booking?", for the message above. Best effort by design: it runs only on a path that has
 * already gone wrong, so a read that fails must not replace a message the operator can act on with a
 * PostgREST error they cannot.
 */
async function convertedBookingHint(id: string): Promise<string> {
  const fallback =
    'The booking now holds the lines as they stood when the guest paid — reconcile it on the bookings screen.';
  try {
    const { data } = await db().from('quotes').select('ref, booking_id').eq('id', id).maybeSingle();
    const bookingId = textOrNull(data?.booking_id ?? null);
    if (bookingId) {
      const { data: booking } = await db()
        .from('bookings')
        .select('ref')
        .eq('id', bookingId)
        .maybeSingle();
      const bookingRef = textOrNull(booking?.ref ?? null);
      if (bookingRef) {
        return `Booking ${bookingRef} holds the lines as they stood when the guest paid — reconcile it on the bookings screen.`;
      }
    }
    const quoteRef = textOrNull(data?.ref ?? null);
    return quoteRef
      ? `Find the booking quote ${quoteRef} minted on the bookings screen — it holds the lines as they stood when the guest paid.`
      : fallback;
  } catch {
    return fallback;
  }
}

/** The signed-in staff session, or null. Never throws: it is read for attribution and a bearer. */
async function session(): Promise<{ accessToken: string; userId: string } | null> {
  try {
    const { data } = await getBrowserSupabase().auth.getSession();
    if (!data.session) return null;
    return { accessToken: data.session.access_token, userId: data.session.user.id };
  } catch {
    return null;
  }
}

/** All quotes, newest first. Staff RLS returns every row. */
export async function loadQuotes(limit = 300): Promise<QuoteRow[]> {
  const { data, error } = await db()
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []).map(mapQuote);
}

/** One quote with its lines, in the owner's order. Null when there is no such quote. */
export async function loadQuote(id: string): Promise<QuoteDetail | null> {
  const { data, error } = await db()
    .from('quotes')
    .select(QUOTE_COLUMNS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  // A second read rather than a PostgREST embed: the lines must come back ordered by `position`,
  // and an embedded relation arrives unordered.
  const { data: items, error: itemsError } = await db()
    .from('quote_items')
    .select(ITEM_COLUMNS)
    .eq('quote_id', id)
    .order('position', { ascending: true });
  if (itemsError) throw itemsError;

  return { ...mapQuote(data), items: (items ?? []).map(mapItem) };
}

/**
 * Create or update a quote and replace its lines. Returns the quote id.
 *
 * Order of operations, and why:
 *
 *  1. The lines are BUILT first (`quoteItemRows`), so every line SHAPE the database would reject —
 *     money that is not whole, a custom line with no description, a catalogue line with no occurrence
 *     — throws before anything is written. Not every rejection: an occurrence id that is stale or
 *     belongs to another option is a 23503 only the database can see, and step 3's ordering leaves
 *     that one as a residual.
 *  2. A quote that has already been converted is refused, by `updateUnconvertedQuote`: the test is
 *     part of the UPDATE's WHERE clause, so the guest's pay route cannot slip a conversion between
 *     the guard and the write. Its lines are the itemisation behind a charge, and api_convert_quote
 *     can re-arm a quote whose booking died — so re-pricing one here would charge a returning guest a
 *     figure they never agreed to. Keyed on `converted_at`, never `booking_id`: an erasure
 *     hard-deletes an unpaid booking and the FK then nulls booking_id (migration section 4).
 *  3. The quote row is written, then — only if step 2 matched — its lines are replaced.
 *  4. On an edit, the guard is RE-ASSERTED after the lines have been rewritten
 *     (`assertStillUnconverted`). Step 2's guard belongs to its own UPDATE and cannot see a conversion
 *     that lands during step 3 — and that one is not caught by `quote_total_mismatch` either, since an
 *     edit that only reworded a description converts cleanly and diverges silently afterwards. By then
 *     the lines are already rewritten, so this does not prevent it; it makes the operator hear about
 *     it, naming the booking to reconcile.
 *
 * Step 3's two statements are not one transaction — PostgREST has no such thing, and an RPC would be
 * a migration this task does not need. It fails CLOSED: if the line replacement is lost after the
 * total is written, the two disagree and api_convert_quote refuses to charge (`quote_total_mismatch`)
 * until the operator saves again.
 *
 * `currency` and `locale` are checked here as well as typed, because a cast or a JSON body erases the
 * type. EUR is not a default with alternatives — see {@link QuoteCurrency}.
 *
 * `status` is deliberately untouched. Re-pricing a SENT quote before the guest pays is a normal
 * negotiation ("I'll take €50 off"), and the guest is charged whatever the quote says at pay time;
 * flipping it back to `draft` would instead break the link they already hold, because
 * api_convert_quote only converts a quote that is `sent` or `accepted`.
 */
export async function saveQuote(input: QuoteInput): Promise<string> {
  const customerName = input.customerName.trim();
  const customerEmail = input.customerEmail.trim();
  if (!customerName || !customerEmail) {
    throw new Error('A quote needs the guest’s name and email address.');
  }
  if (!input.validUntil) {
    throw new Error('A quote needs a valid-until date.');
  }

  // Both are typed narrowly above; these are the half that survives a cast or a JSON body, and both
  // land before ANY statement is issued. See QuoteCurrency: an unsupported currency is not refused
  // anywhere downstream — the ledger is EUR-only by constraint and api_create_payment never reads the
  // booking's currency, so 'MUR 50000' would be quoted, emailed, and then charged as 500 EUR.
  const currency: string = input.currency ?? 'EUR';
  if (currency !== 'EUR') {
    throw new ValidationError(
      `A quote can only be priced in EUR — the payment ledger is EUR-only, so a ${currency} quote would still be charged in EUR.`,
    );
  }
  const locale: string = input.locale ?? 'en';
  if (locale !== 'en' && locale !== 'fr') {
    throw new ValidationError(`A quote's locale must be 'en' or 'fr', not '${locale}'.`);
  }

  const rows = quoteItemRows(input.items);
  const fields: Row = {
    customer_name: customerName,
    customer_email: customerEmail,
    customer_phone: input.customerPhone?.trim() || null,
    valid_until: input.validUntil,
    intro_note: input.introNote?.trim() || null,
    internal_notes: input.internalNotes?.trim() || null,
    currency,
    locale,
    total_minor: quoteRowTotal(input),
    updated_at: new Date().toISOString(),
  };

  let id = input.id ?? null;
  const editing = Boolean(id);

  if (id) {
    // The line replacement is gated on this having matched: the lines are the itemisation behind the
    // stored total, and deleting them for an edit that was refused is exactly the state the guard is
    // here to prevent.
    await updateUnconvertedQuote(
      id,
      fields,
      'This quote has already been converted into a booking, so its lines and total can no longer be changed. Draft a new quote instead.',
    );

    const { error: clearError } = await db().from('quote_items').delete().eq('quote_id', id);
    if (clearError) throw clearError;
  } else {
    const staff = await session();
    const { data, error } = await db()
      .from('quotes')
      .insert({ ...fields, ref: mintQuoteRef(), created_by: staff?.userId ?? null })
      .select('id')
      .single();
    if (error) throw error;
    if (!data) throw new Error('The quote could not be created.');
    id = text(data.id);
  }

  if (rows.length > 0) {
    const { error } = await db()
      .from('quote_items')
      .insert(rows.map((row) => ({ ...row, quote_id: id })));
    if (error) throw error;
  }

  // Only on the edit path: a quote created a statement ago has no link, so nobody can have paid it.
  if (editing) await assertStillUnconverted(id);

  return id;
}

/**
 * Withdraw the offer. api_convert_quote raises `quote_cancelled` on this status, so the guest's link
 * stops being payable.
 *
 * It does NOT touch a booking the quote already minted: that is a real booking with its own money
 * trail, and cancelling or refunding it is the bookings screen's job (`setBookingStatus`,
 * `markBookingRefunded`). Which is precisely why a CONVERTED quote is refused here rather than
 * quietly flipped: the row would then read "withdrawn" beside the `booking_id` and `converted_at`
 * that say the guest took this offer and paid for it, in the admin list and in `loadQuote` — and
 * there is no un-cancel. Same guard, and same shape of guard, as saveQuote.
 */
export async function cancelQuote(id: string): Promise<void> {
  await updateUnconvertedQuote(
    id,
    { status: 'cancelled', updated_at: new Date().toISOString() },
    'This quote has already been converted into a booking, so the offer can no longer be withdrawn. Cancel or refund the booking itself on the bookings screen.',
  );
}

export interface SendQuoteResult {
  /** The public, tokenised link the guest was emailed — shown to the operator with a copy button. */
  url: string;
}

/**
 * Send the quote to the guest, through the staff-authenticated route.
 *
 * Not done in the browser, and not doable there: sending mints the public link token, stores only its
 * SHA-256 hash, and emails the guest — the token must never round-trip through a client the operator
 * could paste it out of, and the mail credentials are server-only. The route is the owner of that
 * sequence; this is the thin client for it, mirroring `loadGoogleReviewsLive` in
 * src/lib/admin/reviews.ts (bearer from the session, `{ ok, data }` envelope unwrapped).
 */
export async function sendQuote(id: string): Promise<SendQuoteResult> {
  const staff = await session();
  const res = await fetch('/api/v1/admin/quotes/send', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(staff ? { authorization: `Bearer ${staff.accessToken}` } : {}),
    },
    body: JSON.stringify({ quoteId: id }),
  });
  const body = (await res.json().catch(() => null)) as {
    ok?: boolean;
    data?: Partial<SendQuoteResult>;
    error?: { message?: string };
  } | null;
  // A 200 with no url is a failure too: reporting it would hand the operator `undefined` to copy and
  // tell them the guest has been emailed.
  if (!res.ok || !body?.ok || !body.data?.url) {
    throw new Error(body?.error?.message ?? 'Could not send the quote.');
  }
  return { url: body.data.url };
}
