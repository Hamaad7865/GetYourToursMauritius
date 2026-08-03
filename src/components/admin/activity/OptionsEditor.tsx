'use client';

import { IconX } from '@/components/ui/icons';
import { inputClass } from '@/components/admin/fields';
import type { OptionInput } from '@/lib/admin/activity-write';

export function OptionsEditor({
  options,
  onChange,
}: {
  options: OptionInput[];
  onChange: (o: OptionInput[]) => void;
}) {
  function update(i: number, patch: Partial<OptionInput>) {
    onChange(options.map((o, idx) => (idx === i ? { ...o, ...patch } : o)));
  }
  const presetBtn =
    'rounded-full border border-ink/15 px-2.5 py-1 text-[11.5px] font-bold text-ink hover:border-teal hover:text-teal';
  return (
    <div className="flex flex-col gap-4">
      {options.map((opt, i) => {
        // "Full/Half/Free" presets + the Adult/Child/Infant seed derive from the option's highest tier price.
        const optBase = Math.max(0, ...opt.prices.map((x) => x.amountEur ?? 0));
        const half = optBase > 0 ? Math.round((optBase / 2) * 100) / 100 : null;
        const hasReal = opt.prices.some((p) => p.label.trim() || p.amountEur != null);
        const seedBands = [
          {
            label: 'Adult',
            amountEur: optBase > 0 ? optBase : null,
            maxGuests: null,
            minAge: 11,
            maxAge: null,
          },
          { label: 'Child', amountEur: half, maxGuests: null, minAge: 3, maxAge: 10 },
          { label: 'Infant', amountEur: 0, maxGuests: null, minAge: 0, maxAge: 3 },
        ];
        const patchTier = (pi: number, patch: Partial<OptionInput['prices'][number]>) =>
          update(i, { prices: opt.prices.map((x, xi) => (xi === pi ? { ...x, ...patch } : x)) });
        return (
          <div key={i} className="rounded-xl border border-ink/10 p-4">
            <div className="flex items-center gap-2">
              <input
                className={inputClass}
                value={opt.name}
                onChange={(e) => update(i, { name: e.target.value })}
                placeholder="Option name (e.g. Private group)"
              />
              <button
                type="button"
                aria-label="Remove option"
                onClick={() => onChange(options.filter((_, idx) => idx !== i))}
                className="shrink-0 text-ink-muted hover:text-coral"
              >
                <IconX width={18} height={18} />
              </button>
            </div>
            {/* Per-option time — Half day vs Full day differ here. Blank falls back to the activity's. */}
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
              <span className="font-semibold">This option:</span>
              <input
                type="number"
                min={0}
                className="w-20 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                value={opt.durationMinutes ?? ''}
                placeholder="mins"
                aria-label="Option duration in minutes"
                onChange={(e) =>
                  update(i, { durationMinutes: e.target.value ? Number(e.target.value) : null })
                }
              />
              <span>min ·</span>
              <input
                className="w-44 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                value={opt.startWindow ?? ''}
                placeholder="start time (e.g. 06:00)"
                aria-label="Option start time"
                onChange={(e) => update(i, { startWindow: e.target.value })}
              />
              <span className="text-ink-muted/70">
                blank = use the activity’s duration / start time
              </span>
            </div>
            {/* Private option: its own trips-per-day pool + base-covers-N + per-extra-head pricing.
                Replaces the price tiers entirely (the private fields ARE the pricing). */}
            <label className="mt-3 flex items-start gap-2.5 rounded-lg border border-ink/10 bg-cream/40 px-3 py-2.5">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-teal"
                checked={Boolean(opt.isPrivateOption)}
                onChange={(e) => {
                  // Saving a private option DELETES its price tiers (the private fields ARE the
                  // pricing) — configured age bands are gone for good. Make that a decision.
                  if (
                    e.target.checked &&
                    opt.prices.length > 0 &&
                    !window.confirm(
                      `Turning this option private will permanently delete its ${opt.prices.length} price tier(s) (incl. any age bands) when you save. Continue?`,
                    )
                  ) {
                    e.target.checked = false;
                    return;
                  }
                  update(
                    i,
                    e.target.checked
                      ? {
                          isPrivateOption: true,
                          privateIncluded: opt.privateIncluded ?? 4,
                          privateExtraEur: opt.privateExtraEur ?? 25,
                        }
                      : { isPrivateOption: false },
                  );
                }}
              />
              <span className="text-[12.5px] text-ink">
                <span className="font-bold">Private option</span> — one booking takes the whole trip
                (own <span className="font-semibold">trips-per-day</span> pool, set in
                Availability). A flat base price covers the first N guests; extra guests pay per
                head.
              </span>
            </label>
            {opt.isPrivateOption && (
              <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <label className="text-[12px] font-semibold text-ink-muted">
                  Base price €
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateBaseEur ?? ''}
                    placeholder="90"
                    onChange={(e) =>
                      update(i, { privateBaseEur: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  Covers up to (guests)
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateIncluded ?? ''}
                    placeholder="4"
                    onChange={(e) =>
                      update(i, { privateIncluded: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  € per extra guest
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateExtraEur ?? ''}
                    placeholder="25"
                    onChange={(e) =>
                      update(i, { privateExtraEur: e.target.value ? Number(e.target.value) : null })
                    }
                  />
                </label>
                <label className="text-[12px] font-semibold text-ink-muted">
                  Max group size
                  <input
                    type="number"
                    min={1}
                    className="mt-1 w-full rounded-lg border border-ink/15 px-2.5 py-2 text-sm text-ink outline-none"
                    value={opt.privateMaxGuests ?? ''}
                    placeholder="8"
                    onChange={(e) =>
                      update(i, {
                        privateMaxGuests: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                  />
                </label>
                <p className="col-span-2 text-[11.5px] text-ink-muted sm:col-span-4">
                  Example: €90 covers 1–4 guests, €25 per extra guest, max 8 → a party of 6 pays
                  €140. Each booking uses <span className="font-semibold">1 trip</span> for the day
                  — set how many trips you run per day on the Availability screen.
                </p>
              </div>
            )}
            <div className={`mt-3 flex flex-col gap-2 ${opt.isPrivateOption ? 'hidden' : ''}`}>
              {opt.prices.map((p, pi) => (
                <div key={pi} className="rounded-lg border border-ink/10 p-2.5">
                  <div className="flex items-center gap-2">
                    <input
                      className={inputClass}
                      value={p.label}
                      onChange={(e) => patchTier(pi, { label: e.target.value })}
                      placeholder="Tier (e.g. Adult, Child, Infant)"
                    />
                    <div className="flex w-32 shrink-0 items-center gap-1 rounded-xl border border-ink/15 px-3">
                      <span className="text-sm text-ink-muted">€</span>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="w-full bg-transparent py-2.5 text-sm text-ink outline-none"
                        value={p.amountEur ?? ''}
                        onChange={(e) =>
                          patchTier(pi, {
                            amountEur: e.target.value ? Number(e.target.value) : null,
                          })
                        }
                        placeholder="70"
                      />
                    </div>
                    <input
                      type="number"
                      min={1}
                      className="w-24 shrink-0 rounded-xl border border-ink/15 px-3 py-2.5 text-sm text-ink outline-none"
                      value={p.maxGuests ?? ''}
                      onChange={(e) =>
                        patchTier(pi, { maxGuests: e.target.value ? Number(e.target.value) : null })
                      }
                      placeholder="Group"
                      aria-label="Group size (max guests) — leave blank for per-person pricing"
                      title='Group size — set e.g. 4 for "per group up to 4"; leave blank for per-person'
                    />
                    <button
                      type="button"
                      aria-label="Remove tier"
                      onClick={() => update(i, { prices: opt.prices.filter((_, xi) => xi !== pi) })}
                      className="shrink-0 text-ink-muted hover:text-coral"
                    >
                      <IconX width={16} height={16} />
                    </button>
                  </div>
                  {/* Optional age band — drives the "Age 3–10" label + the per-band party selector on the
                      activity page. Leave both blank for a normal (non-age) tier. Presets fill € from the
                      highest tier price in this option. */}
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[12px] text-ink-muted">
                    <span className="font-semibold">Age</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Age from"
                      className="w-14 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                      value={p.minAge ?? ''}
                      placeholder="from"
                      onChange={(e) =>
                        patchTier(pi, { minAge: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                    <span>–</span>
                    <input
                      type="number"
                      min={0}
                      aria-label="Age to"
                      className="w-14 rounded-lg border border-ink/15 px-2 py-1.5 text-ink outline-none"
                      value={p.maxAge ?? ''}
                      placeholder="to"
                      onChange={(e) =>
                        patchTier(pi, { maxAge: e.target.value ? Number(e.target.value) : null })
                      }
                    />
                    <span className="mx-1 text-ink/20">|</span>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: optBase || null })}
                    >
                      Full
                    </button>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: half })}
                    >
                      Half
                    </button>
                    <button
                      type="button"
                      className={presetBtn}
                      onClick={() => patchTier(pi, { amountEur: 0 })}
                    >
                      Free
                    </button>
                  </div>
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() =>
                    update(i, {
                      prices: [...opt.prices, { label: '', amountEur: null, maxGuests: null }],
                    })
                  }
                  className="text-[13px] font-bold text-teal hover:text-teal-dark"
                >
                  + Add price tier
                </button>
                <button
                  type="button"
                  onClick={() =>
                    update(i, { prices: hasReal ? [...opt.prices, ...seedBands] : seedBands })
                  }
                  className="text-[13px] font-bold text-teal hover:text-teal-dark"
                >
                  + Add age bands (Adult / Child / Infant)
                </button>
              </div>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() =>
          onChange([
            ...options,
            {
              name: '',
              durationMinutes: null,
              startWindow: '',
              prices: [{ label: '', amountEur: null, maxGuests: null }],
            },
          ])
        }
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add option
      </button>
    </div>
  );
}
