'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { IconChat } from '@/components/ui/icons';

/**
 * One hotel, fully resolved by the server.
 *
 * Everything that needs translation or URL-building is a finished STRING here — `enquiryHref` and
 * `position` in particular. React Server Components cannot serialise a function across the
 * boundary ("Functions cannot be passed directly to Client Components"), so the tempting shape —
 * handing this component a `position(n, total)` formatter and an `enquiry(name)` builder — throws
 * at render. Resolving server-side also keeps `whatsappUrl` and the translator out of the client
 * bundle, which is the better outcome anyway.
 */
export interface RailHotel {
  slug: string;
  name: string;
  description: string;
  /** Index into `groups` — which stretch of coast this hotel sits on. */
  group: number;
  /** Bare range, e.g. "45–60". The unit comes from `labels.minutes`. */
  airportMinutes: string;
  /** Pre-built WhatsApp deep link naming this hotel. */
  enquiryHref: string;
  /** Pre-formatted "3 of 14 · 7 in this group", already localised. */
  position: string;
  /** This hotel's own /airport-transfers/<slug> page, or the hub where we don't run one. */
  href: string;
  /**
   * A photograph OF THIS HOTEL, or null for the typographic card — a designed state, not a gap.
   *
   * Never a picture of the surrounding area: that was tried and rejected, because a beach under a
   * hotel's name reads as that hotel. `credit` is null for our own and permissioned files, and
   * required for anything from Commons — CC BY and CC BY-SA both oblige us to name the author and
   * the licence, which a bare "via Wikimedia Commons" does not do.
   */
  photo: {
    src: string;
    alt: string;
    credit: { author: string; licence: string; source: string } | null;
  } | null;
}

export interface RailGroup {
  area: string;
  blurb: string;
}

/**
 * The depth geometry of the coverflow, straight from the source design.
 *
 * `step` is the horizontal gap between neighbours, `depth` how far each rank recedes on Z, and
 * `rotation` the Y-rotation per rank — so card n sits at (n·step, −|n|·depth, −n·rotation°) and the
 * selected card is the only one square to the viewer. The three breakpoints are the design's own:
 * on a phone the fan has to tighten or the neighbours leave the screen entirely.
 */
function geometry(width: number): { step: number; depth: number; rotation: number } {
  if (width < 700) return { step: 118, depth: 250, rotation: 22 };
  if (width < 1100) return { step: 190, depth: 340, rotation: 29 };
  return { step: 248, depth: 340, rotation: 29 };
}

/** Ranks further than this from the selected card are fully transparent and non-interactive. */
const VISIBLE_RANKS = 3;

/**
 * "Where to stay" for /belle-mare: the fourteen hotels we collect from, as a 3D coverflow filtered
 * by which stretch of coast they sit on, with a detail panel that turns the selected hotel into a
 * pre-filled WhatsApp pickup enquiry.
 *
 * WHY A COVERFLOW. The commercial job of this section is not "list hotels" — the grid on the old
 * /destinations/belle-mare already did that. It is to get a guest to say WHICH hotel, so the
 * enquiry that follows already names the gate. The fan makes exactly one hotel the subject and
 * gives that subject a CTA; fourteen equal cards have no subject.
 *
 * LAYOUT IS WRITTEN TO THE DOM, NOT TO REACT STATE. Fourteen cards each needing a transform,
 * opacity, z-index, filter and border colour derived from their distance to the selection is
 * exactly the case where re-rendering every card per keystroke is wasteful and janky. `layout()`
 * walks the cards once and sets styles directly; React owns only `active`. The CSS `transition` on
 * each card then does the animating, which keeps it on the compositor.
 *
 * REDUCED MOTION. The fan is POSITION, not motion, so it stays — flattening it would throw away the
 * design for no accessibility gain. What goes is the travel between positions: the transition is
 * dropped so a selection change lands instantly. Same treatment as the arrow-key and tab jumps.
 */
export function HotelRail({
  groups,
  hotels,
  labels,
}: {
  groups: RailGroup[];
  hotels: RailHotel[];
  /** Plain strings only — see the note on RailHotel about the server/client boundary. */
  labels: {
    minutes: string;
    airport: string;
    selected: string;
    quote: string;
    prices: string;
    elsewhere: string;
    elsewhereLink: string;
    previous: string;
    next: string;
    choose: string;
    /** Prefix for the photo credit line, e.g. "Photo:". */
    photo: string;
  };
}) {
  const [active, setActive] = useState(0);
  const stage = useRef<HTMLDivElement | null>(null);
  const rail = useRef<HTMLDivElement | null>(null);

  /** Position every card relative to the selection. Called on mount, on selection and on resize. */
  const layout = useCallback(() => {
    const el = stage.current;
    if (!el) return;
    const cards = el.querySelectorAll<HTMLElement>('[data-card]');
    const { step, depth, rotation } = geometry(window.innerWidth);
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    cards.forEach((card, i) => {
      const offset = i - active;
      const rank = Math.abs(offset);
      const hidden = rank > VISIBLE_RANKS;
      card.style.transition = still
        ? 'none'
        : 'transform .85s cubic-bezier(.2,.9,.25,1), opacity .6s, filter .6s, border-color .4s';
      card.style.transform = `translateX(${(offset * step).toFixed(0)}px) translateZ(${(-rank * depth).toFixed(0)}px) rotateY(${(-offset * rotation).toFixed(1)}deg)`;
      card.style.opacity = hidden ? '0' : String(Math.max(0, 1 - rank * 0.19));
      card.style.zIndex = String(200 - rank * 10);
      card.style.filter =
        rank === 0
          ? 'none'
          : `brightness(${(1 - rank * 0.13).toFixed(2)}) saturate(${(1 - rank * 0.12).toFixed(2)})`;
      // Literal rgba, NOT `rgb(var(--color-teal-bright))`. The CSSOM accepts a var() in an inline
      // style (it is only substituted later), but when this one resolves the declaration turns out
      // to be invalid at computed-value time and the border silently falls back to Tailwind's
      // default grey — visible as a selected card with no highlight at all. The channels are
      // brand teal-bright (#13A0A6); keep them in step with globals.css.
      card.style.borderColor = rank === 0 ? 'rgba(19,160,166,.75)' : 'rgba(255,255,255,.12)';
      // A card the viewer cannot see must not be tabbable or clickable, or keyboard focus walks
      // off into the invisible tail of the fan.
      card.style.pointerEvents = hidden ? 'none' : 'auto';
      card.tabIndex = hidden ? -1 : 0;
      card.setAttribute('aria-hidden', hidden ? 'true' : 'false');
    });
  }, [active]);

  useEffect(() => {
    layout();
    window.addEventListener('resize', layout);
    // Fonts and the lazy card images settle after first paint and can change card height; one
    // late pass keeps the fan aligned without polling.
    const settle = setTimeout(layout, 400);
    return () => {
      window.removeEventListener('resize', layout);
      clearTimeout(settle);
    };
  }, [layout]);

  const move = useCallback(
    (delta: number) => setActive((i) => Math.max(0, Math.min(hotels.length - 1, i + delta))),
    [hotels.length],
  );

  /** Left/right arrows drive the fan, but only while it is actually on screen. */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      const el = rail.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      if (box.bottom < 120 || box.top > window.innerHeight - 120) return;
      event.preventDefault();
      move(event.key === 'ArrowLeft' ? -1 : 1);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [move]);

  // `noUncheckedIndexedAccess` is on, so every lookup here is total. The caller already guards on a
  // non-empty roster; falling back to index 0 (and bailing on a genuinely empty one) keeps that a
  // compile-time fact rather than a convention two files apart.
  const hotel = hotels[active] ?? hotels[0];
  if (!hotel) return null;
  const group = groups[hotel.group] ?? { area: '', blurb: '' };

  const arrow =
    'absolute top-[42%] z-[300] grid h-[46px] w-[46px] place-items-center rounded-full border border-white/25 bg-ink/55 text-white backdrop-blur-md transition hover:border-teal-bright hover:bg-teal-bright hover:text-ink disabled:pointer-events-none disabled:opacity-30';

  return (
    <>
      {/* Tabs and the detail panel sit in the page shell; only the STAGE between them is full-bleed,
          so the fan's tail can run off the screen edge instead of stopping at a container. That
          overrun is what sells the depth, and it is why this component owns its own gutters rather
          than being dropped inside one wrapper. */}
      <div className="mx-auto max-w-shell px-6">
        {/* Coast groups. `aria-pressed` rather than a tablist: these jump the fan, they do not swap
            panels, and announcing them as tabs would promise a relationship that is not there. */}
        <div className="mt-9 flex flex-wrap gap-2">
          {groups.map((g, i) => {
            const on = hotel.group === i;
            return (
              <button
                key={g.area}
                type="button"
                aria-pressed={on}
                onClick={() => setActive(hotels.findIndex((h) => h.group === i))}
                className={`rounded-full border px-4 py-2.5 text-[13px] font-bold transition ${
                  on
                    ? 'border-teal-bright bg-teal-bright text-ink'
                    : 'border-white/20 text-white/70 hover:border-teal-bright/60 hover:text-white'
                }`}
              >
                {g.area}
              </button>
            );
          })}
        </div>
        <p className="mt-4 min-h-[44px] max-w-[620px] text-[14px] leading-[1.65] text-teal-tint/80">
          {group.blurb}
        </p>
      </div>

      {/* The stage. Full-bleed of the shell so the fan's tail runs off the screen edge rather than
          stopping at a container boundary — that overrun is what sells the depth. */}
      <div
        ref={rail}
        className="relative mt-7 h-[clamp(430px,54vw,530px)] [perspective-origin:50%_42%] [perspective:1700px]"
      >
        <div ref={stage} className="absolute inset-0 [transform-style:preserve-3d]">
          {hotels.map((h, i) => (
            <div
              key={h.slug}
              data-card
              role="button"
              tabIndex={0}
              aria-label={`${labels.choose}: ${h.name}`}
              aria-current={i === active}
              onClick={() => setActive(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setActive(i);
                }
              }}
              style={{
                width: 'clamp(250px, 27vw, 330px)',
                marginLeft: 'clamp(-165px, -13.5vw, -125px)',
                boxShadow: '0 50px 90px -34px rgba(0,0,0,.8)',
              }}
              className="absolute left-1/2 top-0 cursor-pointer overflow-hidden rounded-md border border-white/10 bg-[#0C2E38] [transform-style:preserve-3d] [will-change:transform,opacity] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-bright"
            >
              <div className="relative aspect-[4/3] w-full overflow-hidden bg-[linear-gradient(135deg,#0B5C63_0%,#0A2E36_100%)]">
                {h.photo ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={h.photo.src}
                    alt={h.photo.alt}
                    className="h-full w-full object-cover"
                    loading="lazy"
                  />
                ) : (
                  /* No photograph of this property that we are allowed to publish. Rather than a
                     grey box — or a stand-in picture of somewhere else — the card sets the hotel's
                     initial at display scale. See src/lib/content/hotel-photos.ts. */
                  <span
                    aria-hidden
                    className="absolute inset-0 flex items-center justify-center text-[72px] font-extrabold leading-none tracking-tight text-white/10"
                  >
                    {h.name.trim().charAt(0)}
                  </span>
                )}
              </div>
              <div className="px-[18px] pb-5 pt-[18px]">
                <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-teal-bright">
                  {groups[h.group]?.area}
                </p>
                <p className="mt-2.5 text-[clamp(19px,2vw,24px)] font-extrabold leading-[1.14] tracking-tight text-white">
                  {h.name}
                </p>
                <p className="mt-3 flex items-center justify-between gap-2.5 border-t border-white/10 pt-3 text-[12px] text-white/60">
                  <span>{labels.airport}</span>
                  <span className="font-bold text-teal-tint">
                    {h.airportMinutes} {labels.minutes}
                  </span>
                </p>
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => move(-1)}
          disabled={active === 0}
          aria-label={labels.previous}
          className={`${arrow} left-[3vw]`}
        >
          ←
        </button>
        <button
          type="button"
          onClick={() => move(1)}
          disabled={active === hotels.length - 1}
          aria-label={labels.next}
          className={`${arrow} right-[3vw]`}
        >
          →
        </button>
      </div>

      {/* Detail panel. `aria-live` because selecting a card changes this text without moving focus —
          a screen-reader user who activates a card would otherwise get no feedback at all. */}
      <div aria-live="polite" className="mx-auto mt-8 max-w-shell px-6">
        {/* The rule sits inside the gutter, so it spans the content column rather than the padding. */}
        <div className="grid gap-8 border-t border-white/15 pt-8 sm:grid-cols-2 sm:gap-14">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.26em] text-white/45">
              {labels.selected}
            </p>
            <p className="mt-3 text-[clamp(26px,3.4vw,44px)] font-extrabold leading-[1.06] tracking-tight text-white">
              {hotel.name}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <span className="rounded-full border border-teal-bright/30 bg-teal-bright/10 px-3.5 py-1.5 text-[12px] font-semibold text-teal-tint">
                {labels.airport} {hotel.airportMinutes} {labels.minutes}
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[12px] font-semibold text-white/75">
                {group.area}
              </span>
              <span className="rounded-full border border-white/15 bg-white/[0.07] px-3.5 py-1.5 text-[12px] font-semibold text-white/75">
                {hotel.position}
              </span>
            </div>
          </div>
          <div>
            <p className="text-[16px] leading-[1.78] text-white/75">{hotel.description}</p>
            <div className="mt-6 flex flex-wrap gap-3">
              <a
                href={hotel.enquiryHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full bg-coral px-6 py-3.5 text-sm font-bold text-white shadow-[0_16px_36px_-14px_rgba(247,108,94,0.75)] transition hover:bg-[#ff8259]"
              >
                <IconChat width={17} height={17} /> {labels.quote}
              </a>
              {/* The selected hotel's OWN transfer page — real fares, distance, map and FAQ for
                  that property. Falls back to the hub for the one we do not run a page for. */}
              <Link
                href={hotel.href}
                className="inline-flex items-center gap-2 rounded-full border border-white/25 px-6 py-3.5 text-sm font-bold text-white transition hover:border-teal-bright hover:text-teal-tint"
              >
                {labels.prices}
              </Link>
            </div>

            {/* Attribution for the selected card's photo. CC BY and CC BY-SA both require naming
                the author AND the licence, so this cannot shrink to a bare "via Commons" link. */}
            {hotel.photo?.credit && (
              <p className="mt-4 text-[11.5px] text-white/40">
                {labels.photo}{' '}
                <a
                  href={hotel.photo.credit.source}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="underline decoration-white/25 hover:text-white/70"
                >
                  {hotel.photo.credit.author}
                </a>{' '}
                · {hotel.photo.credit.licence}
              </p>
            )}
            <p className="mt-5 text-[14px] leading-relaxed text-white/50">
              {labels.elsewhere}{' '}
              <Link href="/contact" className="font-bold text-teal-tint hover:underline">
                {labels.elsewhereLink}
              </Link>
              .
            </p>
          </div>
        </div>
      </div>
    </>
  );
}
