/**
 * Security headers every HTML page must carry, applied by middleware.ts.
 *
 * next.config.mjs `headers()` sets these for every route, but on Cloudflare Pages (next-on-pages)
 * they never reached a page: a response that passes through middleware drops them. Routes the
 * middleware skips (API, robots.txt, sitemap, images) kept them, which hid the gap until the
 * 30 Sep 2026 technical audit found every HTML page bare. The values must match the next.config
 * rule — a test compares the two.
 *
 * The report-only CSP is deliberately not repeated here: it names no report endpoint, so on a page
 * it would only print console warnings for Google Tag Manager, which it does not allowlist.
 *
 * Dependency-free on purpose: middleware.ts is bundled for the edge.
 */
export const PAGE_SECURITY_HEADERS: ReadonlyArray<readonly [name: string, value: string]> = [
  ['X-Frame-Options', 'SAMEORIGIN'],
  ['X-Content-Type-Options', 'nosniff'],
  ['Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(self)'],
];

/** Paths that must never be cached or restored from the bfcache (see next.config.mjs). */
export const NO_STORE_PATHS: readonly string[] = ['/checkout'];
