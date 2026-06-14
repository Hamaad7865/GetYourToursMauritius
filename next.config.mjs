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
  // Edge-cache the public catalogue at the CDN (anonymous, non-personalised).
  async headers() {
    const cache = 'public, s-maxage=300, stale-while-revalidate=600';
    return [
      { source: '/', headers: [{ key: 'Cache-Control', value: cache }] },
      { source: '/activities', headers: [{ key: 'Cache-Control', value: cache }] },
      { source: '/activities/:slug*', headers: [{ key: 'Cache-Control', value: cache }] },
    ];
  },
};

// Gives `next dev` access to Cloudflare bindings locally. Never runs in production builds.
if (process.env.NODE_ENV === 'development') {
  await setupDevPlatform();
}

export default nextConfig;
