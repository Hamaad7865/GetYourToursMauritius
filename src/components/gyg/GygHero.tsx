import { HeroSearch } from './HeroSearch';

/** GetYourGuide-style hero: full-bleed branded background, bold headline and the
 *  interactive search (query + date picker + travellers). The section is NOT clipped so
 *  the search dropdowns can spill over the content below, like GetYourGuide. */
export function GygHero() {
  return (
    <section className="relative bg-[radial-gradient(120%_120%_at_50%_-10%,#13a0a6_0%,#0E8C92_38%,#0B5C63_100%)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(40rem 20rem at 15% 20%, rgba(255,255,255,0.25), transparent), radial-gradient(30rem 18rem at 85% 80%, rgba(247,108,94,0.35), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-shell px-6 pb-16 pt-32 text-center sm:pb-20 sm:pt-40">
        <h1 className="mx-auto max-w-4xl text-[clamp(34px,6vw,68px)] font-extrabold leading-[1.02] tracking-tight text-white">
          Discover &amp; book things to do
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] font-medium text-white/85 sm:text-base">
          Belle Mare Tours — Mauritius&apos; east coast, booked direct. Catamaran cruises, dolphin
          swims, island days and transfers.
        </p>

        <HeroSearch />
      </div>
    </section>
  );
}
