'use client';

import { useCallback, useEffect, useState } from 'react';
import type { PricingMode } from '@/lib/validation/tours';
import { childSeatsCost } from '@/lib/services/pricing';

const KEY = 'gytm:cart';
const EVENT = 'gytm:cart';
/** Cart items are kept for 30 minutes, mirroring the GetYourGuide cart retention. */
export const CART_TTL_MS = 30 * 60 * 1000;

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
  /** ms epoch when added, for the 30-minute expiry. */
  addedAt: number;
}

/** Price for one cart line: a flat price for vehicle pricing, per group (ceil people / size) for
 *  group pricing, else per head — plus the child-seat add-on (first free, €6 each extra), added ONCE
 *  on top (it is not multiplied by the party). `unitEur` is the PER-UNIT price (per vehicle / per
 *  group / per head), never the already-multiplied total. */
export function itemTotal(i: CartItem): number {
  const childExtra = childSeatsCost(i.childSeats ?? 0);
  if (i.pricingMode === 'vehicle') return Math.round((i.unitEur + childExtra) * 100) / 100;
  const groups = i.pricingMode === 'per_group' && i.maxGuests ? Math.ceil(i.guests / i.maxGuests) : i.guests;
  return Math.round((i.unitEur * groups + childExtra) * 100) / 100;
}

/** Largest party a line can hold: bounded by seats, and by the tier cap for per-person pricing (a
 *  per-person tier's max_guests is a hard cap). Vehicle parties are fixed at add-time (changing the
 *  size changes the vehicle + price, which is done on the activity page), so they don't grow here. */
export function lineCap(i: CartItem): number {
  if (i.pricingMode === 'vehicle') return i.guests;
  const bySeats = i.seatsLeft && i.seatsLeft > 0 ? i.seatsLeft : Infinity;
  const byTier = i.pricingMode === 'per_person' && i.maxGuests ? i.maxGuests : Infinity;
  return Math.min(bySeats, byTier);
}

function read(): CartItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) ?? '[]');
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    return (parsed as CartItem[]).filter((i) => i && now - i.addedAt < CART_TTL_MS);
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
 * components (same-tab event + cross-tab storage). Items auto-expire after 30 minutes. The cart
 * is a planning basket — the real inventory hold + payment happen at checkout.
 */
export function useCart() {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    const sync = () => setItems(read());
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener('storage', sync);
    // Re-read periodically so expired items drop out of the UI on their own.
    const t = window.setInterval(sync, 15_000);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener('storage', sync);
      window.clearInterval(t);
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, 'addedAt'>) => {
    const current = read().filter((i) => i.id !== item.id);
    write([...current, { ...item, addedAt: Date.now() }]);
  }, []);

  const remove = useCallback((id: string) => {
    write(read().filter((i) => i.id !== id));
  }, []);

  const setGuests = useCallback((id: string, guests: number) => {
    write(
      read().map((i) => (i.id === id ? { ...i, guests: Math.max(1, Math.min(lineCap(i), guests)) } : i)),
    );
  }, []);

  const clear = useCallback(() => write([]), []);

  const subtotal = items.reduce((sum, i) => sum + itemTotal(i), 0);

  return { items, add, remove, setGuests, clear, count: items.length, subtotal };
}

