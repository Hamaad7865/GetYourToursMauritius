import { IconSearch } from '@/components/ui/icons';

/** GetYourGuide-style hero: full-bleed branded background, bold headline and a large
 *  search pill (a no-JS GET form to /activities). */
export function GygHero() {
  return (
    <section className="relative overflow-hidden bg-[radial-gradient(120%_120%_at_50%_-10%,#13a0a6_0%,#0E8C92_38%,#0B5C63_100%)]">
      <div
        aria-hidden
        className="absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(40rem 20rem at 15% 20%, rgba(255,255,255,0.25), transparent), radial-gradient(30rem 18rem at 85% 80%, rgba(247,108,94,0.35), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-shell px-6 pb-16 pt-14 text-center sm:pb-20 sm:pt-20">
        <h1 className="mx-auto max-w-4xl text-[clamp(34px,6vw,68px)] font-extrabold leading-[1.02] tracking-tight text-white">
          Discover &amp; book things to do
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] font-medium text-white/85 sm:text-base">
          Belle Mare Tours — Mauritius&apos; east coast, booked direct. Catamaran cruises, dolphin
          swims, island days and transfers.
        </p>

        <form
          method="get"
          action="/activities"
          className="mx-auto mt-8 flex max-w-2xl items-center gap-2 rounded-full bg-white p-2 shadow-[0_24px_60px_-24px_rgba(0,0,0,0.5)]"
        >
          <span className="grid h-10 w-10 shrink-0 place-items-center text-teal">
            <IconSearch width={22} height={22} />
          </span>
          <input
            type="search"
            name="q"
            placeholder="Find places and things to do"
            aria-label="Find places and things to do"
            className="min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-muted"
          />
          <button
            type="submit"
            className="shrink-0 rounded-full bg-teal px-6 py-3 text-[15px] font-bold text-white transition hover:bg-teal-dark"
          >
            Search
          </button>
        </form>
      </div>
    </section>
  );
}
