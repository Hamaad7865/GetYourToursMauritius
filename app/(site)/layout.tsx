import type { ReactNode } from 'react';
import { AuthProvider } from '@/components/auth/AuthProvider';
import { CookieNotice } from '@/components/site/CookieNotice';
import { PreferencesProvider } from '@/components/site/PreferencesProvider';
import { ToastProvider } from '@/components/site/ToastProvider';
import { getLocale, getServerCurrency } from '@/lib/i18n/server';
import { getUsdRate } from '@/lib/money/fx';

export const runtime = 'edge';

/**
 * Site shell for every customer + admin page. Reads the visitor's locale/currency cookies and the live
 * USD rate so server pages AND client components render in the right language/currency from SSR (no
 * flash), and seeds the preferences provider from the same values. This cookie-reading (dynamic) layer
 * lives in a route group so the ROOT layout can stay STATIC — the Cloudflare (next-on-pages) build
 * can't ship the implicit /_not-found route when it inherits runtime logic from the root layout.
 */
export default async function SiteLayout({ children }: { children: ReactNode }) {
  const [locale, currency, usdRate] = await Promise.all([
    getLocale(),
    getServerCurrency(),
    getUsdRate(),
  ]);
  return (
    <PreferencesProvider initialLanguage={locale} initialCurrency={currency} initialUsdRate={usdRate}>
      <ToastProvider>
        <AuthProvider>{children}</AuthProvider>
      </ToastProvider>
      <CookieNotice />
    </PreferencesProvider>
  );
}
