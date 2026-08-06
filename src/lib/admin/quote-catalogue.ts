import { getBrowserSupabase } from '@/lib/supabase/browser';
import { catalogueLineRefusal } from '@/components/admin/quotes/state';

/**
 * The catalogue, as the quote editor's "Add tour" picker needs it: which tours can be quoted, which
 * departures run on a chosen day, and what each price tier costs TODAY.
 *
 * Staff RLS is the gate (the same authenticated browser client the rest of admin uses); no
 * service-role key is involved. Reads only — the editor writes nothing here.
 *
 * The picker deliberately shows NO seat count. Nothing is reserved while a quote is drafted or sent
 * — api_convert_quote takes the hold in the transaction that mints the booking, at the moment the
 * guest pays — so a number here would be a promise this module cannot keep, and it would be read as
 * one. The honest answer, which the picker prints instead, is that a quoted departure can sell out
 * before the guest accepts.
 */

/** A tour that can appear in the picker. `status` is the catalogue's own draft/published flag. */
export interface QuotableActivity {
  id: string;
  title: string;
  status: string;
  pricingMode: string;
}

export interface QuoteTier {
  label: string;
  amountMinor: number;
}

/** One departure on the chosen day, with the tiers a party is priced from. */
export interface QuoteDeparture {
  occurrenceId: string;
  activityOptionId: string;
  optionName: string;
  startsAt: string;
  tiers: QuoteTier[];
  /** Non-null when this shape cannot become a catalogue line — see `catalogueLineRefusal`. */
  refusal: string | null;
}

/** Every activity, newest catalogue order, for the picker's first dropdown. */
export async function loadQuotableActivities(): Promise<QuotableActivity[]> {
  const { data, error } = await getBrowserSupabase()
    .from('activities')
    .select('id, title, status, pricing_mode')
    .order('title', { ascending: true });
  if (error) throw error;
  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status ?? 'draft',
    pricingMode: row.pricing_mode ?? 'per_person',
  }));
}

interface OptionWithPrices {
  id: string;
  name: string;
  private_base_minor: number | null;
  activity_option_prices: Array<{ label: string; amount_minor: number; position: number }> | null;
}

/**
 * The departures of one activity on one Mauritius calendar day.
 *
 * The day is bounded at +04:00, the same fixed offset `src/lib/admin/calendar.ts` uses: a departure
 * at 09:00 in Mauritius belongs to the day the operator clicked, not to the UTC day it falls in.
 *
 * Only `status = 'open'` occurrences are offered. `create_hold` refuses a closed or cancelled one,
 * and that refusal would land on the guest at payment rather than on the operator at drafting.
 */
export async function loadActivityDepartures(
  activityId: string,
  day: string,
): Promise<QuoteDeparture[]> {
  const sb = getBrowserSupabase();
  const { data: activity, error: activityError } = await sb
    .from('activities')
    .select('pricing_mode')
    .eq('id', activityId)
    .maybeSingle();
  if (activityError) throw activityError;
  const pricingMode = activity?.pricing_mode ?? 'per_person';

  const { data: options, error: optionsError } = await sb
    .from('activity_options')
    .select('id, name, private_base_minor, activity_option_prices(label, amount_minor, position)')
    .eq('activity_id', activityId)
    .order('position', { ascending: true })
    .returns<OptionWithPrices[]>();
  if (optionsError) throw optionsError;
  const byOption = new Map((options ?? []).map((option) => [option.id, option]));
  if (byOption.size === 0) return [];

  const from = new Date(`${day}T00:00:00.000+04:00`).toISOString();
  const to = new Date(`${day}T24:00:00.000+04:00`).toISOString();
  const { data: occurrences, error: occurrencesError } = await sb
    .from('session_occurrences')
    .select('id, activity_option_id, starts_at, status')
    .in('activity_option_id', [...byOption.keys()])
    .eq('status', 'open')
    .gte('starts_at', from)
    .lt('starts_at', to)
    .order('starts_at', { ascending: true });
  if (occurrencesError) throw occurrencesError;

  return (occurrences ?? []).flatMap((occurrence) => {
    const option = byOption.get(occurrence.activity_option_id);
    if (!option) return [];
    const tiers = [...(option.activity_option_prices ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((price) => ({ label: price.label, amountMinor: price.amount_minor }));
    return [
      {
        occurrenceId: occurrence.id,
        activityOptionId: option.id,
        optionName: option.name,
        startsAt: occurrence.starts_at,
        tiers,
        refusal: catalogueLineRefusal({
          pricingMode,
          isPrivate: option.private_base_minor != null,
          priceCount: tiers.length,
        }),
      },
    ];
  });
}
