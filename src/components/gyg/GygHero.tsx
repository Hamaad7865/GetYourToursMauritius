import type { ReactNode } from 'react';
import { IconShield, IconBolt, IconCheck, IconUsers } from '@/components/ui/icons';
import { HeroGallery } from './HeroGallery';

/**
 * Hero — "Explore Mauritius your way."
 *
 * An animated backdrop (pure CSS + inline SVG, no JS): a vertical teal depth gradient with
 * heavily-blurred, screen-blended radial "light" blobs that drift via transform — sunlight
 * wandering under turquoise water — plus one calm waterline wave. Under prefers-reduced-motion it
 * freezes to a composed still. The headline is an oversized Fraunces stack with "your way." in
 * italic; the open right side carries a sliding wall of real Belle Mare trip photos (HeroGallery).
 * The section is NOT clipped so the navbar search dropdowns spill over the white body below.
 */
export function GygHero({ children }: { children?: ReactNode }) {
  return (
    <section className="relative isolate flex min-h-[560px] flex-col justify-center overflow-visible lg:min-h-[620px]">
      {/* Image-free animated lagoon backdrop (server component, no JS). Every layer is -z-10,
          under the relative-z-10 content; `isolate` keeps the layers — and the blobs' screen
          blend — inside this section instead of escaping behind the white page body. */}
      {/* L1 — depth gradient: the water column (and the reduced-motion still). */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background:
            'linear-gradient(180deg,#072E34 0%,#0B5C63 26%,#0E8C92 54%,#0C6E74 80%,#083C42 100%)',
        }}
      />
      {/* L1b — sun-side brightener, pushed to the open-lagoon right. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(120% 90% at 74% 16%, rgba(19,160,166,0.55) 0%, transparent 55%)' }}
      />
      {/* L2 — drifting light mesh (the signature): blurred, screen-blended blobs, transform-only. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <span
          className="lagoon-blob"
          style={{
            width: '80vw',
            height: '80vw',
            right: '-12%',
            top: '16%',
            background: 'radial-gradient(circle, #13A0A6 0%, transparent 70%)',
            opacity: 0.5,
            filter: 'blur(82px)',
            animation: 'drift 34s ease-in-out -3s infinite alternate',
          }}
        />
        <span
          className="lagoon-blob"
          style={{
            width: '62vw',
            height: '62vw',
            right: '4%',
            top: '-10%',
            background: 'radial-gradient(circle, #57D6DB 0%, transparent 70%)',
            opacity: 0.42,
            filter: 'blur(78px)',
            animation: 'drift 40s ease-in-out -11s infinite alternate',
          }}
        />
        <span
          className="lagoon-blob"
          style={{
            width: '90vw',
            height: '90vw',
            left: '-20%',
            bottom: '-30%',
            background: 'radial-gradient(circle, #0E8C92 0%, transparent 70%)',
            opacity: 0.34,
            filter: 'blur(90px)',
            animation: 'drift 30s ease-in-out -7s infinite alternate-reverse',
          }}
        />
        <span
          className="lagoon-blob"
          style={{
            width: '46vw',
            height: '46vw',
            right: '8%',
            top: '-16%',
            background: 'radial-gradient(circle, #F76C5E 0%, transparent 70%)',
            opacity: 0.15,
            filter: 'blur(80px)',
            animation: 'drift 26s ease-in-out -5s infinite alternate',
          }}
        />
      </div>
      {/* L3 — front waterline wave: two stretched copies in a 200% track loop seamlessly. */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-40 overflow-hidden">
        <div className="lagoon-wave flex h-full w-[200%]">
          <svg className="h-full w-1/2" viewBox="0 0 1200 150" preserveAspectRatio="none" fill="rgba(7,46,52,0.72)">
            <path d="M0,80 C180,55 380,108 600,82 C820,56 1030,106 1200,80 L1200,150 L0,150 Z" />
          </svg>
          <svg className="h-full w-1/2" viewBox="0 0 1200 150" preserveAspectRatio="none" fill="rgba(7,46,52,0.72)">
            <path d="M0,80 C180,55 380,108 600,82 C820,56 1030,106 1200,80 L1200,150 L0,150 Z" />
          </svg>
        </div>
      </div>
      {/* L4 — legibility scrims (no blend mode), so the white content's contrast is unchanged. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-r from-ink/75 via-ink/40 to-transparent max-lg:bg-gradient-to-b max-lg:from-ink/25 max-lg:via-ink/55 max-lg:to-ink/80"
      />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-28 bg-gradient-to-b from-ink/55 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-44 bg-gradient-to-t from-ink/55 to-transparent" />
      {/* L5 — edge vignette to seat the edges / kill banding on cheap panels. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10"
        style={{ background: 'radial-gradient(130% 120% at 50% 120%, transparent 60%, rgba(10,46,54,0.35) 100%)' }}
      />

      <div className="relative z-10 mx-auto w-full max-w-shell px-6 pb-6 pt-32">
        <div className="lg:max-w-[58%]">
          <p className="animate-fade-up flex items-center gap-2.5 text-[13px] font-semibold uppercase tracking-[0.22em] text-white [text-shadow:0_1px_8px_rgba(10,46,54,0.6)]">
            <span className="relative grid h-2 w-2 place-items-center">
              <span aria-hidden className="absolute h-2 w-2 rounded-full bg-teal-bright motion-safe:animate-ping" />
              <span aria-hidden className="relative h-2 w-2 rounded-full bg-teal-bright" />
            </span>
            Belle Mare Tours · Mauritius
          </p>

          <h1 className="animate-fade-up mt-5 font-display text-5xl font-medium leading-[0.92] tracking-[-0.02em] text-white drop-shadow-[0_2px_16px_rgba(10,46,54,0.45)] [animation-delay:80ms] sm:text-6xl lg:text-7xl xl:text-[5.25rem]">
            Explore
            <br />
            Mauritius
            <br />
            <span className="font-semibold italic">your way.</span>
          </h1>

          <p className="animate-fade-up mt-6 max-w-md text-[16px] font-medium leading-relaxed text-white [text-shadow:0_1px_10px_rgba(10,46,54,0.65)] [animation-delay:160ms]">
            Book private tours, island activities and{' '}
            <span className="relative whitespace-nowrap">
              custom trips
              <span
                aria-hidden
                className="absolute -bottom-0.5 left-0 h-[3px] w-full rounded bg-coral/90"
              />
            </span>{' '}
            — with ease.
          </p>

          {/* The search now lives in the navbar; the hero carries just the message + proof. */}
          <ul className="animate-fade-up mt-8 flex flex-wrap gap-x-5 gap-y-2 text-[13px] font-medium text-white [text-shadow:0_1px_8px_rgba(10,46,54,0.6)] [animation-delay:240ms]">
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

      <HeroGallery />

      {children && <div className="relative pb-8">{children}</div>}
    </section>
  );
}
