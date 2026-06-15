import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Fraunces, Plus_Jakarta_Sans } from 'next/font/google';
import { JsonLd } from '@/components/seo/JsonLd';
import { organizationJsonLd } from '@/lib/seo/jsonld';
import { AuthProvider } from '@/components/auth/AuthProvider';
import './globals.css';

const display = Fraunces({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <JsonLd data={organizationJsonLd()} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
