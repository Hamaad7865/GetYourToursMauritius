'use client';

import { useT } from '@/components/site/PreferencesProvider';

const CHIPS = [
  'A relaxed day in the south',
  'Best beaches up north',
  'Waterfalls & viewpoints',
  'First time in Mauritius',
];

/**
 * Centered hero — the design's "Mauritius, planned by AI." headline, a grounded-data pill, the
 * "Tell me your perfect day…" search that kicks off the co-pilot, starter chips, and the optional
 * date-range picker that switches the planner into multi-day trip mode (e.g. Sep 1–5).
 */
export function HeroSection({
  value,
  onChange,
  onSubmit,
  onChip,
  from,
  to,
  onFrom,
  onTo,
  minDate,
  isTrip,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onChip: (text: string) => void;
  /** Trip range (optional). Empty = the classic single-day planner. */
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  /** Earliest plannable date (tomorrow — same rule as booking). */
  minDate: string;
  /** True once a multi-day range is active (drives the CTA label). */
  isTrip: boolean;
}) {
  const t = useT();
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
        style={{
          background: 'radial-gradient(60% 50% at 50% 120%, rgba(201,138,18,.10), transparent 70%)',
        }}
        aria-hidden
      />
      <div className="relative mx-auto max-w-[1080px] px-[22px] pb-10 pt-[46px] text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-[#EAF2F1] bg-white py-[5px] pl-1.5 pr-3 text-[12.5px] font-semibold text-teal-dark shadow-[0_6px_18px_rgba(10,46,54,.06)]">
          <span className="grid h-5 w-5 place-items-center rounded-md bg-teal-tint text-teal">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
              <path
                d="M5 13l4 4L19 7"
                stroke="#0E8C92"
                strokeWidth={2.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          {t('Grounded in real Google Maps drive times')}
        </div>

        <h1 className="m-0 mt-[18px] font-display text-[clamp(40px,7vw,74px)] font-semibold leading-[1.02] tracking-[-0.025em] text-ink">
          {t('Mauritius,')} <span className="font-medium italic text-teal">{t('planned')}</span>{' '}
          {t('by AI.')}
        </h1>
        <p className="mx-auto mt-[15px] max-w-[560px] text-[clamp(15px,1.9vw,18px)] font-medium leading-[1.5] text-ink-muted">
          {t(
            'Real places. Real drive times. Driven by locals. Tell ZilAi your perfect day and watch it appear on the map.',
          )}
        </p>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit();
          }}
          className="relative mx-auto mt-[26px] max-w-[620px]"
        >
          <div className="flex items-center gap-2 rounded-[18px] border border-[#E3EEEC] bg-white py-2 pl-4 pr-2 shadow-[0_18px_44px_rgba(10,46,54,.10),0_2px_6px_rgba(10,46,54,.04)]">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              className="shrink-0"
              aria-hidden
            >
              <path
                d="M9 11a4 4 0 1 1 6 3.5L17 21l-2.2-1.3M9 11l-2 1m2-1a4 4 0 0 0 .8 2.4"
                stroke="#F76C5E"
                strokeWidth={1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx={11} cy={11} r={7} stroke="#F76C5E" strokeWidth={1.8} />
            </svg>
            <input
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t('Tell me your perfect day…')}
              aria-label={t('Describe your perfect day in Mauritius')}
              className="min-w-0 flex-1 border-none bg-transparent text-base font-medium text-ink outline-none placeholder:text-ink-muted/70"
            />
            <button
              type="submit"
              aria-label={isTrip ? t('Plan my trip') : t('Plan my day')}
              className="inline-flex shrink-0 items-center gap-[7px] rounded-[13px] px-[18px] py-[11px] text-[14.5px] font-bold text-white shadow-[0_8px_20px_rgba(14,140,146,.32)]"
              style={{ background: 'linear-gradient(135deg,#13A0A6,#0B5C63)' }}
            >
              {isTrip ? t('Plan my trip') : t('Plan my day')}
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden>
                <path
                  d="M5 12h13m0 0-5-5m5 5-5 5"
                  stroke="#fff"
                  strokeWidth={2.2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          </div>

          {/* Optional trip dates — picking a range (e.g. 1–5 Sep) turns on multi-day planning. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 rounded-[14px] border border-[#E3EEEC] bg-white/80 px-3.5 py-2.5 shadow-[0_8px_22px_rgba(10,46,54,.06)] backdrop-blur-sm">
            <span className="inline-flex items-center gap-1.5 text-[12.5px] font-bold text-teal-dark">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
                <rect
                  x="4"
                  y="6"
                  width="16"
                  height="14"
                  rx="2.5"
                  stroke="#0B5C63"
                  strokeWidth={1.7}
                />
                <path
                  d="M4 10h16M8 3.5V7m8-3.5V7"
                  stroke="#0B5C63"
                  strokeWidth={1.7}
                  strokeLinecap="round"
                />
              </svg>
              {t('Trip dates')}
            </span>
            <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted">
              {t('Start')}
              <input
                type="date"
                value={from}
                min={minDate}
                onChange={(e) => onFrom(e.target.value)}
                aria-label={t('Trip start date')}
                className="rounded-[9px] border border-[#E3EEEC] bg-white px-2 py-1.5 text-[12.5px] font-semibold text-ink outline-none focus:border-teal"
              />
            </label>
            <label className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-ink-muted">
              {t('End')}
              <input
                type="date"
                value={to}
                min={from || minDate}
                onChange={(e) => onTo(e.target.value)}
                aria-label={t('Trip end date')}
                className="rounded-[9px] border border-[#E3EEEC] bg-white px-2 py-1.5 text-[12.5px] font-semibold text-ink outline-none focus:border-teal"
              />
            </label>
            {from || to ? (
              <button
                type="button"
                onClick={() => {
                  onFrom('');
                  onTo('');
                }}
                className="cursor-pointer text-[12px] font-bold text-ink-muted underline hover:text-teal-dark"
              >
                {t('Clear')}
              </button>
            ) : (
              <span className="text-[11.5px] text-ink-muted">
                {t('Optional — pick a range (up to 7 days) and I’ll plan every day')}
              </span>
            )}
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
              {t(c)}
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
