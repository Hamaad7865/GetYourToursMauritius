import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';
import { CANONICAL_HOST, KEEP_HOST, PREVIEW_HOST } from './config/canonical-host.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  eslint: {
    // Lint is run as a dedicated CI/gate step (`npm run lint`), not during `next build`.
    ignoreDuringBuilds: true,
  },
  typescript: {
    // Type errors must fail the build.
    ignoreBuildErrors: false,
  },
  images: {
    // Cloudflare Pages does not run Next's default image optimizer on the edge.
    unoptimized: true,
  },
  // Permanent (308) redirects. Keyword-synonym URLs are consolidated onto the canonical page that
  // ALREADY targets that phrase, so ranking signals concentrate on one strong page instead of being
  // split across near-duplicate "doorway" pages. The last rule retires the thin legacy singular
  // /airport-transfer page in favour of the full /airport-transfers hub. (Source paths are exact —
  // `/airport-transfer` does NOT match the `/activities/airport-transfer` product or its API route.)
  async redirects() {
    // Canonical-host consolidation (review item 12). The app is reachable on several origins — retired
    // domains, www variants and the bare Cloudflare project origin — which splits cookies/localStorage
    // (a cart built on one origin is empty on another) and can change origin across a payment return.
    //
    // This is an ALLOW-LIST, not a block-list, and that is deliberate. An earlier version enumerated the
    // non-canonical hostnames, which failed twice: it went stale when a hostname assumption turned out
    // to be wrong, and it silently left the REAL origin unguarded while looking correct. Inverting it
    // means a host we have never heard of — a retired domain, a project origin, a future alias — is
    // non-canonical BY CONSTRUCTION and 308s here with path + query preserved, without this file
    // needing to know its name.
    //
    // The exemption list and the regex-precedence trap it has to avoid live in config/canonical-host.mjs,
    // which tests/unit/canonical-host.test.ts pins against Next's real `^…$` matching semantics.
    return [
      {
        source: '/:path*',
        missing: [{ type: 'host', value: KEEP_HOST }],
        destination: `https://${CANONICAL_HOST}/:path*`,
        permanent: true,
      },
      {
        source: '/mauritius-airport-transfers',
        destination: '/airport-transfers',
        permanent: true,
      },
      { source: '/mauritius-activities', destination: '/activities', permanent: true },
      { source: '/things-to-do-in-mauritius', destination: '/attractions', permanent: true },
      { source: '/airport-transfer', destination: '/airport-transfers', permanent: true },
    ];
  },
  // Security + edge-caching headers.
  //
  // Caching (anonymous, non-personalised) shields Postgres under load: a cached page is served from the
  // Cloudflare edge to N concurrent readers while the DB sees ~one revalidation, not N queries. The
  // activity DETAIL path (/activities/:slug*) is deliberately NOT cached — headers() matches by path
  // regardless of status, so a rule there would cache 404s / just-unpublished tours; leaving it uncached
  // keeps admin publish/unpublish immediate. The code-generated content trees (blog / transfers /
  // destinations) have a build-fixed slug set (a redeploy busts the cache), so caching them is safe.
  //
  // Security headers are applied to every route. The CSP ships REPORT-ONLY so it can never break the
  // maps / Peach / Supabase flows — promote it to `Content-Security-Policy` after confirming no real
  // violations are reported in production.
  async headers() {
    const cache = 'public, s-maxage=300, stale-while-revalidate=600';
    const cacheLong = 'public, s-maxage=600, stale-while-revalidate=86400';
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.googleapis.com https://*.gstatic.com https://*.peachpayments.com",
      "style-src 'self' 'unsafe-inline' https://*.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co https://*.googleapis.com https://*.gstatic.com https://*.peachpayments.com",
      "frame-src 'self' https://*.peachpayments.com https://*.supabase.co",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join('; ');
    const security = [
      { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
      { key: 'Content-Security-Policy-Report-Only', value: csp },
    ];
    // Every (site) route renders under a layout that reads the locale/currency cookies into the SERVER
    // HTML (translated text + currency), so a shared/CDN cache must key on the cookie or it could serve
    // one visitor's language/currency variant to the next. `Vary: Cookie` makes any compliant shared
    // cache do that. Auth lives in localStorage (not cookies) here, so the cookie header is just
    // locale/currency/consent — few variants, so caching stays effective while correct.
    const cc = (value) => [
      { key: 'Cache-Control', value },
      { key: 'Vary', value: 'Cookie' },
    ];
    return [
      { source: '/(.*)', headers: security },
      // Preview deployments are the one origin exempt from the canonical-host 308 above (they must
      // stay reachable to be testable), so they are also the one origin a crawler could still index —
      // and a preview built without NEXT_PUBLIC_SITE_URL bakes localhost canonicals into its pages and
      // robots.txt. Keep them out of the index at the header level, which does not depend on the
      // preview's env being right. Same shape as the redirect's exemption: TWO labels before
      // `.pages.dev` is a preview; one is a bare project origin, which 308s and never gets here.
      {
        source: '/(.*)',
        has: [{ type: 'host', value: PREVIEW_HOST }],
        headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }],
      },
      // /checkout must NEVER be cached or served from the bfcache: it mints/holds a booking and a
      // stale re-execution after a successful booking could otherwise create a duplicate. no-store
      // (defence-in-depth alongside the per-occurrence booking-identity stash in Checkout.tsx).
      { source: '/checkout', headers: cc('no-store, must-revalidate') },
      // Listings (the activity DETAIL path /activities/:slug* is deliberately NOT cached — see above).
      { source: '/', headers: cc(cache) },
      { source: '/activities', headers: cc(cache) },
      // SEO landing pages list live tours like /activities, so they take the shorter listing cache.
      { source: '/mauritius-tours', headers: cc(cache) },
      { source: '/belle-mare-tours', headers: cc(cache) },
      { source: '/ile-aux-cerfs-tours', headers: cc(cache) },
      { source: '/mauritius-catamaran-cruise', headers: cc(cache) },
      { source: '/dolphin-swim-mauritius', headers: cc(cache) },
      // Static / code-generated content trees (build-fixed slug set; a redeploy busts the cache).
      { source: '/attractions', headers: cc(cacheLong) },
      { source: '/airport-transfers', headers: cc(cacheLong) },
      { source: '/blog', headers: cc(cacheLong) },
      { source: '/destinations', headers: cc(cacheLong) },
      { source: '/mauritius-travel-guide', headers: cc(cacheLong) },
      { source: '/reviews', headers: cc(cacheLong) },
      { source: '/blog/:slug*', headers: cc(cacheLong) },
      { source: '/airport-transfers/:slug*', headers: cc(cacheLong) },
      { source: '/destinations/:slug*', headers: cc(cacheLong) },
    ];
  },
};

// Gives `next dev` access to Cloudflare bindings locally. Never runs in production builds.
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

export default nextConfig;
