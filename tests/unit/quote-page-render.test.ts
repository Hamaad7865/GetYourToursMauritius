import { describe, expect, it, vi } from 'vitest';
import type { PublicQuote } from '@/lib/quotes/resolve';

/**
 * What the PUBLIC quote page RENDERS — as opposed to what it reads, which is
 * tests/integration/quote-page.test.ts against the real schema.
 *
 * Two things a guest can do on this page that the read layer cannot see:
 *
 *  1. CLICK THE LANGUAGE BUTTON. GygHeader's PrefsButton calls `PreferencesProvider.setLanguage`,
 *     which does `router.push(localePath('fr', pathname))` — and `localePath` has no allow-list, so
 *     every path gets the prefix, this one included. The link-token cookie is scoped
 *     `Path=/quotes/{ref}` (RFC 6265 §5.3 path-matching), so it is NOT sent to `/fr/quotes/{ref}`;
 *     middleware rewrites that back to `/quotes/{ref}`, the cookie read comes back empty and the page
 *     404s. One click, and the guest's live quote is gone with no in-page way back — the emailed link
 *     is the only recovery, and the page never says so. The cookie mock below models that scoping
 *     faithfully (no cookie on a locale-prefixed request), because a mock that always hands the token
 *     over would make this test pass against the broken page.
 *
 *  2. COME BACK FROM THE CARD FORM. EmbeddedCheckout cannot reach /api/v1/payments/sync without a
 *     bearer token and a quote guest has none, so `confirmed` is always false and it always navigates
 *     to `?just_paid=1`. A page that ignores that flag renders "If your payment did not go through,
 *     you can still complete it below" seconds after a successful charge, above a "Complete payment"
 *     button — a failure notice at the one moment the guest most needs reassurance.
 *
 * The page's default export is called directly and the returned React element tree is walked, the same
 * way tests/unit/landing-faq-jsonld-parity.test.ts does it: no DOM, no Next request context, and the
 * real page module rather than a mock of it.
 */

const state = vi.hoisted(() => ({
  /** The locale the middleware resolved from the URL — 'en' for `/quotes/{ref}`, 'fr' for `/fr/…`. */
  urlLocale: 'en' as 'en' | 'fr',
  quote: null as PublicQuote | null,
  redirected: [] as string[],
  notFound: 0,
}));

vi.mock('next/headers', () => ({
  headers: async () =>
    new Headers(state.urlLocale === 'en' ? {} : { 'x-gytm-locale': state.urlLocale }),
  cookies: async () => ({
    // THE POINT OF TEST 1: a `Path=/quotes/{ref}` cookie is not sent to `/fr/quotes/{ref}`. The
    // middleware rewrite hides that from the page — it only ever sees the bare path — so the token
    // simply is not there.
    get: (name: string) =>
      name === 'bmt_quote_token' && state.urlLocale === 'en'
        ? { value: 'a'.repeat(64) }
        : undefined,
  }),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => {
    state.redirected.push(url);
    throw new Error('NEXT_REDIRECT');
  },
  notFound: () => {
    state.notFound += 1;
    throw new Error('NEXT_NOT_FOUND');
  },
}));

vi.mock('@/lib/quotes/resolve', () => ({
  resolveQuoteForToken: async (_ref: string, token: string) =>
    token.length === 64 ? state.quote : null,
}));

vi.mock('@/components/gyg/GygHeader', () => ({ GygHeader: () => null }));
vi.mock('@/components/site/SiteFooter', () => ({ SiteFooter: () => null }));
vi.mock('@/components/quotes/QuotePayButton', () => ({ QuotePayButton: () => null }));

const { QuotePayButton } = await import('@/components/quotes/QuotePayButton');
const { default: QuotePage } = await import('../../app/(site)/quotes/[ref]/page');

const REF = 'Q0A1B2C3D4E5';

function quoteFixture(converted: boolean): PublicQuote {
  return {
    ref: REF,
    customerName: 'Marie Dupont',
    currency: 'EUR',
    totalMinor: 23000,
    validUntil: '2026-08-19',
    introNote: 'As discussed on the phone.',
    convertedAt: converted ? '2026-08-06T09:00:00.000Z' : null,
    items: [
      {
        position: 0,
        description: 'Catamaran cruise, 23 Aug',
        priceLabel: null,
        startsAt: null,
        endsAt: null,
        quantity: 2,
        unitAmountMinor: 5500,
        subtotalMinor: 11000,
      },
      {
        position: 1,
        description: 'Private guide, full day',
        priceLabel: null,
        startsAt: null,
        endsAt: null,
        quantity: 1,
        unitAmountMinor: 12000,
        subtotalMinor: 12000,
      },
    ],
  };
}

type ElementLike = { type: unknown; props: Record<string, unknown> };

function isElement(node: unknown): node is ElementLike {
  return !!node && typeof node === 'object' && 'type' in node && 'props' in node;
}

/** Every element in the tree whose `type` is `target`. Nothing is rendered — JSX children are already
 *  constructed data, so this reads the exact props a component was handed. */
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

/** All literal text in the tree, concatenated — what the guest reads. */
function textOf(node: unknown): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(' ');
  if (!isElement(node)) return '';
  return textOf(node.props?.children);
}

interface RenderResult {
  text: string;
  payButtons: ElementLike[];
  redirected: string[];
  notFound: number;
}

async function render(
  options: {
    locale?: 'en' | 'fr';
    converted?: boolean;
    searchParams?: { t?: string | string[]; just_paid?: string | string[] };
  } = {},
): Promise<RenderResult> {
  state.urlLocale = options.locale ?? 'en';
  state.quote = quoteFixture(options.converted ?? false);
  state.redirected = [];
  state.notFound = 0;

  let tree: unknown = null;
  try {
    tree = await QuotePage({
      params: Promise.resolve({ ref: REF }),
      searchParams: Promise.resolve(options.searchParams ?? {}),
    });
  } catch (error) {
    // redirect()/notFound() throw by design; the counters above record which one ran.
    if (!/NEXT_(REDIRECT|NOT_FOUND)/.test((error as Error).message)) throw error;
  }
  return {
    text: textOf(tree),
    payButtons: findAll(tree, QuotePayButton),
    redirected: state.redirected,
    notFound: state.notFound,
  };
}

describe('public quote page rendering', () => {
  it('renders the offer on the canonical English URL', async () => {
    const { text, payButtons, notFound } = await render();

    expect(notFound).toBe(0);
    expect(text).toContain('Marie Dupont');
    expect(text).toContain('Catamaran cruise, 23 Aug');
    expect(payButtons).toHaveLength(1);
  });

  it('sends a locale-prefixed request back to the canonical path instead of 404ing', async () => {
    // /fr/quotes/{ref} — one click on the header's language button. The cookie is not sent there, so
    // without this the page cannot resolve the quote at all.
    const { redirected, notFound } = await render({ locale: 'fr' });

    expect(notFound, 'the language button 404s the guest’s live quote').toBe(0);
    // The redirected request is under /quotes/{ref}, so the cookie IS sent and the page resolves.
    expect(redirected).toEqual([`/quotes/${REF}`]);
  });

  it('does not strip a ?t= link on a locale-prefixed URL — the token redirect wins', async () => {
    // Order matters: redirecting to the bare page FIRST would drop the token and hand the guest a 404.
    const { redirected } = await render({ locale: 'fr', searchParams: { t: 'b'.repeat(64) } });

    expect(redirected).toEqual([`/api/v1/quotes/${REF}/open?t=${'b'.repeat(64)}`]);
  });

  it('greets a guest who has just paid instead of warning them the payment may have failed', async () => {
    const { text, payButtons } = await render({
      converted: true,
      searchParams: { just_paid: '1' },
    });

    expect(text).not.toMatch(/did not go through/i);
    expect(text).toMatch(/payment/i);
    expect(text, 'the guest is not told their confirmation is coming').toMatch(/confirm/i);
    // A "Complete payment" CTA seconds after a successful charge reads as a failure notice.
    expect(payButtons, 'the pay button is still offered after a completed payment').toHaveLength(0);
  });

  it('keeps the recovery route for a converted quote reopened later, with no just_paid flag', async () => {
    // The link gets forwarded and reopened; api_convert_quote's re-arm branch is a real recovery for a
    // booking that died unpaid, so this state must keep both the note and the (secondary) button.
    const { text, payButtons } = await render({ converted: true });

    expect(text).toMatch(/did not go through/i);
    expect(payButtons).toHaveLength(1);
    expect(payButtons[0]!.props.converted).toBe(true);
  });
});
