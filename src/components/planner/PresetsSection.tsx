'use client';

export interface PresetCard {
  id: string;
  name: string;
  grad: string;
  stopCount: number;
  hoursLabel: string;
  fromEur: number;
}

/** "Ready-made road trips" — open a curated route in the planner, then customise it. */
export function PresetsSection({ items, onOpen }: { items: PresetCard[]; onOpen: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <section id="planner-presets" className="mx-auto max-w-shell px-[22px] pb-2 pt-[54px]">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-1.5 text-[13px] font-bold uppercase tracking-[0.04em] text-teal">Ready-made road trips</p>
          <h2 className="m-0 font-display text-[clamp(26px,4vw,38px)] font-semibold tracking-[-0.02em] text-ink">
            Start from a local favourite
          </h2>
        </div>
        <p className="m-0 max-w-[330px] text-sm text-ink-muted">
          Open any route in the planner, then make it yours — add a beach, drop a stop, the price updates live.
        </p>
      </div>

      <div className="mt-[26px] grid grid-cols-1 gap-[18px] sm:grid-cols-2 lg:grid-cols-3">
        {items.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            className="group overflow-hidden rounded-[18px] border border-[#EEF4F3] bg-white p-0 text-left shadow-[0_10px_30px_rgba(10,46,54,.05)] transition-[transform,box-shadow] duration-200 hover:-translate-y-1 hover:shadow-[0_20px_40px_rgba(10,46,54,.12)]"
          >
            <div className="relative flex h-[120px] items-end p-3.5" style={{ background: p.grad }}>
              <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(70% 90% at 80% 0%, rgba(255,255,255,.25), transparent)' }} />
              <div className="relative flex gap-1.5">
                {Array.from({ length: Math.min(4, p.stopCount) }).map((_, j) => (
                  <span key={j} className="h-2 w-2 rounded-full bg-white/85" />
                ))}
              </div>
            </div>
            <div className="px-[17px] pb-[17px] pt-[15px]">
              <div className="mb-2 flex items-center gap-2">
                <span className="font-display text-[18px] font-semibold text-ink">{p.name}</span>
              </div>
              <div className="mb-3.5 flex items-center gap-[7px] text-[13px] text-ink-muted">
                <span>{p.stopCount} stops</span>
                <span className="opacity-40">·</span>
                <span>{p.hoursLabel}</span>
                <span className="opacity-40">·</span>
                <span className="font-bold text-gold">from €{p.fromEur}</span>
              </div>
              <span className="inline-flex items-center gap-[7px] text-[13.5px] font-bold text-teal">
                Open in planner
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" className="transition-transform group-hover:translate-x-1" aria-hidden>
                  <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="#0E8C92" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
            </div>
          </button>
        ))}
      </div>
    </section>
  );
}
