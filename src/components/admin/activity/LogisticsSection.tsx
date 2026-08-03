'use client';

import { Field, Section, inputClass } from '@/components/admin/fields';
import type { PaneProps } from './sections';

/** How the trip runs: where it meets, when it leaves, who it takes, how it is booked. */
export function LogisticsSection({ v, set }: PaneProps) {
  return (
    <Section title="Logistics" hint="Where the trip meets, when it leaves, and who it takes.">
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Meeting point">
            <input
              className={inputClass}
              value={v.meetingPoint}
              onChange={(e) => set('meetingPoint', e.target.value)}
            />
          </Field>
          <Field label="Cancellation policy">
            <input
              className={inputClass}
              value={v.cancellationPolicy}
              onChange={(e) => set('cancellationPolicy', e.target.value)}
            />
          </Field>
        </div>
        <Field label="Start time / departure">
          <input
            className={inputClass}
            value={v.startWindow}
            onChange={(e) => set('startWindow', e.target.value)}
            placeholder="e.g. 09:00 or 07:30–09:30"
          />
          <p className="mt-1.5 text-[12px] text-ink-muted">
            Shown in the “at a glance” facts as the departure time. Leave blank to show “Check
            availability for start times”.
          </p>
        </Field>
        <Field label="Home region (transport add-on)">
          <select
            className={inputClass}
            value={v.region}
            onChange={(e) => set('region', e.target.value)}
          >
            <option value="">Auto (from map coordinates)</option>
            <option value="North">North</option>
            <option value="South">South</option>
            <option value="East">East</option>
            <option value="West">West</option>
            <option value="Central">Central</option>
          </select>
          <p className="mt-1.5 text-[12px] text-ink-muted">
            The activity’s boarding region. For per-person / per-group activities with hotel pickup,
            the door-to-door transport fee scales with how far the customer’s pickup is from this
            region. Fares live in Vehicle pricing → Activity transport add-on.
          </p>
        </Field>
        <div className="flex flex-col gap-3 border-t border-[#EAEEF0] pt-4">
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.pickupAvailable}
              onChange={(e) => set('pickupAvailable', e.target.checked)}
            />
            Hotel pickup available
          </label>
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.isPrivate}
              onChange={(e) => set('isPrivate', e.target.checked)}
            />
            Private — exclusive to the booker’s party
          </label>
          <label className="flex items-center gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 accent-teal"
              checked={v.adultsOnly}
              onChange={(e) => set('adultsOnly', e.target.checked)}
            />
            Adults only (18+) — no children; hides the baby &amp; child seats add-on
          </label>
          <label className="flex items-start gap-2.5 text-sm font-medium text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 shrink-0 accent-teal"
              checked={v.inquiryOnly}
              onChange={(e) => set('inquiryOnly', e.target.checked)}
            />
            <span>
              Enquiry only — skip online checkout; the customer submits a trip request (dates, party
              size, contact details) via WhatsApp or email instead. For planning-heavy activities
              like skydiving.
            </span>
          </label>
        </div>
      </div>
    </Section>
  );
}
