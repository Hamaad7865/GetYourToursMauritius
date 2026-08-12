'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { INPUT_CLS } from '@/components/admin/ui';
import { IconPin, IconPlus, IconX } from '@/components/ui/icons';
import {
  regionFromCoords,
  transportFareMinor,
  type RegionDistanceMap,
  type TransportBandPricing,
} from '@/lib/services/pricing';
import {
  activityRegion,
  eurFromMinor,
  formatMinorAsEuros,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';
import type { QuotePickup } from '@/components/admin/quotes/pickup';
import type { OptionRegion } from '@/lib/admin/quote-catalogue';

/**
 * The round-trip TRANSPORT add-on, ATTACHED TO A LINE — the replacement for the old "Pickup & transport"
 * drawer that spawned separate sibling lines. One line, one add-on: the transfer's pickup and fare live on
 * the tour/custom line itself (`line.transport`), so it travels with the activity onto the calendar and
 * reads as a nested sub-row on the receipt.
 *
 * The pickup map is loaded on demand — it reaches Google Maps through `PickupMap`, so a static import
 * would put the whole Maps client in every operator's bundle. The pickup is the guest's hotel: set on one
 * line's control and REMEMBERED on the shared `pickup` state, so the next line pre-fills it and re-prices
 * without re-entering it. The fare is auto-priced for a catalogue line (pickup region → that tour's region,
 * via the same `transportFareMinor` engine the public widget uses) and always editable afterwards; a custom
 * line has no catalogue region, so its fare is typed.
 */
const PickupMap = dynamic(() => import('@/components/maps/PickupMap').then((m) => m.PickupMap), {
  ssr: false,
});

export function LineTransport({
  line,
  onChange,
  pickup,
  setPickup,
  pricing,
  optionRegions,
}: {
  line: QuoteLineDraft;
  /** Set (or clear, with null) this line's transport add-on. */
  onChange: (transport: QuoteLineDraft['transport']) => void;
  pickup: QuotePickup;
  /** Raw setter — PickupMap fires label + coords from two callbacks in one event; both must compose. */
  setPickup: Dispatch<SetStateAction<QuotePickup>>;
  pricing: { bands: TransportBandPricing; distances: RegionDistanceMap } | null;
  optionRegions: Map<string, OptionRegion> | null;
}) {
  const [editingPickup, setEditingPickup] = useState(false);

  /** The suggested round-trip fare from the shared pickup to THIS line's activity region, in minor units.
   *  0 when the pickup, the region or the pricing config is missing — the operator then types the fare. */
  function autoFareMinor(): number {
    if (!pickup.coords || !pricing) return 0;
    const pickupRegion = regionFromCoords(pickup.coords.lat, pickup.coords.lng);
    const opt = line.activityOptionId ? (optionRegions?.get(line.activityOptionId) ?? null) : null;
    const actRegion = opt ? activityRegion(opt) : null;
    const pax = Math.max(1, Number(line.quantityText) || 1);
    return transportFareMinor(
      pickupRegion,
      actRegion,
      pax,
      false,
      pricing.bands,
      pricing.distances,
    );
  }

  // ── No transfer yet: the add affordance ─────────────────────────────────────────────────────────
  if (!line.transport) {
    return (
      <button
        type="button"
        onClick={() => {
          const fare = autoFareMinor();
          onChange({
            pickupLabel: pickup.label,
            dropoffLabel: '',
            fareText: fare ? formatMinorAsEuros(fare) : '',
          });
          if (!pickup.label) setEditingPickup(true); // no hotel yet → open the map to set it
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-dark hover:text-teal"
      >
        <IconPlus width={13} height={13} /> Add round-trip transfer
      </button>
    );
  }

  // ── Attached: the nested add-on sub-row ─────────────────────────────────────────────────────────
  const t = line.transport;
  return (
    <div className="mt-2 rounded-lg border border-teal/25 bg-teal/[0.04] p-2.5">
      <div className="flex items-center gap-2">
        <IconPin width={13} height={13} className="text-teal-dark" />
        <span className="text-[12px] font-bold text-teal-dark">Round-trip transfer</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Remove the transfer from this line"
          className="ml-auto grid h-6 w-6 place-items-center rounded text-coral hover:bg-coral/10"
        >
          <IconX width={12} height={12} />
        </button>
      </div>

      {editingPickup ? (
        <div className="mt-2">
          {/* ONE functional setState per keystroke, never a second object-replacement rebuilt from state
              captured at render — that pair (label + coords) is what froze the pickup search on the old
              drawer. The line's own pickupLabel is synced from the shared pickup on Done, not per key. */}
          <PickupMap
            value={pickup.label}
            onChange={(label) => setPickup((cur) => ({ ...cur, label }))}
            onCoords={(coords) => setPickup((cur) => ({ ...cur, coords }))}
            placeholder="Guest's hotel or address"
          />
          <button
            type="button"
            onClick={() => {
              const fare = autoFareMinor();
              onChange({
                ...t,
                pickupLabel: pickup.label,
                fareText: fare ? formatMinorAsEuros(fare) : t.fareText,
              });
              setEditingPickup(false);
            }}
            className="mt-1.5 text-[12px] font-semibold text-teal-dark hover:underline"
          >
            Done
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-ink-muted">
          from {t.pickupLabel || '—'}{' '}
          <button
            type="button"
            onClick={() => setEditingPickup(true)}
            className="font-semibold text-teal-dark hover:underline"
          >
            {t.pickupLabel ? 'change' : 'set pickup on map'}
          </button>
        </p>
      )}

      <div className="mt-2 flex items-center gap-2">
        <span className="text-[12px] text-ink-muted">Fare</span>
        <span className="text-[12px] text-ink-muted">€</span>
        <input
          value={t.fareText}
          onChange={(e) => onChange({ ...t, fareText: e.target.value })}
          inputMode="decimal"
          placeholder="0.00"
          aria-label={`Transfer fare for this line, in euros`}
          className={`${INPUT_CLS} max-w-[7rem] text-right`}
        />
        {pickup.coords && line.activityOptionId && (
          <span className="text-[11.5px] text-ink-muted">
            suggested {eurFromMinor(autoFareMinor())}
          </span>
        )}
      </div>
    </div>
  );
}
