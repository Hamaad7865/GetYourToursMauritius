import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationJsonLd } from '@/lib/seo/jsonld';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { PreferencesProvider } from '@/components/site/PreferencesProvider';
import { ToastProvider } from '@/components/site/ToastProvider';
import { getLocale, getServerCurrency } from '@/lib/i18n/server';
import { getUsdRate } from '@/lib/money/fx';
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
    default: 'Belle Mare Tours & Mauritius East-Coast Activities | GetYourToursMauritius',
    template: '%s | GetYourToursMauritius',
  },
  description:
    "Book Belle Mare Tours direct: catamaran cruises to Île aux Cerfs, dolphin swims, undersea walks, parasailing and island day tours across Mauritius's east coast. Instant confirmation, no reseller markup.",
  robots: { index: true, follow: true },
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Locale + currency come from cookies the visitor set; the USD rate is fetched live (cached daily)
  // so prices can convert at SSR. Seeding the provider from the same values keeps the first client
  // render in sync with the server (no flash).
  const [locale, currency, usdRate] = await Promise.all([
    getLocale(),
    getServerCurrency(),
    getUsdRate(),
  ]);
  return (
    <html lang={locale} className={`${display.variable} ${body.variable}`}>
      <body>
        <JsonLd data={organizationJsonLd()} />
        <PreferencesProvider initialLanguage={locale} initialCurrency={currency} initialUsdRate={usdRate}>
          <ToastProvider>
            <AuthProvider>{children}</AuthProvider>
          </ToastProvider>
        </PreferencesProvider>
      </body>
    </html>
  );
}
