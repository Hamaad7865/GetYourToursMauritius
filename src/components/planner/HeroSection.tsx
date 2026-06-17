'use client';

const CHIPS = ['A relaxed day in the south', 'Best beaches up north', 'Waterfalls & viewpoints', 'First time in Mauritius'];

/**
 * Centered hero — the design's "Mauritius, planned by AI." headline, a grounded-data pill, the
 * "Tell me your perfect day…" search that kicks off the co-pilot, and starter chips.
 */
export function HeroSection({
  value,
  onChange,
  onSubmit,
  onChip,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onChip: (text: string) => void;
}) {
  return (
    <section
      className="relative overflow-hidden"
      style={{
        background:
          'radial-gradient(120% 120% at 88% -8%, #EAF7F5 0%, #FFFFFF 46%), radial-gradient(90% 80% at 6% 0%, rgba(247,108,94,.10) 0%, rgba(255,255,255,0) 42%)',
      }}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{ background: 'radial-gradient(60% 50% at 50% 120%, rgba(201,138,18,.10), transparent 70%)' }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1080px] px-[22px] pb-10 pt-[46px] text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#EAF2F1] bg-white py-[5px] pl-1.5 pr-3 text-[12.5px] font-semibold text-teal-dark shadow-[0_6px_18px_rgba(10,46,54,.06)]">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-teal-tint text-teal">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path d="M5 13l4 4L19 7" stroke="#0E8C92" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          Grounded in real Google Maps drive times
        </div>

        <h1 className="m-0 mt-[18px] font-display text-[clamp(40px,7vw,74px)] font-semibold leading-[1.02] tracking-[-0.025em] text-ink">
          Mauritius, <span className="font-medium italic text-teal">planned</span> by AI.
        </h1>
        <p className="mx-auto mt-[15px] max-w-[560px] text-[clamp(15px,1.9vw,18px)] font-medium leading-[1.5] text-ink-muted">
          Real places. Real drive times. Driven by locals. Tell our co-pilot your perfect day and watch it appear on the map.
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="relative mx-auto mt-[26px] max-w-[620px]"
        >
          <div className="flex items-center gap-2 rounded-[18px] border border-[#E3EEEC] bg-white py-2 pl-4 pr-2 shadow-[0_18px_44px_rgba(10,46,54,.10),0_2px_6px_rgba(10,46,54,.04)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden>
              <path d="M9 11a4 4 0 1 1 6 3.5L17 21l-2.2-1.3M9 11l-2 1m2-1a4 4 0 0 0 .8 2.4" stroke="#F76C5E" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={11} cy={11} r={7} stroke="#F76C5E" strokeWidth={1.8} />
            </svg>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Tell me your perfect day…"
              aria-label="Describe your perfect day in Mauritius"
              className="min-w-0 flex-1 border-none bg-transparent text-base font-medium text-ink outline-none placeholder:text-ink-muted/70"
            />
            <button
              type="submit"
              aria-label="Plan my day"
              className="inline-flex shrink-0 items-center gap-[7px] rounded-[13px] px-[18px] py-[11px] text-[14.5px] font-bold text-white shadow-[0_8px_20px_rgba(14,140,146,.32)]"
              style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
            >
              Plan my day
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path d="M5 12h13m0 0-5-5m5 5-5 5" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </form>

        <div className="mt-3.5 flex flex-wrap justify-center gap-[9px]">
          {CHIPS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => onChip(c)}
              className="cursor-pointer rounded-full border border-[#E3EEEC] bg-white px-3.5 py-2 text-[13px] font-semibold text-teal-dark shadow-[0_2px_8px_rgba(10,46,54,.04)] transition hover:border-teal hover:bg-teal-tint"
            >
              {c}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
