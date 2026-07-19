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
        // Only the DEDICATED `sold_out` code (insufficient_capacity) marks a line unavailable. Every
        // other failure — 5xx, 429, a generic `conflict` 409 (idempotency dup-key race or an expired
        // hold), or a malformed body — is transient and retryable, so the line is kept for a retry.
        const code = (body?.error?.code as string | undefined) ?? '';
        const reason: HoldFailReason = code === 'sold_out' ? 'unavailable' : 'network';
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

/**
 * The outcome of a release attempt, and — when it failed — whether retrying could ever help.
 *
 * `permanent` is the important bit for the retry queue (review item 5): a 4xx means this caller will
 * NEVER release this hold, however many times it asks — 401 on a guest hold (no owner, so the
 * auth-gated route can't free it), 403 not-owner, 404 gone, 409 already attached to a booking. Those
 * are dropped from the queue immediately instead of being retried every tick until the hold's TTL
 * lapses. A transient failure (offline, 5xx, timeout) stays queued and is retried.
 */
export type ReleaseOutcome = { ok: true } | { ok: false; permanent: boolean; status?: number };

/**
 * Release a held spot. The original was fire-and-forget (`.catch(() => {})`) and never checked
 * `res.ok`, so any failure silently left the seat reserved for the full 30-minute hold TTL (a
 * temporary double-reserve). It now reports the outcome — including WHY it failed — and retries once
 * in-line on a transient failure; the caller's queue owns any further retries. Never throws, so a
 * caller can still fire it without awaiting.
 */
export async function releaseHoldRequest(holdId: string): Promise<ReleaseOutcome> {
  let lastStatus: number | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const res = await fetch(`/api/v1/holds/${holdId}/release`, {
        method: 'POST',
        headers: await authHeaders(),
      });
      if (res.ok) return { ok: true };
      lastStatus = res.status;
      if (res.status >= 400 && res.status < 500) {
        // A permanent rejection (401 guest, 403 not-owner, 404 gone, 409 attached) — retrying won't
        // help. That seat is reclaimed by the hold-expiry + maintenance sweep instead.
        console.warn(`releaseHoldRequest: ${holdId} not released (${res.status})`);
        return { ok: false, permanent: true, status: res.status };
      }
      // 5xx → fall through and retry once.
    } catch {
      // Network error → retry once.
      lastStatus = undefined;
    }
  }
  console.warn(`releaseHoldRequest: ${holdId} release failed after retry`);
  return { ok: false, permanent: false, status: lastStatus };
}

/**
 * The signed-in user's payment_pending bookings (for the cart's "Awaiting payment" section + the badge).
 * Returns [] for an anonymous visitor (the endpoint 401s) or any transient failure — never throws, so a
 * flaky network or a logged-out cart simply shows no pending rows.
 */
export async function fetchMyPendingBookings(): Promise<PendingBooking[]> {
  try {
    const res = await fetch('/api/v1/bookings/pending', { headers: await authHeaders() }).then(
      (r) => r.json(),
    );
    return res.ok && Array.isArray(res.data) ? (res.data as PendingBooking[]) : [];
  } catch {
    return [];
  }
}
