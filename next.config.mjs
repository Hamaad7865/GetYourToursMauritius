import { setupDevPlatform } from '@cloudflare/next-on-pages/next-dev';

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
      "font-src 'self' data:",
      "connect-src 'self' https://*.supabase.co https://*.googleapis.com https://*.gstatic.com https://*.peachpayments.com",
      "frame-src 'self' https://*.peachpayments.com",
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
    const cc = (value) => [{ key: 'Cache-Control', value }];
    return [
      { source: '/(.*)', headers: security },
      // /checkout must NEVER be cached or served from the bfcache: it mints/holds a booking and a
      // stale re-execution after a successful booking could otherwise create a duplicate. no-store
      // (defence-in-depth alongside the per-occurrence booking-identity stash in Checkout.tsx).
      { source: '/checkout', headers: cc('no-store, must-revalidate') },
      // Listings (the activity DETAIL path /activities/:slug* is deliberately NOT cached — see above).
      { source: '/', headers: cc(cache) },
      { source: '/activities', headers: cc(cache) },
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
