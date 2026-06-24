'use client';
import { getBrowserSupabase } from '@/lib/supabase/browser';
import type { CartItem } from './useCart';
import type { PendingBooking } from '@/lib/services/bookings';

export type { PendingBooking };

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getBrowserSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { 'content-type': 'application/json', authorization: `Bearer ${token}` }
    : { 'content-type': 'application/json' };
}

export interface HoldOutcome {
  id: string;
  ok: boolean;
  holdId?: string;
  expiresAt?: string;
}

/** Create a hold per saved line. Resolves per-line so the caller can mark held vs unavailable. */
export async function createHoldsForLines(items: CartItem[]): Promise<HoldOutcome[]> {
  const headers = await authHeaders();
  return Promise.all(
    items.map(async (i) => {
      try {
        const res = await fetch('/api/v1/holds', {
          method: 'POST',
          headers,
          body: JSON.stringify({
            occurrenceId: i.occurrenceId,
            expectedSlug: i.slug,
            people: i.guests,
            idempotencyKey: i.idemKey,
          }),
        }).then((r) => r.json());
        if (res.ok && res.data?.holdId) {
          return { id: i.id, ok: true, holdId: res.data.holdId, expiresAt: res.data.expiresAt };
        }
        return { id: i.id, ok: false };
      } catch {
        return { id: i.id, ok: false };
      }
    }),
  );
}

export async function getHoldStatus(
  holdId: string,
): Promise<{ status: string; expiresAt: string | null } | null> {
  const res = await fetch(`/api/v1/holds/${holdId}`, {
    headers: await authHeaders(),
  }).then((r) => r.json());
  return res.ok ? { status: res.data.status, expiresAt: res.data.expiresAt } : null;
}

export async function releaseHoldRequest(holdId: string): Promise<void> {
  await fetch(`/api/v1/holds/${holdId}/release`, {
    method: 'POST',
    headers: await authHeaders(),
  }).catch(() => {});
}

/**
 * The signed-in user's payment_pending bookings (for the cart's "Awaiting payment" section + the badge).
 * Returns [] for an anonymous visitor (the endpoint 401s) or any transient failure — never throws, so a
 * flaky network or a logged-out cart simply shows no pending rows.
 */
export async function fetchMyPendingBookings(): Promise<PendingBooking[]> {
  try {
    const res = await fetch('/api/v1/bookings/pending', { headers: await authHeaders() }).then((r) =>
      r.json(),
    );
    return res.ok && Array.isArray(res.data) ? (res.data as PendingBooking[]) : [];
  } catch {
    return [];
  }
}
