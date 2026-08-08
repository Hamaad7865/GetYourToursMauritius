'use client';

import { useEffect, useRef } from 'react';

/**
 * The /belle-mare opening frame: a sky-to-lagoon gradient with the beach photo floating over it and
 * the place name set at display scale.
 *
 * Deliberately the only hero on the site that does not use InfoPage's teal band — this is the page
 * the brand is named after and the one URL we most need to own, so it gets a composed frame. It
 * still resolves to brand tokens: the gradient runs teal-tint → teal-bright → teal-dark → ink, so
 * the section below can start on ink with no visible seam.
 *
 * MOTION. Two separate mechanisms, and they fail differently, so they are handled separately:
 *
 *  - Entrances are CSS keyframes (`.bm-rise` in globals.css) with `animation-fill-mode: both`. They
 *    run without JS and the reduced-motion query cancels them by restating the FINAL state — never
 *    by setting `animation: none` alone, which freezes an opacity-0 first frame and blanks the hero.
 *  - Parallax is JS, because it tracks scroll. It is gated on the same query and, critically, the
 *    effect CLEARS every transform it set when it tears down. A media-query flip that leaves stale
 *    inline transforms behind is the same blank-hero bug by another route.
 *
 * With JS off, the markup renders in its final position: the layers simply never move.
 */
export function BelleMareHero({
  eyebrow,
  nameLines,
  intro,
  photo,
  photoAlt,
  photoCredit,
  scrollCue,
}: {
  eyebrow: string;
  /** The place name split for display, e.g. ['Belle', 'Mare'] — line two is offset and tinted. */
  nameLines: [string, string];
  intro: string;
  photo: string;
  photoAlt: string;
  /** Commons attribution for `photo`, when it is a Wikimedia file. */
  photoCredit?: { label: string; href: string };
  scrollCue: string;
}) {
  const root = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const layers = Array.from(el.querySelectorAll<HTMLElement>('[data-bm-parallax]'));

    let frame = 0;
    const paint = () => {
      frame = 0;
      // Only the hero's own travel matters; past its height the layers are off-screen anyway.
      const y = Math.min(window.scrollY || 0, el.offsetHeight);
      for (const layer of layers) {
        const depth = Number(layer.dataset.bmParallax) || 0;
        const scale = layer.dataset.bmScale ? 1 + Math.min(y, 700) * 0.00018 : 1;
        layer.style.transform = `translate3d(0, ${(y * depth).toFixed(1)}px, 0) scale(${scale.toFixed(4)})`;
      }
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };

    const clear = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      window.removeEventListener('scroll', onScroll);
      // Hand every layer back to the stylesheet, or a reduced-motion flip strands it mid-parallax.
      for (const layer of layers) layer.style.transform = '';
    };

    const apply = () => {
      clear();
      if (query.matches) return;
      window.addEventListener('scroll', onScroll, { passive: true });
      paint();
    };

    apply();
    query.addEventListener('change', apply);
    return () => {
      clear();
      query.removeEventListener('change', apply);
    };
  }, []);

  return (
    <section
      ref={root}
      className="relative isolate flex h-[88svh] min-h-[560px] items-center overflow-hidden bg-[linear-gradient(180deg,#EAF7F5_0%,#8FD4D6_22%,#13A0A6_48%,#0B5C63_74%,#0A2E36_100%)]"
    >
      {/* Sun haze, then the reef line and its shadow — the horizon reads as depth, not decoration. */}
      <div
        data-bm-parallax="0.44"
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-[14%] h-[60%] bg-[radial-gradient(120%_90%_at_50%_0%,#FFFFFF_0%,#EAF7F5_38%,rgba(234,247,245,0)_72%)] will-change-transform"
      />
      <div
        data-bm-parallax="0.34"
        aria-hidden
        className="pointer-events-none absolute -inset-x-[6%] top-[33%] h-[3px] bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.75),transparent)] blur-[1px] will-change-transform"
      />

      {/* The photo, floating. Sits between the horizon and the headline so the text overlaps it.
          NOT aria-hidden: on the page we most want to rank for this place, the one photograph of
          the beach is content, and it carries a real alt. Only its tint overlay is decorative. */}
      <div
        data-bm-parallax="0.14"
        data-bm-scale="1"
        className="absolute left-1/2 top-[20%] h-[min(520px,50vh)] w-[min(1120px,84vw)] -translate-x-1/2 overflow-hidden rounded-3xl shadow-[0_60px_120px_-40px_rgba(3,26,34,0.85)] will-change-transform"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo} alt={photoAlt} className="h-full w-full object-cover" />
        <div
          aria-hidden
          className="absolute inset-0 bg-[linear-gradient(180deg,rgba(10,46,54,0.10)_0%,rgba(10,46,54,0)_38%,rgba(10,46,54,0.55)_100%)]"
        />
      </div>

      {/* Headline. `pointer-events-none` on the stack, restored on the credit link below. */}
      <div className="pointer-events-none relative mx-auto w-full max-w-shell px-6">
        <p className="bm-rise text-[12px] font-bold uppercase tracking-[0.3em] text-white [animation-delay:0.05s] [text-shadow:0_2px_18px_rgba(2,22,24,0.7)]">
          {eyebrow}
        </p>
        <h1 className="mt-3 font-extrabold leading-[0.84] tracking-tight text-white [text-shadow:0_14px_60px_rgba(4,20,26,0.55)]">
          <span className="bm-rise block text-[clamp(56px,14vw,196px)] [animation-delay:0.15s]">
            {nameLines[0]}
          </span>
          <span className="bm-rise ml-[clamp(24px,11vw,190px)] block text-[clamp(56px,14vw,196px)] text-teal-tint [animation-delay:0.27s]">
            {nameLines[1]}
          </span>
        </h1>
        <p className="bm-rise mt-6 max-w-md text-[15px] leading-relaxed text-white/90 [animation-delay:0.42s] [text-shadow:0_2px_16px_rgba(2,22,24,0.75)]">
          {intro}
        </p>
      </div>

      {/* Bottom fade — joins the ink section below with no seam at any viewport height. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -inset-x-[8%] -bottom-[12%] h-[32%] bg-[linear-gradient(180deg,rgba(10,46,54,0)_0%,#0A2E36_62%)] blur-[3px]"
      />

      <p className="absolute bottom-6 left-1/2 flex -translate-x-1/2 flex-col items-center gap-2 text-[10px] font-bold uppercase tracking-[0.28em] text-white/75 motion-safe:animate-[bmCue_2.2s_ease-in-out_infinite]">
        {scrollCue}
        <span
          aria-hidden
          className="h-7 w-px bg-[linear-gradient(180deg,rgba(255,255,255,0.8),transparent)]"
        />
      </p>

      {photoCredit && (
        <a
          href={photoCredit.href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="absolute bottom-3 right-4 text-[10px] text-white/55 underline decoration-white/30 hover:text-white"
        >
          {photoCredit.label}
        </a>
      )}
    </section>
  );
}
