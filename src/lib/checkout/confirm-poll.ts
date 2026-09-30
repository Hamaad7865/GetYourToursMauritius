/**
 * Pure decision helpers for the post-payment confirmation flow. They drive two pieces of UI control
 * flow that would otherwise be hard to test:
 *
 *  - `EmbeddedCheckout.confirmThenReturn` — retrying `/api/v1/payments/sync` with backoff before
 *    navigating to the booking page.
 *  - `BookingConfirmation` — polling `GET /api/v1/bookings/:ref` while a just-paid booking is still
 *    `payment_pending`, so a customer isn't stranded on a cold "awaiting payment" dead-end.
 *
 * Keeping the timing/decision logic here (no timers, no fetch) makes it unit-testable and shared.
 */

/** How long the confirmation page keeps polling a `payment_pending` booking before giving up (ms). */
export const CONFIRM_POLL_MAX_MS = 90_000;

/** Delay between confirmation polls (ms). Webhook/sync usually lands within a couple of cycles. */
export const CONFIRM_POLL_INTERVAL_MS = 4_000;

/** Sync retry tuning used by the embedded checkout before it navigates away. */
export const SYNC_RETRY_ATTEMPTS = 3;
const SYNC_BASE_DELAY_MS = 1_500;
const SYNC_MAX_DELAY_MS = 6_000;

/** Booking statuses that mean the payment is settled and the success/voucher view should show. */
const CONFIRMED_STATUSES = new Set(['confirmed', 'completed']);

/** Statuses that are terminal for polling purposes — no further state change is expected from a poll. */
const TERMINAL_STATUSES = new Set(['confirmed', 'completed', 'cancelled', 'refunded']);

/** True when the booking status indicates a settled, paid booking. */
export function isConfirmedStatus(status: string): boolean {
  return CONFIRMED_STATUSES.has(status);
}

/**
 * Whether the confirmation page should issue another poll. Keep polling only while the booking is in
 * a non-terminal state (i.e. still `payment_pending`) AND we are still inside the time window. Stops
 * the instant the status flips to a terminal one (confirmed/completed/cancelled/refunded) or the
 * window elapses.
 */
export function shouldKeepPolling(input: {
  status: string;
  elapsedMs: number;
  maxMs: number;
}): boolean {
  if (TERMINAL_STATUSES.has(input.status)) return false;
  return input.elapsedMs < input.maxMs;
}

/**
 * Whether the booking page should keep polling after a LATE-PICKUP supplement was paid.
 *
 * The status poll above cannot do this job: that booking is already `confirmed`, so
 * `shouldKeepPolling` stops on its first call. What flips instead is the pickup — the address only
 * reaches the booking when the add-on payment settles, which clears `pendingPickup`. So the signal is
 * the disappearance of that object, not a status change.
 */
export function shouldKeepPollingPickup(input: {
  /** True while the booking still carries an unapplied, unpaid pickup request. */
  pendingPickup: boolean;
  elapsedMs: number;
  maxMs: number;
}): boolean {
  if (!input.pendingPickup) return false;
  return input.elapsedMs < input.maxMs;
}

/**
 * Whether the booking page's gallery should look again while it still reads locked.
 *
 * A photography balance is paid on an already-`confirmed` booking (the deposit confirmed it), so the
 * status poll above stops on its first call and never waits for the balance. What flips is the
 * gallery itself: it reads locked until the settlement lands, then opens. The guest only lands here
 * straight from a payment when the URL carries `?just_paid=1` — without it a locked gallery is just
 * a booking that still owes its balance, and there is nothing to wait for. Bounded by the same
 * window as the confirmation poll.
 */
export function shouldKeepPollingGallery(input: {
  /** The gallery still reads locked (delivered, balance owed). */
  locked: boolean;
  /** The page was reached from a completed checkout (`?just_paid=1`). */
  justPaid: boolean;
  elapsedMs: number;
  maxMs: number;
}): boolean {
  if (!input.locked || !input.justPaid) return false;
  return input.elapsedMs < input.maxMs;
}

/**
 * Backoff delay for the Nth sync retry attempt (0-based): 1.5s, 3s, 4.5s, … capped at 6s. Monotonic,
 * always positive, never unbounded — so the embedded checkout can retry the idempotent sync a few
 * times without making the customer wait too long before we navigate.
 */
export function nextDelayMs(attempt: number): number {
  const n = Number.isFinite(attempt) && attempt > 0 ? Math.floor(attempt) : 0;
  return Math.min(SYNC_BASE_DELAY_MS * (n + 1), SYNC_MAX_DELAY_MS);
}
