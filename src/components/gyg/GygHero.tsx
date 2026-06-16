import type { ReactNode } from 'react';
import { SearchBar } from './SearchBar';
import { IconShield, IconBolt, IconCheck, IconUsers } from '@/components/ui/icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * Hero — "The east-coast lagoon, booked direct."
 *
 * A full-bleed Mauritius lagoon photo with a DIRECTIONAL scrim: the dark mass sits under the
 * left-aligned type column while the turquoise lagoon stays vivid on the right (the view
 * you're booking), rather than a flat all-over wash. The headline is an oversized Fraunces
 * stack with the single word "lagoon," set in italic — the one place boldness is spent. The
 * search is docked flush-left as the column's baseline; teal and coral are each rationed to
 * two appearances. The section is NOT clipped so the search dropdowns can spill over the
 * white body below.
 */
export function GygHero({ children }: { children?: ReactNode }) {
  return (
    <section className="relative flex min-h-[560px] flex-col justify-center overflow-visible lg:min-h-[620px]">
      <img
        src="/hero-mauritius.jpg"
        alt="Aerial view of a turquoise Mauritius lagoon and white-sand beach"
        className="absolute inset-0 h-full w-full object-cover object-[62%_center]"
      />
      {/* Directional scrim: dark under the left type column, open lagoon on the right.
          On mobile (no right-side breathing room) it flips to a bottom-weighted gradient. */}
      <div
        aria-hidden
        className="absolute inset-0 bg-gradient-to-r from-ink/75 via-ink/40 to-transparent max-lg:bg-gradient-to-b max-lg:from-ink/25 max-lg:via-ink/55 max-lg:to-ink/80"
      />
      {/* Short top fade so the white logo + nav read — not a full dark band. */}
      <div aria-hidden className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-ink/55 to-transparent" />
      {/* Contrast pad under the search pill + chips. */}
      <div aria-hidden className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-ink/55 to-transparent" />

      <div className="relative z-10 mx-auto w-full max-w-shell px-6 pb-12 pt-32">
        <div className="lg:max-w-[58%]">
          <p className="animate-fade-up flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.22em] text-white [text-shadow:0_1px_8px_rgba(10,46,54,0.6)]">
            <span className="relative grid h-2 w-2 place-items-center">
              <span aria-hidden className="absolute h-2 w-2 rounded-full bg-teal-bright motion-safe:animate-ping" />
              <span aria-hidden className="relative h-2 w-2 rounded-full bg-teal-bright" />
            </span>
            Belle Mare · Mauritius East Coast
          </p>

          <h1 className="animate-fade-up mt-5 font-display text-5xl font-medium leading-[0.92] tracking-[-0.02em] text-white drop-shadow-[0_2px_16px_rgba(10,46,54,0.45)] [animation-delay:80ms] sm:text-6xl lg:text-7xl xl:text-[5.25rem]">
            The east-coast
            <br />
            <span className="font-semibold italic">lagoon,</span>
            <br />
            booked direct.
          </h1>

          <p className="animate-fade-up mt-6 max-w-md text-[16px] font-medium leading-relaxed text-white [text-shadow:0_1px_10px_rgba(10,46,54,0.65)] [animation-delay:160ms]">
            Catamaran days to Île aux Cerfs, dolphin swims, sea-walks and parasailing — reserved
            straight with the local crew who run the boats.{' '}
            <span className="relative whitespace-nowrap">
              No reseller
              <span
                aria-hidden
                className="absolute -bottom-0.5 left-0 h-[3px] w-full rounded bg-coral/90"
              />
            </span>
            , no markup.
          </p>

          {/* Strip SearchBar's built-in centering so the pill aligns flush-left to the headline.
              `relative z-30` keeps the search + its date/travellers dropdowns above the trust
              chips below (every hero element animates a transform, so without this the later
              chips' stacking context paints over the open calendar). */}
          <div className="animate-fade-up relative z-30 mt-7 [animation-delay:240ms] [&>div]:!mx-0 [&>div]:!mt-0 [&>div]:!max-w-2xl">
            <SearchBar variant="hero" />
          </div>

          <ul className="animate-fade-up relative z-0 mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-white [text-shadow:0_1px_8px_rgba(10,46,54,0.6)] [animation-delay:320ms]">
            <li className="flex items-center gap-1.5">
              <IconShield width={14} height={14} /> Booked direct with the local operator
            </li>
            <li className="flex items-center gap-1.5">
              <IconBolt width={14} height={14} /> Instant confirmation
            </li>
            <li className="flex items-center gap-1.5">
              <IconCheck width={14} height={14} /> Free cancellation up to 24h
            </li>
            <li className="flex items-center gap-1.5 max-sm:hidden">
              <IconUsers width={14} height={14} /> Belle Mare&apos;s own crew
            </li>
          </ul>
        </div>
      </div>

      {children && <div className="relative pb-8">{children}</div>}
    </section>
  );
}
