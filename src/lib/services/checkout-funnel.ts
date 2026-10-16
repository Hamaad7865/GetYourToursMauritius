import type { ServiceContext } from './context';
import { callRpc } from './rpc';
import type { CheckoutFunnelEventInput } from '@/lib/validation/telemetry';
import type { DeviceClass } from '@/lib/checkout/device-class';

/**
 * Records one pay-page funnel event (see 20261017000000). Diagnostic only — it never touches a
 * booking or a payment — so the caller treats a failure as non-fatal.
 */
export async function logCheckoutEvent(
  ctx: ServiceContext,
  input: CheckoutFunnelEventInput,
  device: DeviceClass,
): Promise<void> {
  await callRpc(ctx, 'api_log_checkout_event', {
    checkoutId: input.checkoutId,
    event: input.event,
    msSinceMount: input.msSinceMount,
    device: device.device,
    browser: device.browser,
    inApp: device.inApp,
  });
}
