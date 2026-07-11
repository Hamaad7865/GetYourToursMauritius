import type { CartItem } from './useCart';

export const EXPIRY_WARN_MS = 5 * 60 * 1000;

export interface ReconcileResult {
  kept: CartItem[];
  expired: CartItem[];
  unavailable: CartItem[];
}

/** Partition the cart: drop held lines whose server expiry passed and any 'unavailable' lines;
 *  keep saved lines (no expiry) and still-valid held lines. */
export function dropExpiredHolds(items: CartItem[], now: number): ReconcileResult {
  const kept: CartItem[] = [];
  const expired: CartItem[] = [];
  const unavailable: CartItem[] = [];
  for (const i of items) {
    if (i.status === 'unavailable') {
      unavailable.push(i);
      continue;
    }
    if (i.status === 'held' && i.expiresAt && new Date(i.expiresAt).getTime() <= now) {
      expired.push(i);
      continue;
    }
    kept.push(i);
  }
  return { kept, expired, unavailable };
}

export function markHeld(
  items: CartItem[],
  id: string,
  h: { holdId: string; expiresAt: string },
): CartItem[] {
  return items.map((i) =>
    i.id === id ? { ...i, status: 'held' as const, holdId: h.holdId, expiresAt: h.expiresAt } : i,
  );
}

export function markUnavailable(items: CartItem[], id: string): CartItem[] {
  return items.map((i) =>
    i.id === id
      ? { ...i, status: 'unavailable' as const, holdId: undefined, expiresAt: undefined }
      : i,
  );
}

/** Held lines inside the warning window (and not yet expired). */
export function expiringSoon(items: CartItem[], now: number): CartItem[] {
  return items.filter((i) => {
    if (i.status !== 'held' || !i.expiresAt) return false;
    const ms = new Date(i.expiresAt).getTime() - now;
    return ms > 0 && ms <= EXPIRY_WARN_MS;
  });
}
