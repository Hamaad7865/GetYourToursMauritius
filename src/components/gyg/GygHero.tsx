import type { ReactNode } from 'react';
import { SearchBar } from './SearchBar';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/** Hero with a full-bleed Mauritius photo, a soft dark scrim for legibility, the tagline and
 *  the interactive search (query + date picker + travellers). The section is NOT clipped so
 *  the search dropdowns can spill over the content below. */
export function GygHero({ children }: { children?: ReactNode }) {
  return (
    <section className="relative isolate flex min-h-[440px] flex-col justify-center overflow-visible">
      <img
        src="/hero-mauritius.jpg"
        alt="Aerial view of Le Morne, Mauritius — turquoise lagoon and beach"
        className="absolute inset-0 -z-10 h-full w-full object-cover"
      />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-gradient-to-b from-ink/45 via-ink/25 to-ink/55"
      />

      <div className="relative mx-auto w-full max-w-shell px-6 pb-6 pt-28 text-center sm:pt-32">
        <p className="mx-auto max-w-xl text-[16px] font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.4)]">
          Belle Mare Tours — Mauritius&apos; east coast, booked direct. Catamaran cruises, dolphin
          swims, island days and transfers.
        </p>

        <SearchBar variant="hero" />
      </div>

      {children && <div className="relative pb-8">{children}</div>}
    </section>
  );
}
