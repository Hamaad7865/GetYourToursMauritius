'use client';

import { useState } from 'react';
import { IconX } from '@/components/ui/icons';
import { StringList, inputClass } from '@/components/admin/fields';
import type { ItineraryStopInput } from '@/lib/admin/activity-write';
import { hasPin, parseLatLng } from '@/lib/admin/stop-pins';

/**
 * The stop's stored map pin. Saving fills a missing one automatically (stored table, then
 * OpenStreetMap); this shows it so a wrong match can be spotted, and takes a pasted "lat, lng" for a
 * place OpenStreetMap doesn't know. A stop with no pin costs a billed Google lookup per page visitor.
 */
function PinField({
  stop,
  onPin,
}: {
  stop: ItineraryStopInput;
  onPin: (pin: { lat: number | null; lng: number | null }) => void;
}) {
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  if (hasPin(stop)) {
    const q = `${stop.lat},${stop.lng}`;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-muted">
        <span>
          Map pin: {stop.lat}, {stop.lng}
        </span>
        <a
          href={`https://www.google.com/maps?q=${q}`}
          target="_blank"
          rel="noreferrer"
          className="font-bold text-teal-dark underline"
        >
          Check on a map
        </a>
        <button
          type="button"
          onClick={() => onPin({ lat: null, lng: null })}
          className="font-bold text-ink-muted underline hover:text-coral"
        >
          Remove pin
        </button>
      </div>
    );
  }
  const commit = () => {
    if (!text.trim()) return setBad(false);
    const pin = parseLatLng(text);
    if (!pin) return setBad(true);
    setBad(false);
    setText('');
    onPin(pin);
  };
  return (
    <div className="mt-2 text-[12px] text-ink-muted">
      <label className="flex flex-wrap items-center gap-2">
        <span>No map pin yet — found automatically when you save, or paste coordinates:</span>
        <input
          className={`${inputClass} max-w-[220px] py-1 text-[12px]`}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              commit();
            }
          }}
          placeholder="-20.2916, 57.7796"
        />
      </label>
      {bad && (
        <p className="m-0 mt-1 text-coral-dark">
          That isn’t a point in Mauritius — right-click the place in Google Maps and click the
          numbers to copy them.
        </p>
      )}
    </div>
  );
}

export function ItineraryEditor({
  stops,
  onChange,
}: {
  stops: ItineraryStopInput[];
  onChange: (s: ItineraryStopInput[]) => void;
}) {
  function update(i: number, patch: Partial<ItineraryStopInput>) {
    onChange(stops.map((s, idx) => (idx === i ? { ...s, ...patch } : s)));
  }
  return (
    <div className="flex flex-col gap-4">
      {stops.map((stop, i) => (
        <div key={i} className="rounded-xl border border-ink/10 p-4">
          <div className="flex items-start gap-2">
            <div className="grid flex-1 gap-2 sm:grid-cols-2">
              <input
                className={inputClass}
                value={stop.title}
                // A new name is a new place: drop the old pin so saving looks the new one up.
                onChange={(e) => update(i, { title: e.target.value, lat: null, lng: null })}
                placeholder="Stop title (e.g. Port Louis)"
              />
              <input
                className={inputClass}
                value={stop.area}
                onChange={(e) => update(i, { area: e.target.value })}
                placeholder="Area (e.g. Capital)"
              />
            </div>
            <button
              type="button"
              aria-label="Remove stop"
              onClick={() => onChange(stops.filter((_, idx) => idx !== i))}
              className="shrink-0 pt-2.5 text-ink-muted hover:text-coral"
            >
              <IconX width={18} height={18} />
            </button>
          </div>
          <PinField stop={stop} onPin={(pin) => update(i, pin)} />
          <textarea
            className={`${inputClass} mt-2`}
            rows={2}
            value={stop.description}
            onChange={(e) => update(i, { description: e.target.value })}
            placeholder="What happens at this stop…"
          />
          <div className="mt-2">
            <StringList label="Tags" items={stop.tags} onChange={(t) => update(i, { tags: t })} />
          </div>
          <div className="mt-3 rounded-lg bg-ink/[0.03] p-3">
            <div className="text-[12px] font-bold text-ink">
              Alternatives (the customer picks one instead)
            </div>
            <p className="mb-2 text-[11.5px] text-ink-muted">
              Leave empty to keep this stop fixed. Add e.g. Fort Adelaide so the customer can swap
              it for {stop.title.trim() || 'this stop'}.
            </p>
            {stop.options.map((opt, oi) => (
              <div key={oi} className="mb-2 flex items-center gap-2">
                <input
                  className={inputClass}
                  value={opt.title}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) =>
                        idx === oi ? { ...o, title: e.target.value, lat: null, lng: null } : o,
                      ),
                    })
                  }
                  placeholder="Alternative place (e.g. Fort Adelaide)"
                />
                <input
                  className={inputClass}
                  value={opt.area}
                  onChange={(e) =>
                    update(i, {
                      options: stop.options.map((o, idx) =>
                        idx === oi ? { ...o, area: e.target.value } : o,
                      ),
                    })
                  }
                  placeholder="Area"
                />
                <button
                  type="button"
                  aria-label="Remove alternative"
                  onClick={() =>
                    update(i, { options: stop.options.filter((_, idx) => idx !== oi) })
                  }
                  className="shrink-0 text-ink-muted hover:text-coral"
                >
                  <IconX width={16} height={16} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => update(i, { options: [...stop.options, { title: '', area: '' }] })}
              className="rounded-full border border-ink/15 px-3 py-1 text-[12px] font-bold text-ink hover:border-teal hover:text-teal"
            >
              + Add alternative
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...stops, { title: '', area: '', description: '', tags: [], options: [] }])
        }
        className="self-start rounded-full border border-ink/15 px-4 py-2 text-sm font-bold text-ink hover:border-teal hover:text-teal"
      >
        Add stop
      </button>
    </div>
  );
}
