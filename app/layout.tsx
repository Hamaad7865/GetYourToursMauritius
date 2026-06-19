import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationJsonLd } from '@/lib/seo/jsonld';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  // Ship the real italic face — the hero's signature word relies on Fraunces' true italic,
  // not a synthesized oblique.
  style: ['normal', 'italic'],
  variable: '--font-display',
  display: 'swap',
});

const body = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-body',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'Belle Mare Tours — Mauritius Tours, Activities & Airport Taxi | GetYourToursMauritius',
    template: '%s | GetYourToursMauritius',
  },
  description:
    'Book Mauritius tours, activities and excursions direct with Belle Mare Tours: catamaran cruises, dolphin swims, island day tours, private sightseeing and airport taxi transfers. Transparent pricing, instant confirmation, no reseller markup.',
  applicationName: 'Belle Mare Tours',
  robots: { index: true, follow: true },
  openGraph: {
    type: 'website',
    siteName: 'Belle Mare Tours',
    locale: 'en_GB',
    images: [{ url: '/hero-mauritius.jpg', width: 1200, height: 630, alt: 'Belle Mare Tours — Mauritius' }],
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
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <JsonLd data={organizationJsonLd()} />
        {children}
      </body>
    </html>
  );
}
