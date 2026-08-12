'use client';

import { useState, type Dispatch, type SetStateAction } from 'react';
import dynamic from 'next/dynamic';
import { IconPin, IconPlus, IconX } from '@/components/ui/icons';
import type { QuotePickup } from '@/components/admin/quotes/pickup';

/**
 * Where to collect a CUSTOM tour from — the guest's hotel, with NO fare (a private tour includes its
 * transport, so recording a pickup must not force a €0 "round-trip transfer" line through the receipt).
 * It writes the chosen label onto `line.pickupLabel`, which the operations day sheet shows so the driver
 * knows the collection point and can arrange the hotel gate pass.
 *
 * Distinct from {@link LineTransport}: that attaches a PAID round-trip transfer (its own pickup + fare);
 * this only names where the tour itself begins. Both may sit on one custom line, and both share the
 * quote's remembered `pickup` (the guest's hotel, set once and pre-filled on the next line).
 *
 * The map is loaded on demand — it reaches Google Maps through `PickupMap`, so a static import would put
 * the whole Maps client in every operator's quote-editor bundle.
 */
const PickupMap = dynamic(() => import('@/components/maps/PickupMap').then((m) => m.PickupMap), {
  ssr: false,
});

export function LinePickup({
  pickupLabel,
  onChange,
  pickup,
  setPickup,
}: {
  pickupLabel: string;
  /** Set (or clear, with '') this line's pickup hotel. */
  onChange: (label: string) => void;
  pickup: QuotePickup;
  /** Raw setter — PickupMap fires label + coords from two callbacks in one event; both must compose. */
  setPickup: Dispatch<SetStateAction<QuotePickup>>;
}) {
  const [editing, setEditing] = useState(false);

  // ── No pickup yet: the add affordance ────────────────────────────────────────────────────────────
  if (!pickupLabel && !editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setEditing(true);
          if (pickup.label) onChange(pickup.label); // reuse the guest's hotel from an earlier line
        }}
        className="mt-2 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-teal-dark hover:text-teal"
      >
        <IconPlus width={13} height={13} /> Add pickup hotel
      </button>
    );
  }

  // ── Set: the pickup sub-row ──────────────────────────────────────────────────────────────────────
  return (
    <div className="mt-2 rounded-lg border border-ink/15 bg-ink/[0.02] p-2.5">
      <div className="flex items-center gap-2">
        <IconPin width={13} height={13} className="text-teal-dark" />
        <span className="text-[12px] font-bold text-ink">Pickup hotel</span>
        <span className="text-[11.5px] text-ink-muted">— where to collect this tour from</span>
        <button
          type="button"
          onClick={() => {
            onChange('');
            setEditing(false);
          }}
          aria-label="Remove the pickup from this line"
          className="ml-auto grid h-6 w-6 place-items-center rounded text-coral hover:bg-coral/10"
        >
          <IconX width={12} height={12} />
        </button>
      </div>

      {editing ? (
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
              onChange(pickup.label);
              setEditing(false);
            }}
            className="mt-1.5 text-[12px] font-semibold text-teal-dark hover:underline"
          >
            Done
          </button>
        </div>
      ) : (
        <p className="mt-1 text-[12px] text-ink-muted">
          {pickupLabel || '—'}{' '}
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="font-semibold text-teal-dark hover:underline"
          >
            change
          </button>
        </p>
      )}
    </div>
  );
}
