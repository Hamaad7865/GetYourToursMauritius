import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/types';
import { SITE } from '@/lib/seo/site';
import { isLocale, type Locale } from '@/lib/i18n/config';
import { guestEmailCountKey, guestEmailKey } from '@/lib/guest/email-key';
import { guestLinkOpenPath } from '@/lib/guest/link-cookie';
import { guestLinkTokenMatches, mintGuestLinkToken } from '@/lib/guest/link-token';
import type { ServiceContext } from './context';
import { NotFoundError, RateLimitError } from './errors';

/**
 * Guest checkout: a visitor books and pays with a Supabase anonymous sign-in instead of an account.
 *
 * The anonymous user OWNS the booking, so api_book, create_payment and every `user_id = auth.uid()`
 * check run unchanged. Everything here is what that leaves over: the caps on cheap identities, moving a
 * booking between guest sessions with the signed emailed link, handing paid bookings to the account
 * that proves the mailbox, and clearing out anonymous users nobody needs.
 *
 * Written in TypeScript, not plpgsql, at the owner's request. Two consequences to keep in mind:
 *
 *   - Ownership moves are compare-and-swap (`update ... where user_id = <the owner we read>`), so a
 *     concurrent move cannot be overwritten and a real account's booking can never be taken.
 *   - The caps are read-then-book, with no database lock. Two simultaneous requests can each pass the
 *     last slot, so a cap can overrun by one. They are abuse limits, not money rules; capacity and
 *     pricing stay in api_book and create_hold.
 *
 * Spec: docs/superpowers/specs/2026-10-29-guest-checkout-design.md
 */

/** Starting values, reviewed with real traffic. Replays of the same booking are never counted. */
export const GUEST_LIMITS = {
  liveUnpaidPerIdentity: 3,
  bookingsPerIdentityPerDay: 10,
  liveUnpaidPerEmail: 3,
} as const;

const ANONYMOUS_USER_TTL_DAYS = 30;
const PURGE_PAGE_SIZE = 1000;
const PURGE_MAX_PAGES = 5;
/** Each delete is a subrequest, on a Worker that has already spent many on the maintenance chain. */
const PURGE_MAX_DELETES = 15;
const PURGE_OWNER_CHUNK = 200;
const DAY_MS = 24 * 60 * 60 * 1000;
/** A find-my-booking request can send at most one email per window: three a day per booking. */
const LOOKUP_WINDOW_MS = 8 * 60 * 60 * 1000;

/** api_erase_user's sentinel. An erased booking's owner is gone and its link must stay dead. */
const ERASED_EMAIL = 'deleted@privacy.invalid';

/** A claim moves only bookings with money on them, so nobody can plant an unpaid "Pay now". */
const CLAIMABLE_STATUSES = [
  'confirmed',
  'completed',
  'refund_pending',
  'refunded',
  'cancelled',
] as const;
const MONEY_PAYMENT_STATES = new Set(['paid', 'partially_refunded', 'refunded']);

const LIMIT_MESSAGE =
  'You already have unpaid bookings open — finish paying for one, or wait 30 minutes and try again.';

type Admin = SupabaseClient<Database>;

function adminOf(ctx: ServiceContext): Admin {
  if (!ctx.admin)
    throw new Error('guest: this needs a service-role context (ctx.admin is missing)');
  return ctx.admin;
}

/** Fails closed: an owner we cannot read is treated as a real account, which nothing here may touch. */
async function isAnonymousUser(admin: Admin, userId: string): Promise<boolean> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return false;
  return data.user.is_anonymous === true;
}

/** Best effort: a support trail for who moved a booking, never a reason to fail the move. */
async function auditOwnerChange(
  admin: Admin,
  action: 'guest_booking_adopted' | 'guest_booking_claimed',
  bookingId: string,
  actorId: string,
  previousOwner: string | null,
): Promise<void> {
  try {
    await admin.from('audit_logs').insert({
      actor_id: actorId,
      actor_role: 'customer',
      action,
      entity_type: 'booking',
      entity_id: bookingId,
      summary: `Owner changed from ${previousOwner ?? 'none'} to ${actorId}`,
    });
  } catch {
    /* the audit row is a convenience; the move has already happened */
  }
}

/** Moves one booking from the owner we read to `userId`. False when someone else moved it first. */
async function moveBookingOwner(
  admin: Admin,
  bookingId: string,
  fromOwner: string | null,
  userId: string,
): Promise<boolean> {
  const update = admin.from('bookings').update({ user_id: userId }).eq('id', bookingId);
  const guarded = fromOwner ? update.eq('user_id', fromOwner) : update.is('user_id', null);
  const { data, error } = await guarded.select('id');
  if (error) throw error;
  return (data ?? []).length === 1;
}

/**
 * The caps on an anonymous caller, checked just before api_book. See the file header for why a
 * simultaneous pair can overrun by one. A retry of the same booking is left out of every count, or a
 * guest whose response was lost could be refused their own booking.
 *
 * The per-email cap is the weakest of the three, since throwaway addresses walk around it. The IP
 * limit and Turnstile in the route are what bind.
 */
export async function assertGuestBookingAllowed(
  ctx: ServiceContext,
  input: { userId: string; email: string; idempotencyKey?: string | null },
): Promise<void> {
  const admin = adminOf(ctx);
  const since = new Date(ctx.now().getTime() - DAY_MS).toISOString();
  const isRetry = (key: string | null) => Boolean(key) && key === input.idempotencyKey;

  const mine = await admin
    .from('bookings')
    .select('status, idempotency_key')
    .eq('user_id', input.userId)
    .gte('created_at', since);
  if (mine.error) throw mine.error;
  const others = (mine.data ?? []).filter((b) => !isRetry(b.idempotency_key));
  const unpaid = others.filter((b) => b.status === 'payment_pending');
  if (
    others.length >= GUEST_LIMITS.bookingsPerIdentityPerDay ||
    unpaid.length >= GUEST_LIMITS.liveUnpaidPerIdentity
  ) {
    throw new RateLimitError(LIMIT_MESSAGE);
  }

  const emailKey = guestEmailCountKey(input.email);
  const live = await admin
    .from('bookings')
    .select('customer_email, idempotency_key')
    .eq('source', 'web')
    .eq('status', 'payment_pending')
    .gte('created_at', since);
  if (live.error) throw live.error;
  const sameEmail = (live.data ?? []).filter(
    (b) => guestEmailCountKey(b.customer_email) === emailKey && !isRetry(b.idempotency_key),
  );
  if (sameEmail.length >= GUEST_LIMITS.liveUnpaidPerEmail) throw new RateLimitError(LIMIT_MESSAGE);
}

export interface GuestLinkTarget {
  bookingId: string;
  ref: string;
  /** The version signed into this booking's link. No `booking_guest_links` row means 1. */
  version: number;
  ownerId: string | null;
  customerEmail: string;
  customerName: string;
  locale: Locale;
}

/**
 * The booking behind a ref, when it is GUEST-OWNED: a web booking, not erased, with no owner or an
 * anonymous one. Null for everything else, including an unknown ref, so a caller has one branch and
 * cannot tell the cases apart.
 */
export async function guestLinkTarget(
  ctx: ServiceContext,
  ref: string,
): Promise<GuestLinkTarget | null> {
  const admin = adminOf(ctx);
  const { data: booking, error } = await admin
    .from('bookings')
    .select('id, ref, user_id, source, customer_email, customer_name, locale')
    .eq('ref', ref)
    .maybeSingle();
  if (error) throw error;
  if (!booking || booking.source !== 'web' || booking.customer_email === ERASED_EMAIL) return null;
  if (booking.user_id && !(await isAnonymousUser(admin, booking.user_id))) return null;

  const link = await admin
    .from('booking_guest_links')
    .select('version')
    .eq('booking_id', booking.id)
    .maybeSingle();
  if (link.error) throw link.error;

  return {
    bookingId: booking.id,
    ref: booking.ref,
    version: link.data?.version ?? 1,
    ownerId: booking.user_id,
    customerEmail: booking.customer_email,
    customerName: booking.customer_name,
    locale: isLocale(booking.locale) ? booking.locale : 'en',
  };
}

/**
 * The manage link for a guest booking's emails, or null when it is not guest-owned and the plain
 * /bookings/{ref} is right. Never throws and never blocks a send: a confirmation with a plain link is
 * still a confirmation, and /bookings/find can always send a fresh link.
 */
export async function guestBookingUrl(ctx: ServiceContext, ref: string): Promise<string | null> {
  if (!ctx.admin) return null;
  try {
    const target = await guestLinkTarget(ctx, ref);
    if (!target) return null;
    const token = await mintGuestLinkToken(target.bookingId, target.version);
    return `${SITE.url}${guestLinkOpenPath(target.ref, token, target.locale)}`;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown';
    console.error(`guest link lookup failed: ref=${ref} reason=${reason}`);
    return null;
  }
}

/**
 * Move a guest booking into the caller's guest session, on proof of the emailed link. "Latest device
 * wins": the previous session loses it and can take it back with the same link.
 *
 * Only ever between guest identities. The route refuses a real account, and a booking owned by one is
 * not a target, so a forwarded email cannot put a booking in a stranger's account or take one out of
 * anybody's. False for every refusal; the route answers all of them with one 404.
 */
export async function adoptGuestBooking(
  ctx: ServiceContext,
  input: { ref: string; userId: string; token: string },
): Promise<boolean> {
  const target = await guestLinkTarget(ctx, input.ref);
  if (!target) return false;
  if (!(await guestLinkTokenMatches(target.bookingId, target.version, input.token))) return false;
  if (target.ownerId === input.userId) return true;

  const admin = adminOf(ctx);
  const moved = await moveBookingOwner(admin, target.bookingId, target.ownerId, input.userId);
  if (moved) {
    await auditOwnerChange(
      admin,
      'guest_booking_adopted',
      target.bookingId,
      input.userId,
      target.ownerId,
    );
  }
  return moved;
}

/**
 * Hand a signed-in account the paid guest bookings made with its address. The same rule as quotes,
 * asked in the same place: quote_owner_for_email answers only for a CONFIRMED address with EXACTLY ONE
 * account. That proof of the mailbox is the whole of the authorization, so nothing about the address
 * comes from the caller.
 *
 * Bookings with no money on them are left alone. Otherwise typing a stranger's email at checkout would
 * plant an unpaid "Pay now" in their account. A paid one costs the price of the booking, and the address
 * owner has already had its confirmation email. Idempotent, so it runs on every sign-in.
 */
export async function claimGuestBookings(ctx: ServiceContext, userId: string): Promise<number> {
  const admin = adminOf(ctx);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data.user) return 0;
  const account = data.user;
  if (account.is_anonymous || !account.email_confirmed_at) return 0;
  const emailKey = guestEmailKey(account.email);
  if (!emailKey) return 0;

  const owner = await admin.rpc('quote_owner_for_email', { p_email: emailKey });
  if (owner.error) throw owner.error;
  if (owner.data !== userId) return 0;

  const { data: rows, error: readError } = await admin
    .from('bookings')
    .select('id, user_id, status, payment_state, customer_email')
    .eq('source', 'web')
    .in('status', [...CLAIMABLE_STATUSES])
    // `ilike` only narrows the read. `_` and `%` are wildcards there, so the exact compare below decides.
    .ilike('customer_email', emailKey);
  if (readError) throw readError;

  let claimed = 0;
  for (const row of rows ?? []) {
    if (guestEmailKey(row.customer_email) !== emailKey || row.user_id === userId) continue;
    if (row.status === 'cancelled' && !MONEY_PAYMENT_STATES.has(row.payment_state)) continue;
    if (row.user_id && !(await isAnonymousUser(admin, row.user_id))) continue;
    if (await moveBookingOwner(admin, row.id, row.user_id, userId)) {
      claimed += 1;
      await auditOwnerChange(admin, 'guest_booking_claimed', row.id, userId, row.user_id);
    }
  }
  return claimed;
}

/**
 * "Find my booking": email a fresh manage link to the address ALREADY ON the booking, when the typed
 * one matches. The ref is not a credential and an email address is not a secret, so this can only ever
 * send mail to the right mailbox; it shows nothing, and the route answers the same whatever happened.
 */
export async function requestGuestLink(
  ctx: ServiceContext,
  input: { ref: string; email: string },
): Promise<void> {
  const target = await guestLinkTarget(ctx, input.ref);
  if (!target) return;
  const typed = guestEmailKey(input.email);
  if (!typed || guestEmailKey(target.customerEmail) !== typed) return;

  const window = Math.floor(ctx.now().getTime() / LOOKUP_WINDOW_MS);
  const { error } = await adminOf(ctx)
    .from('notification_outbox')
    .insert({
      channel: 'email',
      recipient: target.customerEmail,
      template: 'guest_booking_link',
      payload: { ref: target.ref, customerName: target.customerName, locale: target.locale },
      booking_id: target.bookingId,
      idempotency_key: `guest_link:${target.bookingId}:${window}`,
    });
  // A repeat inside the window hits the unique key. That is the limit working, not a failure.
  if (error && (error as { code?: string }).code !== '23505') throw error;
}

/** Staff revocation: bump the version, and every link sent so far stops working. */
export async function resetGuestLink(
  ctx: ServiceContext,
  input: { ref: string; staffId: string },
): Promise<number> {
  const admin = adminOf(ctx);
  const booking = await admin.from('bookings').select('id').eq('ref', input.ref).maybeSingle();
  if (booking.error) throw booking.error;
  if (!booking.data) throw new NotFoundError('Booking not found');
  const bookingId = booking.data.id;

  const current = await admin
    .from('booking_guest_links')
    .select('version')
    .eq('booking_id', bookingId)
    .maybeSingle();
  if (current.error) throw current.error;

  const stamp = { reset_at: ctx.now().toISOString(), reset_by: input.staffId };
  if (current.data) {
    const version = current.data.version + 1;
    const { error } = await admin
      .from('booking_guest_links')
      .update({ version, ...stamp })
      .eq('booking_id', bookingId);
    if (error) throw error;
    return version;
  }
  const { error } = await admin
    .from('booking_guest_links')
    .insert({ booking_id: bookingId, version: 2, ...stamp });
  if (error) throw error;
  return 2;
}

/**
 * Delete anonymous users older than 30 days that own no booking. Most guest sessions never finish
 * paying, and Supabase keeps those users for ever. Anyone who owns a booking stays, however old.
 *
 * GoTrue has no filter for this, so it walks the user list. Each run deletes a small batch, because
 * every call is a Worker subrequest; the caller runs it hourly, which comfortably outpaces new guests.
 */
export async function purgeAnonymousUsers(ctx: ServiceContext): Promise<{ deleted: number }> {
  const admin = adminOf(ctx);
  const cutoff = ctx.now().getTime() - ANONYMOUS_USER_TTL_DAYS * DAY_MS;

  const stale: string[] = [];
  for (let page = 1; page <= PURGE_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PURGE_PAGE_SIZE });
    if (error) throw error;
    for (const user of data.users) {
      if (user.is_anonymous === true && Date.parse(user.created_at) < cutoff) stale.push(user.id);
    }
    if (data.users.length < PURGE_PAGE_SIZE) break;
  }

  // Everyone in `stale` is checked, so old guests who own bookings cannot crowd out those who don't.
  const owners = new Set<string>();
  for (let i = 0; i < stale.length; i += PURGE_OWNER_CHUNK) {
    const { data, error } = await admin
      .from('bookings')
      .select('user_id')
      .in('user_id', stale.slice(i, i + PURGE_OWNER_CHUNK));
    if (error) throw error;
    for (const row of data ?? []) if (row.user_id) owners.add(row.user_id);
  }

  let deleted = 0;
  for (const userId of stale.filter((id) => !owners.has(id)).slice(0, PURGE_MAX_DELETES)) {
    const removal = await admin.auth.admin.deleteUser(userId);
    if (removal.error) throw removal.error;
    deleted += 1;
  }
  return { deleted };
}
