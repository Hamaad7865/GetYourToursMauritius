'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePlannerData } from './usePlannerData';
import { HeroSection } from './HeroSection';
import { PresetsSection, type PresetCard } from './PresetsSection';
import { FeaturesSection } from './FeaturesSection';
import { TrustSection } from './TrustSection';
import { FaqSection } from './FaqSection';
import { PICKUPS, PRESETS } from './planner-constants';
import { computePlannerRoute } from '@/lib/planner/route';
import { daySpan } from '@/lib/planner/trip';
import { nominalDayKey } from '@/lib/services/day-key';
import { useZilAi } from './assistant/ZilAiProvider';

/** What the hero sends when the visitor presses the button without typing anything. */
const DEFAULT_DAY = 'A relaxed day in the south — two beaches and a waterfall, back by 5pm.';
const DEFAULT_TRIP =
  'Plan every day of my trip with the best of Mauritius — include lunch and dinner spots, and recommend your activities where they fit.';

/** The query parameters that mean "this link carries a plan" (see usePlannerSession's restore). */
const PLAN_PARAMS = ['stops', 'fromTour', 'from'];

/**
 * /ai-road-trip-planner — the assistant's front door.
 *
 * The planner itself is ZilAi, the site-wide assistant; this page is where it is introduced and
 * where shared plans land. The hero, the ready-made trips and a tour's "customise this" link all do
 * the same thing: open the assistant with something to work on.
 */
export function PlannerLanding() {
  const { openAssistant, preload } = useZilAi();
  const { pricing } = usePlannerData();
  const [value, setValue] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [minDate, setMinDate] = useState('');

  useEffect(() => {
    // Earliest plannable day is tomorrow — the same rule the booking applies.
    setMinDate(nominalDayKey(new Date(Date.now() + 86_400_000)));
    // Whoever lands here is about to use the assistant: fetch it now, not on their first click.
    preload();
    // A shared plan, or a tour handed over to be customised, opens straight into the assistant —
    // the session reads the plan from this URL as it mounts.
    const params = new URLSearchParams(window.location.search);
    if (PLAN_PARAMS.some((key) => params.has(key))) openAssistant({ restore: true });
  }, [openAssistant, preload]);

  const isTrip = Boolean(from && to) && daySpan(from, to) > 0;
  // A single picked day is passed on as well: it primes the booking date.
  const range = from && to ? { from, to } : undefined;

  const presetCards = useMemo<PresetCard[]>(
    () =>
      PRESETS.map((p) => {
        const r = computePlannerRoute(
          PICKUPS[0]!,
          p.places.map((x) => ({ lat: x.lat, lng: x.lng, durationMin: x.durationMin })),
        );
        return {
          id: p.id,
          name: p.name,
          grad: p.grad,
          stopCount: p.places.length,
          hoursLabel: `~${Math.max(1, Math.round((r.totalMinutes + r.visitMinutes) / 60))}h`,
          fromEur: pricing.standardEur,
        };
      }),
    [pricing.standardEur],
  );

  const ask = (text: string) => {
    openAssistant({ prompt: text, range });
    setValue('');
  };

  return (
    <main className="min-h-screen bg-white">
      <HeroSection
        value={value}
        onChange={setValue}
        onSubmit={() => ask(value.trim() || (isTrip ? DEFAULT_TRIP : DEFAULT_DAY))}
        onChip={ask}
        from={from}
        to={to}
        onRange={(nextFrom, nextTo) => {
          setFrom(nextFrom);
          setTo(nextTo);
        }}
        minDate={minDate}
        isTrip={isTrip}
      />
      <PresetsSection items={presetCards} onOpen={(id) => openAssistant({ presetId: id })} />
      <FeaturesSection />
      <TrustSection />
      <FaqSection />
    </main>
  );
}
