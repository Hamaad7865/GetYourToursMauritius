import { z } from 'zod';

/**
 * A browser-side error report POSTed to /api/v1/client-errors. Every field is bounded so a malicious
 * or runaway client can't bloat the logs. The client reporter caps the same fields; this is the
 * authoritative server-side limit. Shared with the OpenAPI registry so the spec can't drift.
 */
export const clientErrorReportSchema = z.object({
  /** Origin of the report, e.g. 'window.error' | 'unhandledrejection' | 'react.boundary'. */
  kind: z.string().max(40),
  message: z.string().max(500),
  stack: z.string().max(4000).optional(),
  source: z.string().max(300).optional(),
  /** Next.js error-boundary digest, when reported from a boundary. */
  digest: z.string().max(100).optional(),
  url: z.string().max(500).optional(),
  ua: z.string().max(300).optional(),
});
export type ClientErrorReportInput = z.infer<typeof clientErrorReportSchema>;

/** The checkout steps the browser reports (20261029120000) — keyed 'hold:<id>' or 'visit:<random>'. */
export const CHECKOUT_STEP_EVENTS = [
  'step_1',
  'step_2_signed_out',
  'step_2_signed_in',
  'step_3',
  'auth_opened',
  'signup_email_sent',
  'auth_failed',
  'pay_clicked',
] as const;
export type CheckoutStepEvent = (typeof CHECKOUT_STEP_EVENTS)[number];

/**
 * Every funnel event the browser reports: the pay-page ones (20261017000000_checkout_funnel_events.sql,
 * keyed by Peach checkout id) and the checkout steps above. Mirrors the table's CHECK and
 * api_log_checkout_event's own list — all three change together.
 */
export const CHECKOUT_FUNNEL_EVENTS = [
  'widget_ready',
  'first_input',
  'completed',
  'cancelled',
  'expired',
  'load_failed',
  'page_hidden',
  'page_shown',
  ...CHECKOUT_STEP_EVENTS,
] as const;

/**
 * One funnel event POSTed to /api/v1/payments/funnel (usually by navigator.sendBeacon). No personal
 * data: the checkout id is a Peach checkout id, a hold id or a random visit id, and the device is
 * derived from the request's own User-Agent header by the route, never sent by the client.
 */
export const checkoutFunnelEventSchema = z.object({
  checkoutId: z.string().min(1).max(64),
  event: z.enum(CHECKOUT_FUNNEL_EVENTS),
  msSinceMount: z.number().int().min(0).max(86_400_000).optional(),
});
export type CheckoutFunnelEventInput = z.infer<typeof checkoutFunnelEventSchema>;
