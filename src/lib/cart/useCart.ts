'use client';

import { useCallback, useEffect, useState } from 'react';
import type { AltStop, PricingMode } from '@/lib/validation/tours';
import { childSeatsCost } from '@/lib/services/pricing';
import {
  dropExpiredHolds,
  markHeld as markHeldItems,
  markUnavailable as markUnavailableItems,
} from './cart-holds';
import { getHoldStatus, releaseHoldRequest } from './holdClient';
import { pushNotification } from '@/lib/notifications/inbox';

const KEY = 'gytm:cart';
const EVENT = 'gytm:cart';
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
  /** Number of people. */
  guests: number;
  /** Per-person, per-group, or (vehicle) the flat price of the chosen vehicle — in EUR. */
  unitEur: number;
  pricingMode: PricingMode;
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
  if (i.pricingMode === 'vehicle') {
    return Math.round((i.unitEur + childSeatsCost(i.childSeats ?? 0)) * 100) / 100;
  }
  // A child seat only makes sense per traveller, so the add-on can never exceed the party size —
  // important when guests are lowered on a cart line without re-touching the seat count.
  const childExtra = childSeatsCost(Math.min(i.childSeats ?? 0, i.guests));
  const groups = i.pricingMode === 'per_group' && i.maxGuests ? Math.ceil(i.guests / i.maxGuests) : i.guests;
  return Math.round((i.unitEur * groups + childExtra) * 100) / 100;
}

/** Largest party a line can hold: bounded by seats, and by the tier cap for per-person pricing (a
 *  per-person tier's max_guests is a hard cap). Vehicle parties are fixed at add-time (changing the
 *  size changes the vehicle + price, which is done on the activity page), so they don't grow here. */
export function lineCap(i: CartItem): number {
  if (i.pricingMode === 'vehicle') return i.guests;
  // seatsLeft is the remaining capacity at add-time. >0 caps the stepper there; 0 means the slot
  // filled after this line was added, so hold at the current size (never widen, never force below
  // what's already configured — `i.seatsLeft && …` previously read 0 as falsy and returned Infinity,
  // letting the stepper grow without bound on a full slot).
  const bySeats = i.seatsLeft > 0 ? i.seatsLeft : i.guests;
  const byTier = i.pricingMode === 'per_person' && i.maxGuests ? i.maxGuests : Infinity;
  return Math.min(bySeats, byTier);
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    // Saved lines persist indefinitely; held lines expire by their server expiresAt;
    // unavailable lines are silently dropped on read.
    return dropExpiredHolds(parsed as CartItem[], Date.now()).kept;
  } catch {
    return [];
  }
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
export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  // Drop expired holds + unavailable lines from the store, notifying for each. Saved lines survive.
  // Pure helper does the partition; we only persist `kept` and fire the per-line notes.
  const reconcile = useCallback(() => {
    const { kept, expired, unavailable } = dropExpiredHolds(read(), Date.now());
    if (expired.length === 0 && unavailable.length === 0) return;
    for (const i of expired) {
      pushNotification('expired', `${i.title} — your held spot expired`, `expired:${i.holdId ?? i.id}`);
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
        (i) => i.status === 'held' && i.holdId && i.expiresAt && new Date(i.expiresAt).getTime() > Date.now(),
      );
      for (const i of held) {
        const res = await getHoldStatus(i.holdId!);
        if (cancelled) return;
        if (res && res.status !== 'active') {
          pushNotification('expired', `${i.title} — your held spot expired`, `expired:${i.holdId ?? i.id}`);
          write(read().filter((x) => x.id !== i.id));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, 'addedAt' | 'status' | 'idemKey'>) => {
    const current = read().filter((i) => i.id !== item.id);
    write([...current, { ...item, addedAt: Date.now(), status: 'saved', idemKey: crypto.randomUUID() }]);
  }, []);

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
  const subtotal = Math.round(items.reduce((sum, i) => sum + Math.round(itemTotal(i) * 100), 0)) / 100;

  return {
    items,
    add,
    remove,
    removeHeld,
    setGuests,
    clear,
    markHeld,
    markUnavailable,
    reconcile,
    count: items.length,
    subtotal,
  };
}

