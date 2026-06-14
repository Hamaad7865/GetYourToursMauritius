import { IconCheck, IconSearch, IconStar } from '@/components/ui/icons';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-[linear-gradient(168deg,#0E6168_0%,#0B5C63_42%,#0A2E36_100%)]">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(125%_78%_at_50%_-18%,rgba(247,108,94,0.5)_0%,rgba(247,108,94,0.14)_32%,rgba(247,108,94,0)_58%)]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-b from-transparent to-cream" />

      <div className="relative mx-auto max-w-shell px-6 pb-28 pt-16">
        <div className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-4 py-1.5 text-[13px] font-semibold text-cream backdrop-blur">
          Operated by Belle Mare Tours
        </div>

        <h1 className="mt-5 max-w-[15ch] text-balance font-display text-4xl font-medium leading-[1.03] tracking-tight text-cream sm:text-6xl">
          Belle Mare to Île aux Cerfs, booked direct.
        </h1>

        <p className="mt-5 max-w-[610px] text-lg leading-relaxed text-cream/85">
          Catamaran cruises, sea walks, dolphin swims and island days across Mauritius&apos;s east
          coast — run by Belle Mare Tours, booked here without the reseller markup.
        </p>

        <form
          action="/activities"
          method="get"
          className="mt-8 flex max-w-[730px] flex-wrap items-stretch gap-1 rounded-2xl bg-white p-2 shadow-2xl"
        >
          <label className="flex min-w-[170px] flex-1 flex-col justify-center px-4 py-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-teal">
              Activity or location
            </span>
            <input
              name="q"
              aria-label="Activity or location"
              placeholder="Île aux Cerfs, catamaran, dolphins…"
              className="mt-1 w-full border-none bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
            />
          </label>
          <button
            type="submit"
            className="flex min-h-[58px] items-center justify-center gap-2 rounded-xl bg-coral px-6 text-base font-bold text-white hover:brightness-95"
          >
            <IconSearch />
            <span>Search</span>
          </button>
        </form>

        <div className="mt-6 flex flex-wrap items-center gap-4 text-sm font-medium text-cream/90">
          <span className="flex items-center gap-1.5">
            <IconStar width={16} height={16} className="text-gold-light" />
            <b className="text-cream">4.8</b> average rating
          </span>
          <span className="h-1 w-1 rounded-full bg-cream/40" />
          <span>2,000+ guests hosted</span>
          <span className="h-1 w-1 rounded-full bg-cream/40" />
          <span className="flex items-center gap-1.5">
            <IconCheck width={16} height={16} /> Instant confirmation
          </span>
        </div>
      </div>
    </section>
  );
}
