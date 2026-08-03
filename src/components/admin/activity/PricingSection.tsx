'use client';

import { Field, Section, inputClass } from '@/components/admin/fields';
import { OptionsEditor } from './OptionsEditor';
import type { ActivityFormValues } from '@/lib/admin/activity-write';
import type { PaneProps } from './sections';

/** Staff-only: the restricted 'seo' content role never sees this pane (RLS blocks the tables). */
export function PricingSection({ v, set }: PaneProps) {
  return (
    <Section
      title="Pricing & options"
      hint="Each option (e.g. Shared, Private) has price tiers: a label, a € price, and a “fits up to” number. Its meaning follows the pricing mode — a per-tier cap (per person) or the group size (per group)."
    >
      <div className="flex flex-col gap-5">
        <Field label="Pricing">
          <select
            className={inputClass}
            value={v.pricingMode}
            onChange={(e) =>
              set('pricingMode', e.target.value as ActivityFormValues['pricingMode'])
            }
          >
            <option value="per_person">Per person (price × people)</option>
            <option value="per_group">Per group (one price per group of N)</option>
            <option value="vehicle">Sightseeing vehicle (flat per-vehicle price)</option>
          </select>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            {v.pricingMode === 'vehicle'
              ? 'Sightseeing vehicle pricing is global, one flat price per vehicle: Sedan €70 / SUV €85 (1–4), Family car €85 (5–6), Van €125 (7–14), Coaster €225 (15–25), capped at 25. Applies to every vehicle-priced tour — no per-tour tiers. Change it in the sightseeing_pricing table.'
              : v.pricingMode === 'per_group'
                ? 'The price buys one group of up to “fits up to” people; bigger parties pay for extra groups (ceil(people / size) × price).'
                : 'Each guest pays the tier price. “Fits up to” is an optional hard cap per tier.'}
          </p>
        </Field>

        {v.pricingMode === 'vehicle' ? (
          <>
            <p className="rounded-lg bg-teal/5 px-3 py-2 text-[12.5px] text-ink-muted">
              Vehicle-priced tours use the global flat prices (Sedan €70 / SUV €85 / Family €85 /
              Van €125 / Coaster €225 · max 25). Add a single option (e.g. “Sightseeing”) so dates
              can be scheduled — no price tiers required.
            </p>
            {v.options.some((o) => o.isPrivateOption) && (
              // The options editor is hidden in vehicle mode, so without this the save error
              // ("private option isn't available on vehicle-priced tours") had no visible fix.
              <div className="flex flex-wrap items-center gap-3 rounded-lg border border-coral/40 bg-coral/5 px-3 py-2.5 text-[12.5px] text-ink">
                <span>
                  This tour still has a <b>Private option</b> — not available with vehicle pricing,
                  so saving will fail until it&rsquo;s removed.
                </span>
                <button
                  type="button"
                  onClick={() =>
                    set(
                      'options',
                      v.options.map((o) => ({ ...o, isPrivateOption: false })),
                    )
                  }
                  className="rounded-lg border border-coral/50 px-2.5 py-1 text-[12px] font-bold text-coral-dark hover:bg-coral/10"
                >
                  Remove private option
                </button>
              </div>
            )}
          </>
        ) : (
          <OptionsEditor options={v.options} onChange={(x) => set('options', x)} />
        )}

        <Field label="Optional supplement">
          <div className="grid gap-3 sm:grid-cols-[1fr_150px]">
            <input
              className={inputClass}
              placeholder="e.g. Lobster for lunch"
              value={v.supplementName}
              onChange={(e) => set('supplementName', e.target.value)}
            />
            <div className="flex items-center gap-2">
              <span className="text-[13px] font-bold text-ink/60">€</span>
              <input
                className={inputClass}
                type="number"
                min={0}
                step="0.01"
                placeholder="0.00"
                value={v.supplementEur ?? ''}
                onChange={(e) =>
                  set('supplementEur', e.target.value === '' ? null : Number(e.target.value))
                }
              />
            </div>
          </div>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            An upgrade guests can add to this activity while booking — you name it and you price it.
            The price is <strong>per person</strong>: in a party of four where two want it, the
            booking pays twice. Leave the name empty to hide it.
          </p>
        </Field>
      </div>
    </Section>
  );
}
