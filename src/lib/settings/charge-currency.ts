import { cache } from 'react';
import { createUserClient } from '@/lib/supabase/client';

/** The currencies a customer's card can be charged in (business_settings.charge_currency). */
export type ChargeCurrency = 'MUR' | 'EUR';

/**
 * The currency customers' cards are charged in, as switched in the admin Dashboard (the
 * `business_settings` singleton, 20261017120000) — or 'MUR' when it is unset or on ANY read failure,
 * which is the column's own default and what every card was charged in before the switch existed.
 *
 * DISPLAY ONLY. It decides which sentence the checkout shows ("charged in Mauritian rupees" or
 * nothing), never what is charged: the charge is pinned in SQL by create_payment, from the same row,
 * and a payment row already pinned keeps its currency whatever this says now. The pay page prefers the
 * pinned currency from the charge handoff whenever it has one.
 *
 * Server-only, through the anon client (the `business_settings_public_read` policy allows it), and
 * request-cached by `getChargeCurrency` below.
 */
export async function readChargeCurrency(): Promise<ChargeCurrency> {
  try {
    const { data } = await createUserClient()
      .from('business_settings')
      .select('charge_currency')
      .limit(1)
      .maybeSingle();
    return data?.charge_currency === 'EUR' ? 'EUR' : 'MUR';
  } catch {
    return 'MUR';
  }
}

/** Request-cached wrapper — `readChargeCurrency` deduped by React `cache()`. */
export const getChargeCurrency = cache(readChargeCurrency);
