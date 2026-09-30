import { getServerEnv } from '@/lib/config/env';
import { getNotificationProvider } from '@/lib/notifications';
import { isPhotographyCategory } from '@/lib/catalogue/photography';
import type { RenderedEmail } from '@/lib/email/photography';
import { SITE } from '@/lib/seo/site';
import { ConflictError, ForbiddenError, NotFoundError } from '@/lib/services/errors';

/* The staff-operated photography delivery emails — "request balance" (photo-balance route) and
 * "gallery complete" (gallery/complete route) — all gate on the same three things (the caller is
 * staff, the booking is a photography package, the gallery has photos) and then send one rendered
 * email inline. One shared copy of each piece, so the routes cannot drift apart. The narrow
 * client surface is the same structural-typing idiom the routes used locally, widened once. */

export type PhotoMailRow = Record<string, unknown>;

interface SelectBuilder extends PromiseLike<{ data: PhotoMailRow[] | null; error: unknown }> {
  eq(column: string, value: string): SelectBuilder;
  maybeSingle(): PromiseLike<{ data: PhotoMailRow | null; error: unknown }>;
}

interface UpdateBuilder extends PromiseLike<{ data: PhotoMailRow[] | null; error: unknown }> {
  eq(column: string, value: string): UpdateBuilder;
  select(columns: string): UpdateBuilder;
}

export interface PhotoDeliveryClient {
  from(table: 'bookings' | 'booking_items' | 'booking_photos' | 'profiles'): {
    select(columns: string): SelectBuilder;
    update(patch: Record<string, unknown>): UpdateBuilder;
  };
}

const STAFF_SENDER_ROLES = new Set(['admin', 'staff']);

const text = (v: unknown): string => (typeof v === 'string' ? v : String(v ?? ''));
const minor = (v: unknown): number => Number(v ?? 0);
const fail = (error: unknown, what: string): never => {
  throw new Error(String((error as { message?: string })?.message ?? `${what} failed`));
};

/** The staff gate every delivery email shares: the JWT role is always 'authenticated', so the
 *  business role is read from `profiles` through the service-role client. 'seo' is not admitted. */
export async function requireStaffSender(db: PhotoDeliveryClient, userId: string): Promise<void> {
  const { data: profile, error } = await db
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();
  if (error) fail(error, 'profile read');
  if (!STAFF_SENDER_ROLES.has(text(profile?.role))) throw new ForbiddenError('Staff only');
}

export interface PhotographyBookingDelivery {
  id: string;
  ref: string;
  customerName: string;
  customerEmail: string;
  currency: string;
  locale: string | null;
  /** bookings.status — only a live (confirmed / completed) booking has a gallery to deliver. */
  status: string;
  /** The live balance_due_minor — the single figure both routes decide off, never recomputed here. */
  balanceDueMinor: number;
  /** Title of the booking's photography activity — the email's "what". */
  packageTitle: string | null;
}

/** The booking plus its photography activity. 404 when the ref is unknown; 409 when the booking
 *  is not a photography package — the same refusal the send route has always made. */
export async function loadPhotographyBookingDelivery(
  db: PhotoDeliveryClient,
  ref: string,
): Promise<PhotographyBookingDelivery> {
  const { data: booking, error } = await db
    .from('bookings')
    .select('id, ref, status, customer_name, customer_email, currency, locale, balance_due_minor')
    .eq('ref', ref)
    .maybeSingle();
  if (error) fail(error, 'booking read');
  if (!booking) throw new NotFoundError('Not found');

  const { data: items, error: itemsError } = await db
    .from('booking_items')
    .select('activity_options(activities(title, category))')
    .eq('booking_id', text(booking.id));
  if (itemsError) fail(itemsError, 'booking items read');
  const activity = (items ?? [])
    .map(
      (i) =>
        (i.activity_options as { activities?: { title?: string; category?: string } } | null)
          ?.activities,
    )
    .find((a) => isPhotographyCategory(a?.category));
  if (!activity) {
    throw new ConflictError(`Booking ${ref} is not a photography booking.`);
  }

  return {
    id: text(booking.id),
    ref: text(booking.ref),
    customerName: text(booking.customer_name),
    customerEmail: text(booking.customer_email),
    currency: text(booking.currency) || 'EUR',
    locale: text(booking.locale) || null,
    status: text(booking.status),
    balanceDueMinor: minor(booking.balance_due_minor),
    packageTitle: (activity.title as string | undefined) ?? null,
  };
}

const DELIVERABLE_STATUSES = new Set(['confirmed', 'completed']);

/**
 * A gallery is only ever delivered on a LIVE booking — the same set the guest-facing gallery API and
 * the booking_photos RLS policy serve. Without this a stale admin tab (or a direct API call) could
 * email a balance link for a booking that was since cancelled or refunded, or stamp a gallery the
 * guest can never open.
 */
export function assertDeliverable(booking: PhotographyBookingDelivery): void {
  if (!DELIVERABLE_STATUSES.has(booking.status)) {
    throw new ConflictError(
      `Booking ${booking.ref} is ${booking.status}, not confirmed — there is no gallery to deliver.`,
    );
  }
}

export async function countGalleryPhotos(
  db: PhotoDeliveryClient,
  bookingId: string,
): Promise<number> {
  const { data: photos, error } = await db
    .from('booking_photos')
    .select('id')
    .eq('booking_id', bookingId);
  if (error) fail(error, 'gallery read');
  return (photos ?? []).length;
}

/**
 * Stamp the delivery moment (bookings.gallery_ready_at, 20261013000000) and return the booking's
 * balance AS IT STANDS AT THAT STAMP.
 *
 * The stamp is what makes the gallery exist for the guest at all (the booking_photos RLS policy and
 * the gallery API both key off it) and what lets the settlement trigger send the gallery email, so
 * every staff action that tells the guest their photos are ready goes through here. The balance comes
 * back from the same UPDATE ... RETURNING rather than from an earlier read, so the email the caller
 * sends is decided on a figure no older than the stamp — a payment that settled a moment before the
 * press is seen (zero balance → the caller emails the gallery link itself), and one that settles a
 * moment after is seen by the settlement trigger (which finds the stamp and emails the gallery).
 *
 * That narrows the settle-vs-press race, it does not close it: notify_balance_paid reads the booking
 * before the settlement updates (and so locks) the row, so a stamp committing in that sub-second gap
 * returns the OLD balance. The guest then gets the balance email and no automatic gallery email — but
 * the gallery itself is open (delivered + paid), and pressing the card's "Resend gallery link" sends
 * the email. Deliberately not fixed with extra locking on the payment path.
 *
 * Zero rows back means the booking vanished mid-request — a conflict, not a silent success.
 * Overwrites on every press, so the column reads "last confirmed"; only NULL-ness gates.
 */
export async function markGalleryReady(
  db: PhotoDeliveryClient,
  bookingId: string,
): Promise<{ balanceDueMinor: number }> {
  const { data, error } = await db
    .from('bookings')
    .update({ gallery_ready_at: new Date().toISOString() })
    .eq('id', bookingId)
    .select('id, balance_due_minor');
  if (error) fail(error, 'gallery completion write');
  const row = data?.[0];
  if (!row) {
    throw new ConflictError('The booking was removed before its gallery could be marked complete.');
  }
  return { balanceDueMinor: minor(row.balance_due_minor) };
}

/**
 * Which email a "gallery complete" confirmation sends. The photography deposit flow owes
 * balance_due_minor until the guest pays; a booking already settled in full (a comped shoot, a
 * manual full settlement, or the balance landing before the studio confirmed) gets the gallery
 * link directly — there is no balance page to send that guest to.
 */
export function galleryCompletionKind(balanceDueMinor: number): 'balance' | 'gallery' {
  return balanceDueMinor > 0 ? 'balance' : 'gallery';
}

/**
 * Send one rendered photography email inline, exactly like the photo-balance and gallery-send
 * routes always have: a fresh id (each press is a new email, not a retry of the last one) and the
 * monitored info@ inbox as From, so the guest can simply reply. A provider failure is NOT a thrown
 * error — the caller answers { emailed: false, url } so the operator copies the link by hand.
 */
export async function sendPhotographyEmail(input: {
  recipient: string;
  template: string;
  email: RenderedEmail;
}): Promise<boolean> {
  try {
    await getNotificationProvider().send({
      id: crypto.randomUUID(),
      channel: 'email',
      recipient: input.recipient,
      template: input.template,
      from: getServerEnv().QUOTE_FROM ?? SITE.email,
      payload: {},
      subject: input.email.subject,
      html: input.email.html,
      text: input.email.text,
    });
    return true;
  } catch {
    return false;
  }
}
