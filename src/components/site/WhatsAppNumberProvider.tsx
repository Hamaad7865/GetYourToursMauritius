'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';
import { SITE } from '@/lib/seo/site';

/**
 * The customer-facing WhatsApp number, resolved once by the `(site)` layout (via
 * `getWhatsAppNumber()`) and handed to client components here — so an admin edit reaches every "Chat
 * on WhatsApp" link without a redeploy. Deliberately its own tiny provider rather than folded into
 * `PreferencesProvider` (which is about language/currency): this has exactly one job.
 */
const WhatsAppNumberContext = createContext<string | null>(null);

export function WhatsAppNumberProvider({
  value,
  children,
}: {
  value: string;
  children: ReactNode;
}) {
  return <WhatsAppNumberContext.Provider value={value}>{children}</WhatsAppNumberContext.Provider>;
}

/**
 * The current WhatsApp number, for `whatsappUrl(message, number)`. Falls back to `SITE.phone` outside
 * a provider so a link is always well-formed.
 */
export function useWhatsAppNumber(): string {
  return useContext(WhatsAppNumberContext) ?? SITE.phone;
}
