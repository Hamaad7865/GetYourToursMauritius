'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AltStop, PricingMode } from '@/lib/validation/tours';
import { childSeatsCost } from '@/lib/services/pricing';
import {
  dropExpiredHolds,
  markHeld as markHeldItems,
  markUnavailable as markUnavailableItems,
} from './cart-holds';
import {
  getHoldStatus,
  releaseHoldRequest,
  fetchMyPendingBookings,
  type PendingBooking,
} from './holdClient';
import { pushNotification } from '@/lib/notifications/inbox';

const KEY = 'gytm:cart';
const EVENT = 'gytm:cart';
/** Fired when the module-shared pending-bookings cache changes, so every useCart() instance in the tab
 *  (header badge + cart page) re-reads the SAME list — one fetch updates them all, mirroring how
 *  localStorage + the gytm:cart event already share the cart items. Client-only (populated from a
 *  useEffect), so SSR never touches it. */
const PENDING_EVENT = 'gytm:pending';
let pendingCache: PendingBooking[] = [];
/** @deprecated Kept for reference only — expiry is now driven by server hold expiresAt, not addedAt.
 *  Saved lines (no hold) persist indefinitely in the cart. */
export const CART_TTL_MS = 30 * 60 * 1000;

export type CartLineStatus = 'saved' | 'held' | 'unavailable';

export interface CartItem {
  /** Stable id = occurrence + price tier, so re-adding the same slot updates it. */
  id: string;
  slug: string;
  title: string;
  image: string | null;
  occurrenceId: string;
  dateLabel: string;
  lang: string;
  priceLabel: string;
  /** Number of people (total headcount across every age band). */
  guests: number;
  /** Per-person, per-group, or (vehicle / age-banded) the flat price of the whole line — in EUR. */
  unitEur: number;
  pricingMode: PricingMode;
  /** Age-band bookings: the price-tier → count map (Adult/Child/Infant). When present, `unitEur` is the
   *  whole party's flat price and the line is NOT re-multiplied by `guests`. Posted to the server as-is. */
  party?: Record<string, number>;
  /** Vehicle mode: the SUV upgrade was chosen (display only; price is already in unitEur). */
  suv?: boolean;
  /** Child seats chosen (first free, €6 each extra; the charge is already in unitEur). */
  childSeats?: number;
  maxGuests: number | null;
  /** Seats left on the occurrence when added — the ceiling the guests stepper clamps to. */
  seatsLeft: number;
  /** Display unit, e.g. "per person" / "per group up to 4" / "per vehicle". */
  unit: string;
  /** The customised route the traveller chose on the tour page (present only when it diverges from
   *  the default), so Add-to-cart carries it to checkout exactly like the Continue button does. */
  itinerary?: AltStop[];
  /** ms epoch when added. */
  addedAt: number;
  /** Saved (no hold) → held (server hold) → unavailable (sold out at checkout). */
  status: CartLineStatus;
  /** Server hold id + ISO expiry — present only when status === 'held'. */
  holdId?: string;
  expiresAt?: string;
  /** Stable idempotency anchor so re-running Checkout reuses the same hold. */
  idemKey: string;
}

/** Price for one cart line: a flat price for vehicle pricing, per group (ceil people / size) for
 *  group pricing, else per head — plus the child-seat add-on (first free, €6 each extra), added ONCE
 *  on top (it is not multiplied by the party). `unitEur` is the PER-UNIT price (per vehicle / per
 *  group / per head), never the already-multiplied total. */
export function itemTotal(i: CartItem): number {
  // Age-banded (and vehicle) lines carry the whole price in `unitEur` — a flat line, never ×guests.
  if (i.pricingMode === 'vehicle' || i.party) {
    return (
      Math.round((i.unitEur + childSeatsCost(Math.min(i.childSeats ?? 0, i.guests))) * 100) / 100
    );
  }
  // A child seat only makes sense per traveller, so the add-on can never exceed the party size —
  // important when guests are lowered on a cart line without re-touching the seat count.
  const childExtra = childSeatsCost(Math.min(i.childSeats ?? 0, i.guests));
  const groups =
    i.pricingMode === 'per_group' && i.maxGuests ? Math.ceil(i.guests / i.maxGuests) : i.guests;
  return Math.round((i.unitEur * groups + childExtra) * 100) / 100;
}

/** Largest party a line can hold: bounded by seats, and by the tier cap for per-person pricing (a
 *  per-person tier's max_guests is a hard cap). Vehicle parties are fixed at add-time (changing the
 *  size changes the vehicle + price, which is done on the activity page), so they don't grow here. */
export function lineCap(i: CartItem): number {
  // A party-map line (age bands / private trip) is fixed at add-time too — and for a PRIVATE line,
  // seatsLeft counts trips (often 1), so clamping guests by it would squash a party of 6 to 1.
  if (i.pricingMode === 'vehicle' || i.party) return i.guests;
  // seatsLeft is the remaining capacity at add-time. >0 caps the stepper there; 0 means the slot
  // filled after this line was added, so hold at the current size (never widen, never force below
  // what's already configured — `i.seatsLeft && …` previously read 0 as falsy and returned Infinity,
  // letting the stepper grow without bound on a full slot).
  const bySeats = i.seatsLeft > 0 ? i.seatsLeft : i.guests;
  const byTier = i.pricingMode === 'per_person' && i.maxGuests ? i.maxGuests : Infinity;
  return Math.min(bySeats, byTier);
}

/** The raw persisted lines, unfiltered — reconcile() partitions these so expiry/unavailable
 *  notifications can actually fire (filtering here first made those arrays permanently empty). */
function readRaw(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(parsed) ? (parsed as CartItem[]) : [];
  } catch {
    return [];
  }
}

function read(): CartItem[] {
  // Saved lines persist indefinitely; held lines expire by their server expiresAt;
  // unavailable lines are dropped from the VIEW here — reconcile() owns notifying about them.
  return dropExpiredHolds(readRaw(), Date.now()).kept;
}

function write(items: CartItem[]): void {
  window.localStorage.setItem(KEY, JSON.stringify(items));
  window.dispatchEvent(new Event(EVENT));
}

/**
 * Client-side cart of configured activity slots, persisted in localStorage and shared across
 * components (same-tab event + cross-tab storage). Saved lines (no hold) persist indefinitely;
 * held lines expire by their server `expiresAt`. The cart is a planning basket — the real
 * inventory hold + payment happen at checkout.
 */
export function useCart(opts?: { withPending?: boolean }) {
  // The header instance fetches pending bookings once (mount + focus) for the badge; the cart page opts
  // in to a 30s poll so its "Awaiting payment" list stays fresh while open.
  const withPending = opts?.withPending ?? false;
  const [items, setItems] = useState<CartItem[]>([]);
  const [pendingBookings, setPendingBookings] = useState<PendingBooking[]>(() => pendingCache);

  // Drop expired holds + unavailable lines from the store, notifying for each. Saved lines survive.
  // Pure helper does the partition; we only persist `kept` and fire the per-line notes.
  const reconcile = useCallback(() => {
    const { kept, expired, unavailable } = dropExpiredHolds(readRaw(), Date.now());
    if (expired.length === 0 && unavailable.length === 0) return;
    for (const i of expired) {
      pushNotification(
        'expired',
        `${i.title} — your held spot expired`,
        `expired:${i.holdId ?? i.id}`,
      );
    }
    for (const i of unavailable) {
      pushNotification('unavailable', `${i.title} — no longer available`, `unavail:${i.id}`);
    }
    write(kept);
  }, []);

  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    reconcile();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    // Re-read periodically and prune expired holds so they drop out of the UI on their own.
    const t = window.setInterval(() => {
      reconcile();
      sync();
    }, 15_000);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
      window.clearInterval(t);
    };
  }, [reconcile]);

  // Server reconcile on mount (held lines only): verify each remaining hold against the server and
  // drop it ONLY on a definite non-active status. A `null` (transient/auth failure) keeps the line
  // so a flaky network never discards a valid hold.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const held = read().filter(
        (i) =>
          i.status === 'held' &&
          i.holdId &&
          i.expiresAt &&
          new Date(i.expiresAt).getTime() > Date.now(),
      );
      for (const i of held) {
        const res = await getHoldStatus(i.holdId!);
        if (cancelled) return;
        if (res && res.status !== 'active') {
          pushNotification(
            'expired',
            `${i.title} — your held spot expired`,
            `expired:${i.holdId ?? i.id}`,
          );
          write(read().filter((x) => x.id !== i.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Fetch the signed-in user's payment_pending bookings, write them to the shared cache, and broadcast
  // so every other useCart() instance re-reads the same list (header badge ↔ cart page never diverge).
  const refreshPending = useCallback(async () => {
    const rows = await fetchMyPendingBookings();
    pendingCache = rows;
    window.dispatchEvent(new Event(PENDING_EVENT));
    setPendingBookings(rows);
  }, []);

  // Pending bookings (server): shown in the cart's "Awaiting payment" section and counted in the badge.
  // Refreshed on mount, on focus/visibility, on a PENDING_EVENT from a sibling instance (no re-fetch —
  // just adopt the cache), and on a gytm:cart change (catches the checkout that just turned a cart line
  // into a booking). NOT tied to the 15s localStorage tick — this hook is mounted site-wide via the
  // header, so a 15s server poll would be far too chatty.
  useEffect(() => {
    const sync = () => setPendingBookings(pendingCache);
    sync(); // adopt whatever a sibling instance already fetched
    void refreshPending();
    const onWake = () => void refreshPending();
    window.addEventListener(PENDING_EVENT, sync);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onWake);
    window.addEventListener(EVENT, onWake);
    return () => {
      window.removeEventListener(PENDING_EVENT, sync);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onWake);
      window.removeEventListener(EVENT, onWake);
    };
  }, [refreshPending]);

  // Poll every 30s WHILE there's a pending booking to watch — so the badge self-heals within 30s once it
  // confirms or expires (same-tab navigation back from the embedded Peach payment fires no focus event) —
  // or while the cart page explicitly opts in. No pending booking + not the cart page → no polling, so
  // the site-wide header instance stays quiet until a reservation actually exists.
  useEffect(() => {
    if (!withPending && pendingBookings.length === 0) return;
    const id = window.setInterval(() => void refreshPending(), 30_000);
    return () => window.clearInterval(id);
  }, [withPending, pendingBookings.length, refreshPending]);

  const add = useCallback((item: Omit<CartItem, 'addedAt' | 'status' | 'idemKey'>) => {
    const current = read().filter((i) => i.id !== item.id);
    write([
      ...current,
      { ...item, addedAt: Date.now(), status: 'saved', idemKey: crypto.randomUUID() },
    ]);
  }, []);

  // Insert (or refresh) an already-HELD line — the held twin of `add`, for the Book-now → checkout path
  // which creates the server hold BEFORE any cart line exists. Unlike `add` it KEEPS the passed idemKey
  // (it must equal the key the hold was created under, so checkout + pay reuse the one hold rather than
  // minting a second) and writes status:'held' with the hold's id + expiry. A same-id line is replaced,
  // so re-entering checkout just refreshes it (idempotent). The store's existing reconcile + 15s prune +
  // expiry bell then own its lifecycle, exactly like a proceeded cart line.
  const upsertHeld = useCallback(
    (item: Omit<CartItem, 'addedAt' | 'status'> & { holdId: string; expiresAt: string }) => {
      const current = read().filter((i) => i.id !== item.id);
      write([...current, { ...item, addedAt: Date.now(), status: 'held' }]);
    },
    [],
  );

  const remove = useCallback((id: string) => {
    write(read().filter((i) => i.id !== id));
  }, []);

  const setGuests = useCallback((id: string, guests: number) => {
    write(
      read().map((i) => {
        if (i.id !== id) return i;
        const next = Math.max(1, Math.min(lineCap(i), guests));
        // Pull child seats down with the party — a seat per traveller can't exceed the new count.
        return { ...i, guests: next, childSeats: Math.min(i.childSeats ?? 0, next) };
      }),
    );
  }, []);

  const clear = useCallback(() => write([]), []);

  // Flip a line to held (server hold created) — stamps holdId + expiresAt via the pure helper.
  const markHeld = useCallback((id: string, h: { holdId: string; expiresAt: string }) => {
    write(markHeldItems(read(), id, h));
  }, []);

  // Flip a line to unavailable (sold out at checkout); the pure helper also clears any stale hold.
  const markUnavailable = useCallback((id: string) => {
    write(markUnavailableItems(read(), id));
  }, []);

  // Remove a line; if it currently holds a server reservation, release it first (fire-and-forget so
  // the UI doesn't wait on the network), then drop the line.
  const removeHeld = useCallback((id: string) => {
    const line = read().find((i) => i.id === id);
    if (line?.status === 'held' && line.holdId) {
      void releaseHoldRequest(line.holdId);
    }
    write(read().filter((i) => i.id !== id));
  }, []);

  // Accumulate in integer cents so a basket of several lines can't drift (0.1 + 0.2 ≠ 0.3 in
  // floating point); each itemTotal is already cent-rounded, so *100 is exact.
  const subtotal =
    Math.round(items.reduce((sum, i) => sum + Math.round(itemTotal(i) * 100), 0)) / 100;

  return {
    items,
    add,
    upsertHeld,
    remove,
    removeHeld,
    setGuests,
    clear,
    markHeld,
    markUnavailable,
    reconcile,
    pendingBookings,
    pendingCount: pendingBookings.length,
    count: items.length + pendingBookings.length,
    subtotal,
  };
}
