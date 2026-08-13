/**
 * The durable per-installment pay-link token.
 *
 * Unlike the deposit/balance link tokens (random 32 bytes, SHA-256 stored on the row), an installment
 * token is a DETERMINISTIC HMAC(secret, "inst:<bookingId>:<seq>"). That is what makes the AUTOMATED
 * reminder possible without the leak the balance link's in-request send avoids: the cron enqueues only
 * the bookingId + seq, and the email renderer recomputes the token at SEND time — so no raw bearer token
 * is ever written to notification_outbox. The resolver recomputes the same token at PAY time, so no
 * per-row hash is stored either. Edge-safe: Web Crypto only.
 *
 * A deterministic token never rotates, which is acceptable here because the only thing it can ever do is
 * pay money the guest already owes on their own booking, and it stops working the moment that installment
 * is covered (the resolver refuses a fully-settled one). The secret is server-only and one-way.
 */
import { getServerEnv } from '@/lib/config/env';

function linkSecret(): string {
  const env = getServerEnv();
  const s = env.PAYMENT_LINK_SECRET ?? env.SUPABASE_JWT_SECRET ?? env.SUPABASE_SERVICE_ROLE_KEY;
  if (!s) {
    throw new Error(
      'installment-token: PAYMENT_LINK_SECRET (or SUPABASE_JWT_SECRET / the service-role key) must be ' +
        'set to mint or verify installment pay-links.',
    );
  }
  return s;
}

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The signed message — the booking id + seq, so a token is scoped to exactly one installment. */
export function installmentTokenMessage(bookingId: string, seq: number): string {
  return `inst:${bookingId}:${seq}`;
}

export async function mintInstallmentToken(bookingId: string, seq: number): Promise<string> {
  return hmacHex(linkSecret(), installmentTokenMessage(bookingId, seq));
}

/** Constant-time verify. Fails closed on the wrong shape or a mismatch. */
export async function installmentTokenMatches(
  bookingId: string,
  seq: number,
  token: string,
): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const expected = await mintInstallmentToken(bookingId, seq);
  if (expected.length !== token.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) diff |= expected.charCodeAt(i) ^ token.charCodeAt(i);
  return diff === 0;
}
