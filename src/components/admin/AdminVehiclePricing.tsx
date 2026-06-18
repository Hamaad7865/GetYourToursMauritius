'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadPlannerPricing,
  loadSightseeingPricing,
  updatePlannerPricing,
  updateSightseeingPricing,
  type PlannerPricingInput,
  type SightseeingPricingInput,
} from '@/lib/admin/vehicle-pricing';
import { AdminHeading, AdminError, BTN_PRIMARY } from '@/components/admin/ui';

const inputClass =
  'w-28 rounded-xl border border-[#E2E7EA] bg-[#F7F8FA] px-3 py-2 text-sm text-ink outline-none focus:border-teal focus:bg-white';

function EuroField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-sm text-ink">
        {label} <span className="text-ink-muted">· {hint}</span>
      </span>
      <span className="flex items-center gap-1">
        <span className="text-sm text-ink-muted">€</span>
        <input
          type="number"
          min={0}
          step="1"
          className={inputClass}
          value={Number.isFinite(value) ? value : ''}
          onChange={(e) => onChange(e.target.value ? Number(e.target.value) : 0)}
        />
      </span>
    </label>
  );
}

export function AdminVehiclePricing() {
  const { profile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'staff';
  const [sight, setSight] = useState<SightseeingPricingInput | null>(null);
  const [planner, setPlanner] = useState<PlannerPricingInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<'sight' | 'planner' | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([loadSightseeingPricing(), loadPlannerPricing()]);
      setSight(s);
      setPlanner(p);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pricing.');
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  async function run(which: 'sight' | 'planner', fn: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      await fn();
      await load();
      setSaved(which);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save.');
    } finally {
      setBusy(false);
    }
  }

  if (!isAdmin) return <p className="text-sm text-coral">Access denied.</p>;

  return (
    <div>
      <AdminHeading
        title="Vehicle pricing"
        subtitle="Flat per-vehicle prices. The fitting vehicle is chosen by party size; the price is server-authoritative."
      />

      {error && <AdminError>{error}</AdminError>}

      {/* Sightseeing tours */}
      <section className="mb-[18px] rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Sightseeing tours</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">Applies to every vehicle-priced sightseeing tour.</p>
        {sight ? (
          <div className="mt-4 max-w-md">
            <EuroField label="Sedan" hint="1–4" value={sight.sedanEur} onChange={(n) => setSight({ ...sight, sedanEur: n })} />
            <EuroField label="SUV" hint="1–4 upgrade" value={sight.suvEur} onChange={(n) => setSight({ ...sight, suvEur: n })} />
            <EuroField label="Family car" hint="5–6" value={sight.familyEur} onChange={(n) => setSight({ ...sight, familyEur: n })} />
            <EuroField label="Van" hint="7–14" value={sight.vanEur} onChange={(n) => setSight({ ...sight, vanEur: n })} />
            <EuroField label="Coaster" hint="15–25" value={sight.coasterEur} onChange={(n) => setSight({ ...sight, coasterEur: n })} />
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void run('sight', () => updateSightseeingPricing(sight))} className={BTN_PRIMARY}>
                {busy ? 'Saving…' : 'Save sightseeing prices'}
              </button>
              {saved === 'sight' && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Loading…</p>
        )}
      </section>

      {/* Custom road trips (AI planner) */}
      <section className="rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Custom road trips</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">Used by the AI Road Trip Planner.</p>
        {planner ? (
          <div className="mt-4 max-w-md">
            <EuroField label="Standard car" hint="1–4" value={planner.standardEur} onChange={(n) => setPlanner({ ...planner, standardEur: n })} />
            <EuroField label="SUV" hint="1–4 upgrade" value={planner.suvEur} onChange={(n) => setPlanner({ ...planner, suvEur: n })} />
            <EuroField label="6-seater" hint="5–6" value={planner.sixEur} onChange={(n) => setPlanner({ ...planner, sixEur: n })} />
            <EuroField label="Van" hint="7–14" value={planner.vanEur} onChange={(n) => setPlanner({ ...planner, vanEur: n })} />
            <EuroField label="Coach" hint={`15–${planner.maxParty}`} value={planner.coachEur} onChange={(n) => setPlanner({ ...planner, coachEur: n })} />
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-ink">Max party size</span>
              <input
                type="number"
                min={1}
                className={inputClass}
                value={planner.maxParty}
                onChange={(e) => setPlanner({ ...planner, maxParty: e.target.value ? Number(e.target.value) : 1 })}
              />
            </label>
            <div className="mt-4 flex items-center gap-3">
              <button type="button" disabled={busy} onClick={() => void run('planner', () => updatePlannerPricing(planner))} className={BTN_PRIMARY}>
                {busy ? 'Saving…' : 'Save road-trip prices'}
              </button>
              {saved === 'planner' && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Loading…</p>
        )}
      </section>
    </div>
  );
}
