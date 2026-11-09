import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { JsonLd } from '@/components/seo/JsonLd';
import { GoogleTagManager, GoogleTagManagerNoScript } from '@/components/site/GoogleTagManager';
import { IMAGE_FALLBACK_SCRIPT } from '@/lib/images/fallback';
import { resizingEnabled } from '@/lib/images/resize';
import { organizationJsonLd, websiteJsonLd } from '@/lib/seo/jsonld';
import './globals.css';
import './fonts/fonts.css';

// The brand serif (Fraunces) was retired on request: the app uses ONE sans everywhere now. Tailwind's
// `font-display` token is aliased to this same body font (see tailwind.config.ts), so every heading
// renders Plus Jakarta Sans and no `font-display`/`italic` usage needs touching.
// Self-hosted, never next/font/google: fetching from Google at build time failed CI builds. The latin
// file is loaded here, so it gets a preload tag. ./fonts/fonts.css holds the other character subsets
// under the same family name, plus the fallback face; it also explains the weight range.
// next/font requires literal options, so the unicode-range cannot be a shared constant.
const body = localFont({
  src: './fonts/plus-jakarta-sans-latin.woff2',
  weight: '400 700',
  variable: '--font-body',
  display: 'swap',
  adjustFontFallback: false,
  fallback: ['Plus Jakarta Sans Fallback'],
  declarations: [
    { prop: 'font-family', value: 'Plus Jakarta Sans' },
    {
      prop: 'unicode-range',
      value:
        'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD',
    },
  ],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi',
    template: '%s | Belle Mare Tours',
  },
  description:
    'Book Mauritius tours, activities and excursions direct with Belle Mare Tours: catamaran cruises, dolphin swims, island day tours, private sightseeing and airport taxi transfers. Transparent pricing, instant confirmation, no reseller markup.',
  applicationName: 'Belle Mare Tours',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'Belle Mare Tours',
    locale: 'en_GB',
    images: [
      { url: '/hero-mauritius.jpg', width: 1200, height: 630, alt: 'Belle Mare Tours — Mauritius' },
    ],
  },
  twitter: { card: 'summary_large_image', images: ['/hero-mauritius.jpg'] },
  // Google Search Console verification — set NEXT_PUBLIC_GSC_VERIFICATION once you claim the property.
  ...(process.env.NEXT_PUBLIC_GSC_VERIFICATION
    ? { verification: { google: process.env.NEXT_PUBLIC_GSC_VERIFICATION } }
    : {}),
};

// The root layout is STATIC on purpose: it owns <html>/<body> and the fonts, but reads no cookies, so
// the implicit /_not-found route stays static and the Cloudflare (next-on-pages) build succeeds. The
// cookie-reading providers (locale/currency at SSR) live in app/(site)/layout.tsx, which wraps every
// real page. `lang` starts at 'en' and the preferences provider updates document.lang client-side.
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={body.variable}>
      <body>
        {/* Only where photos are resized (see src/lib/images/resize.ts): puts the original back for
            any resized photo that fails to load. First in <body>, so it is listening before any
            image can fail. Plain DOM, no tracking — it does not touch the consent ordering below. */}
        {resizingEnabled() && (
          <script dangerouslySetInnerHTML={{ __html: IMAGE_FALLBACK_SCRIPT }} />
        )}
        <GoogleTagManagerNoScript />
        <JsonLd data={organizationJsonLd()} />
        {/* The site entity, paired with the business entity above — see websiteJsonLd for why the
            brand query needs both. */}
        <JsonLd data={websiteJsonLd()} />
        {children}
        {/* Loads the container with Consent Mode v2 defaults DENIED; the cookie banner flips them. */}
        <GoogleTagManager />
      </body>
    </html>
  );
}
