import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The "Try again" button on the payment-failure card, and why it may NOT be derived from `?return=`.
 *
 * That button is the affordance this repo grew after "an abandoned Peach widget made a booking
 * unpayable forever": when the Peach script fails to load, the 20s watchdog fires, or
 * `Checkout.initiate` throws, it reloads /bookings/{ref}/pay WITHOUT the `?cid`, so PayPageFallback
 * mints a fresh checkout instead of re-mounting the dead session.
 *
 * It used to build that URL as `${returnUrl}/pay`, which held only while `returnUrl` was always
 * /bookings/{ref}. `?return=` broke it: a quote guest arrives with `return=/quotes/{ref}`, so the
 * retry navigates to `/quotes/{ref}/pay` — not a route, a hard 404, on the screen where their card
 * payment just failed, for the one class of customer with no account and no /account/bookings to fall
 * back to. The two URLs are different things and must be passed separately.
 *
 * The page's default export is called directly and the returned element tree walked (no DOM, no Next
 * request context), as tests/unit/landing-faq-jsonld-parity.test.ts does. The source assertion at the
 * end covers the other half — that the component navigates to the prop it is given rather than
 * re-deriving the URL — which needs a DOM to observe otherwise; this suite runs in `node` and already
 * guards component drift this way (hydration-safety, edge-runtime).
 */

vi.mock('@/lib/i18n/server', () => ({ getT: async () => (key: string) => key }));
vi.mock('@/lib/payments', () => ({
  getPeachWidgetConfig: () => ({ scriptUrl: 'https://peach.test/checkout.js', entityId: 'E-1' }),
}));
vi.mock('@/components/gyg/GygHeader', () => ({ GygHeader: () => null }));
vi.mock('@/components/site/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/checkout/ChargeNotice', () => ({ ChargeNotice: () => null }));
vi.mock('@/components/checkout/PeachWidgetPreload', () => ({ PeachWidgetPreload: () => null }));
vi.mock('@/components/checkout/PayPageFallback', () => ({ PayPageFallback: () => null }));
vi.mock('@/components/checkout/EmbeddedCheckout', () => ({ EmbeddedCheckout: () => null }));

const { EmbeddedCheckout } = await import('@/components/checkout/EmbeddedCheckout');
const { default: PayPage } = await import('../../app/(site)/bookings/[ref]/pay/page');

const BOOKING_REF = 'BMT0123456789ABC';
const QUOTE_PATH = '/quotes/Q0A1B2C3D4E5';

type ElementLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is ElementLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}

function findAll(node: unknown, target: unknown, out: ElementLike[] = []): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, target, out);
    return out;
  }
  if (!isElement(node)) return out;
  if (node.type === target) out.push(node);
  findAll(node.props?.children, target, out);
  return out;
}

async function widgetProps(requestedReturn?: string): Promise<Record<string, unknown>> {
  const tree = await PayPage({
    params: Promise.resolve({ ref: BOOKING_REF }),
    searchParams: Promise.resolve({ cid: 'CID-1', return: requestedReturn }),
  });
  const found = findAll(tree, EmbeddedCheckout);
  expect(found).toHaveLength(1);
  return found[0]!.props;
}

describe('payment-failure retry target', () => {
  it('stays under /bookings even when the guest returns to a quote page', async () => {
    const props = await widgetProps(QUOTE_PATH);

    // "Back" honours the guest's own page …
    expect(props.returnUrl).toBe(QUOTE_PATH);
    // … but "Try again" must reach a route that exists. /quotes/{ref}/pay does not.
    expect(props.retryUrl).toBe(`/bookings/${BOOKING_REF}/pay`);
  });

  it('is the same URL for the ordinary signed-in customer', async () => {
    const props = await widgetProps();

    expect(props.returnUrl).toBe(`/bookings/${BOOKING_REF}`);
    expect(props.retryUrl).toBe(`/bookings/${BOOKING_REF}/pay`);
  });

  it('is used verbatim by the error card, never re-derived from the return URL', () => {
    const source = readFileSync(
      join(process.cwd(), 'src', 'components', 'checkout', 'EmbeddedCheckout.tsx'),
      'utf8',
    );

    expect(source).toContain('window.location.assign(retryUrl)');
    // The assumption that broke: `returnUrl` is no longer always /bookings/{ref}.
    expect(source).not.toContain('${returnUrl}/pay');
  });
});
