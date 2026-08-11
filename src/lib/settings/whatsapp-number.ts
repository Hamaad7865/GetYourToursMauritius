import { cache } from 'react';
import { createUserClient } from '@/lib/supabase/client';
import { SITE } from '@/lib/seo/site';

/**
 * The customer-facing WhatsApp number as set in the admin Dashboard (the `business_settings`
 * singleton), or `SITE.phone` when it is unset/blank or on ANY read failure — so the site's "Chat on
 * WhatsApp" links are never broken by a missing setting or a Supabase blip.
 *
 * Server-only. It reads through the anon client (the `business_settings_public_read` policy allows
 * it) and is wrapped in React `cache()`, so the many WhatsApp links on one page trigger a single
 * single-row lookup per request rather than one per link. The `(site)` layout resolves it once and
 * seeds `useWhatsAppNumber()` for client components, so this is not imported into the client bundle.
 */
export async function readWhatsAppNumber(): Promise<string> {
  try {
    const { data } = await createUserClient()
      .from('business_settings')
      .select('whatsapp_number')
      .limit(1)
      .maybeSingle();
    const stored = data?.whatsapp_number?.trim();
    return stored ? stored : SITE.phone;
  } catch {
    return SITE.phone;
  }
}

/**
 * Request-cached wrapper — `readWhatsAppNumber` deduped by React `cache()` so the many WhatsApp links
 * on one page share a single DB read. This is the value the layout resolves; `readWhatsAppNumber` is
 * the plain (testable) core.
 */
export const getWhatsAppNumber = cache(readWhatsAppNumber);
