import type { ReactNode } from 'react';
import { SearchBar } from './SearchBar';

/** GetYourGuide-style hero: full-bleed branded background, bold headline and the
 *  interactive search (query + date picker + travellers). The section is NOT clipped so
 *  the search dropdowns can spill over the content below, like GetYourGuide. An optional
 *  slot below the search hosts the "Continue planning" rail, so it lives in the hero. */
export function GygHero({ children }: { children?: ReactNode }) {
  return (
    <section className="relative bg-[radial-gradient(120%_120%_at_50%_-20%,#EAF7F5_0%,#F4FAFA_45%,#ffffff_100%)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden opacity-50"
        style={{
          backgroundImage:
            'radial-gradient(36rem 18rem at 12% 12%, rgba(14,140,146,0.10), transparent), radial-gradient(28rem 16rem at 88% 80%, rgba(247,108,94,0.10), transparent)',
        }}
      />
      <div className="relative mx-auto max-w-shell px-6 pb-10 pt-32 text-center sm:pt-40">
        <h1 className="mx-auto max-w-4xl text-[clamp(34px,6vw,68px)] font-extrabold leading-[1.02] tracking-tight text-ink">
          Discover &amp; book things to do
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-[15px] font-medium text-ink/70 sm:text-base">
          Belle Mare Tours — Mauritius&apos; east coast, booked direct. Catamaran cruises, dolphin
          swims, island days and transfers.
        </p>

        <SearchBar variant="hero" />
      </div>

      {children && <div className="relative pb-12">{children}</div>}
    </section>
  );
}
