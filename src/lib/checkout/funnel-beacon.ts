import type { CheckoutFunnelEventInput } from '@/lib/validation/telemetry';

/**
 * Fire-and-forget report of one pay-page funnel event to /api/v1/payments/funnel. Never throws, never
 * blocks navigation, stores nothing in the browser. sendBeacon survives the page unloading (the moment
 * that matters most for "where did they leave?"); it needs a JSON Blob, because a bare string goes out
 * as text/plain and the route parses JSON. keepalive fetch is the fallback where beacons are missing.
 */
export function sendFunnelEvent(
  checkoutId: string,
  event: CheckoutFunnelEventInput['event'],
  msSinceMount?: number,
): void {
  try {
    const payload: CheckoutFunnelEventInput = {
      checkoutId,
      event,
      ...(msSinceMount != null && msSinceMount >= 0
        ? { msSinceMount: Math.min(Math.round(msSinceMount), 86_400_000) }
        : {}),
    };
    const body = JSON.stringify(payload);
    const url = '/api/v1/payments/funnel';
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      if (navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }))) return;
    }
    void fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* telemetry must never affect a payment */
  }
}
