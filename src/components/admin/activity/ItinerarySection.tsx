'use client';

import { Field, Section, inputClass } from '@/components/admin/fields';
import { ItineraryEditor } from './ItineraryEditor';
import type { PaneProps } from './sections';

export function ItinerarySection({ v, set }: PaneProps) {
  return (
    <Section
      title="Itinerary"
      hint="The stops shown on the map and timeline. Add alternatives under a stop to let the customer pick a different place there."
    >
      <div className="flex flex-col gap-5">
        <ItineraryEditor stops={v.itinerary} onChange={(x) => set('itinerary', x)} />
        <Field label="Map location (AI trip planner)">
          <div className="flex gap-2.5">
            <input
              className={inputClass}
              type="number"
              step="any"
              value={v.lat ?? ''}
              onChange={(e) => set('lat', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="Latitude, e.g. -20.19"
              aria-label="Latitude"
            />
            <input
              className={inputClass}
              type="number"
              step="any"
              value={v.lng ?? ''}
              onChange={(e) => set('lng', e.target.value === '' ? null : Number(e.target.value))}
              placeholder="Longitude, e.g. 57.77"
              aria-label="Longitude"
            />
          </div>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Where this activity’s branded marker sits on the AI trip planner’s map. Leave blank to
            place it automatically (itinerary coordinates, else a lookup of the location name).
          </p>
        </Field>
      </div>
    </Section>
  );
}
