'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/components/auth/AuthProvider';
import {
  loadPlannerPricing,
  loadSightseeingPricing,
  loadTransportBands,
  loadRegionDistances,
  updatePlannerPricing,
  updateSightseeingPricing,
  updateTransportBand,
  updateRegionDistance,
  loadAirportFares,
  updateAirportFare,
  loadAirportReturnDiscount,
  updateAirportReturnDiscount,
  AIRPORT_ZONE_LABEL,
  type PlannerPricingInput,
  type SightseeingPricingInput,
  type TransportBandInput,
  type RegionPairInput,
  type ZoneBand,
  type AirportFareInput,
} from '@/lib/admin/vehicle-pricing';
import { AdminHeading, AdminError, BTN_PRIMARY } from '@/components/admin/ui';

const BAND_LABEL: Record<ZoneBand, string> = {
  same: 'Same region (short drive)',
  near: 'Nearby region',
  far: 'Far region (opposite coast / ends)',
};

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
  const [bands, setBands] = useState<TransportBandInput[] | null>(null);
  const [pairs, setPairs] = useState<RegionPairInput[] | null>(null);
  const [airFares, setAirFares] = useState<AirportFareInput[] | null>(null);
  const [airReturnPct, setAirReturnPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p, tb, rd, af, rp] = await Promise.all([
        loadSightseeingPricing(),
        loadPlannerPricing(),
        loadTransportBands(),
        loadRegionDistances(),
        loadAirportFares(),
        loadAirportReturnDiscount(),
      ]);
      setSight(s);
      setPlanner(p);
      setBands(tb);
      setPairs(rd);
      setAirFares(af);
      setAirReturnPct(rp);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pricing.');
    }
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  function patchBand(i: number, patch: Partial<TransportBandInput>) {
    setBands((cur) => cur && cur.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));
  }
  function setPairBand(i: number, band: 'near' | 'far') {
    setPairs((cur) => cur && cur.map((p, idx) => (idx === i ? { ...p, band } : p)));
  }
  function patchFare(i: number, patch: Partial<AirportFareInput>) {
    setAirFares((cur) => cur && cur.map((f, idx) => (idx === i ? { ...f, ...patch } : f)));
  }

  async function run(which: string, fn: () => Promise<void>) {
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

      {/* Activity transport add-on */}
      <section className="mt-[18px] rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Activity transport add-on</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Door-to-door transport for per-person / per-group activities, by how far the pickup is from the
          activity and the vehicle the party needs. The fee is added only when a customer enters a pickup.
        </p>
        {bands ? (
          <div className="mt-4 max-w-md space-y-3">
            {bands.map((bnd, i) => (
              <div key={bnd.band} className="rounded-xl border border-[#EAEEF0] p-3">
                <div className="text-[13px] font-bold text-ink">{BAND_LABEL[bnd.band]}</div>
                <EuroField label="Sedan" hint="1–4" value={bnd.sedanEur} onChange={(n) => patchBand(i, { sedanEur: n })} />
                <EuroField label="SUV" hint="1–4 upgrade" value={bnd.suvEur} onChange={(n) => patchBand(i, { suvEur: n })} />
                <EuroField label="Family car" hint="5–6" value={bnd.familyEur} onChange={(n) => patchBand(i, { familyEur: n })} />
                <EuroField label="Van" hint="7–14" value={bnd.vanEur} onChange={(n) => patchBand(i, { vanEur: n })} />
                <EuroField label="Coaster" hint="15–25" value={bnd.coasterEur} onChange={(n) => patchBand(i, { coasterEur: n })} />
              </div>
            ))}
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run('transport', async () => {
                    for (const b of bands) await updateTransportBand(b);
                  })
                }
                className={BTN_PRIMARY}
              >
                {busy ? 'Saving…' : 'Save transport fares'}
              </button>
              {saved === 'transport' && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Loading…</p>
        )}

        {pairs && pairs.length > 0 && (
          <div className="mt-6 max-w-md border-t border-[#EAEEF0] pt-5">
            <div className="text-[13px] font-bold text-ink">Region distances</div>
            <p className="mt-0.5 text-[12px] text-ink-muted">
              Same region is always the cheapest band; set each pair to Nearby or Far.
            </p>
            <div className="mt-3 space-y-1">
              {pairs.map((pr, i) => (
                <div key={`${pr.regionA}-${pr.regionB}`} className="flex items-center justify-between gap-3 py-1">
                  <span className="text-sm text-ink">
                    {pr.regionA} ↔ {pr.regionB}
                  </span>
                  <div className="flex overflow-hidden rounded-lg border border-[#E2E7EA]">
                    {(['near', 'far'] as const).map((band) => (
                      <button
                        key={band}
                        type="button"
                        onClick={() => setPairBand(i, band)}
                        className={`px-3 py-1.5 text-[12.5px] font-bold capitalize ${
                          pr.band === band ? 'bg-teal text-white' : 'bg-white text-ink-muted hover:bg-[#F7F8FA]'
                        }`}
                      >
                        {band}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run('regions', async () => {
                    for (const p of pairs) await updateRegionDistance(p.regionA, p.regionB, p.band);
                  })
                }
                className={BTN_PRIMARY}
              >
                {busy ? 'Saving…' : 'Save region distances'}
              </button>
              {saved === 'regions' && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
            </div>
          </div>
        )}
      </section>

      {/* Airport transfers */}
      <section className="mt-[18px] rounded-2xl border border-[#EAEEF0] bg-white p-5">
        <h2 className="text-[15px] font-extrabold text-ink">Airport transfers</h2>
        <p className="mt-0.5 text-[13px] text-ink-muted">
          Fixed transfer fare from SSR Airport, by the hotel’s zone and the vehicle the party needs. Zone 2
          is the near-airport south-east cluster; Zone 1 is everywhere else. The return discount applies
          when a traveller books the return leg at the same time.
        </p>
        {/* TODO(AT-3): redesign this as the proper 2-zone grid (zones as columns, vehicles as rows). */}
        {airFares ? (
          <div className="mt-4 max-w-md space-y-3">
            {airFares.map((f, i) => (
              <div key={f.zone} className="rounded-xl border border-[#EAEEF0] p-3">
                <div className="text-[13px] font-bold text-ink">{AIRPORT_ZONE_LABEL[f.zone]}</div>
                <EuroField label="Standard car" hint="1–4" value={f.sedanEur} onChange={(n) => patchFare(i, { sedanEur: n })} />
                <EuroField label="SUV" hint="1–4 upgrade" value={f.suvEur} onChange={(n) => patchFare(i, { suvEur: n })} />
                <EuroField label="Family car" hint="5–6" value={f.familyEur} onChange={(n) => patchFare(i, { familyEur: n })} />
                <EuroField label="Minibus" hint="7–14" value={f.vanEur} onChange={(n) => patchFare(i, { vanEur: n })} />
                <EuroField label="Coaster" hint="15–25" value={f.coasterEur} onChange={(n) => patchFare(i, { coasterEur: n })} />
              </div>
            ))}
            <label className="flex items-center justify-between gap-3 py-1.5">
              <span className="text-sm text-ink">
                Return discount <span className="text-ink-muted">· % off the two legs</span>
              </span>
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={0}
                  max={90}
                  step="1"
                  className={inputClass}
                  value={airReturnPct ?? 0}
                  onChange={(e) => setAirReturnPct(e.target.value ? Number(e.target.value) : 0)}
                />
                <span className="text-sm text-ink-muted">%</span>
              </span>
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() =>
                  void run('airport', async () => {
                    for (const f of airFares) await updateAirportFare(f);
                    if (airReturnPct != null) await updateAirportReturnDiscount(airReturnPct);
                  })
                }
                className={BTN_PRIMARY}
              >
                {busy ? 'Saving…' : 'Save transfer fares'}
              </button>
              {saved === 'airport' && <span className="text-sm font-semibold text-emerald-700">Saved ✓</span>}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-ink-muted">Loading…</p>
        )}
      </section>
    </div>
  );
}
