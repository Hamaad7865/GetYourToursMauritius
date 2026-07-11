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

/**
 * Why a hold failed. A `unavailable` line is genuinely sold out (server 409 insufficient_capacity) and
 * should be marked so; `network` is any transient failure (offline, 5xx, 429, timeout, malformed body)
 * and must NOT be treated as sold out — the line is kept and the customer is asked to retry, so a flaky
 * connection can never silently drop a valid basket line.
 */
export type HoldFailReason = 'unavailable' | 'network';

export interface HoldOutcome {
  id: string;
  ok: boolean;
  holdId?: string;
  expiresAt?: string;
  reason?: HoldFailReason;
}

/** Create a hold per saved line. Resolves per-line so the caller can mark held / sold-out / retry. */
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
        });
        const body = await res.json().catch(() => null);
        if (res.ok && body?.ok && body.data?.holdId) {
          return { id: i.id, ok: true, holdId: body.data.holdId, expiresAt: body.data.expiresAt };
        }
        // Only a 409 (insufficient_capacity → ConflictError) is a genuine sold-out. Every other status —
        // 5xx, 429 rate-limit, or a malformed body — is transient and retryable, never "sold out".
        const reason: HoldFailReason = res.status === 409 ? 'unavailable' : 'network';
        return { id: i.id, ok: false, reason };
      } catch {
        // fetch rejected outright: offline / DNS / aborted — always retryable.
        return { id: i.id, ok: false, reason: 'network' };
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
