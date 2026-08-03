'use client';

import { IconX } from '@/components/ui/icons';
import { StringList, inputClass } from '@/components/admin/fields';
import type { ItineraryStopInput } from '@/lib/admin/activity-write';

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
                onChange={(e) => update(i, { title: e.target.value })}
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
                        idx === oi ? { ...o, title: e.target.value } : o,
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
