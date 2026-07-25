import ReactDOM from 'react-dom';
import { getPeachWidgetConfig } from '@/lib/payments';

/**
 * Warms Peach's checkout.js origin BEFORE the customer needs it.
 *
 * Clicking "Pay" starts a strictly serial chain the customer waits through with nothing on screen:
 * create the booking → POST /api/v1/payments (OAuth + create-checkout: two round-trips to Peach,
 * seconds each) → a full-document navigation to /bookings/{ref}/pay → and only THEN does the browser
 * discover checkout.js — a 600 KB third-party script on a cold origin (DNS + TCP + TLS + download)
 * — before the widget can even start building its iframe.
 *
 * Rendering this on the pages that LEAD to the pay page moves that last leg off the critical path:
 * the connection is open and the script is in the HTTP cache while the customer is still filling in
 * their details. No behaviour changes if it doesn't land — it's a hint, and the pay page still loads
 * the script itself.
 *
 * Deliberately no `crossOrigin`: EmbeddedCheckout appends a plain <script> with no crossorigin
 * attribute, and a CORS-mode preload would not match it — the browser would download all 600 KB a
 * second time instead of reusing it.
 */
export function PeachWidgetPreload() {
  const widget = getPeachWidgetConfig();
  if (!widget) return null; // Peach not configured (dev/CI on the stub) — nothing to warm.

  ReactDOM.preconnect(new URL(widget.scriptUrl).origin);
  ReactDOM.preload(widget.scriptUrl, { as: 'script' });
  return null;
}
