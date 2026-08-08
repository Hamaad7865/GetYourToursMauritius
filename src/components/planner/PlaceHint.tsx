'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import type { PlacePreview } from '@/lib/planner/place-lookup';
import { useT } from '@/components/site/PreferencesProvider';

/** Card width, also used to keep it inside the viewport horizontally. */
const CARD_W = 272;
/** Room the card needs above the word before it flips underneath. */
const CARD_H = 250;

/**
 * A place name ZilAi emphasised, showing its photos and description on hover.
 *
 * Rendered into `document.body` through a portal and positioned `fixed`: the chat pane is a scroller
 * inside a `rounded-[18px] overflow-hidden` column, and an absolutely-positioned card gets clipped by
 * both (the same trap the date-range popover hit). Positioning is recomputed on open and the card
 * closes on scroll, so it can never drift away from the word it belongs to.
 *
 * The trigger is a real button, so this works on touch (tap) and keyboard (focus), not just hover.
 */
export function PlaceHint({ label, preview }: { label: string; preview: PlacePreview }) {
  const t = useT();
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [box, setBox] = useState<{ top: number; left: number; above: boolean } | null>(null);
  const open = box !== null;

  const show = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const above = r.top > CARD_H;
    setBox({
      top: above ? r.top - 10 : r.bottom + 10,
      left: Math.min(Math.max(10, r.left - 10), Math.max(10, window.innerWidth - CARD_W - 10)),
      above,
    });
  }, []);
  const hide = useCallback(() => setBox(null), []);

  // A fixed card can't follow the word, so any scroll or resize dismisses it rather than leaving it
  // stranded mid-pane. Capture phase: the chat body scrolls, not the window.
  useEffect(() => {
    if (!open) return;
    const onScroll = () => hide();
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
    };
  }, [open, hide]);

  const meta = [preview.category, preview.region].filter(Boolean).join(' · ');
  const images = preview.images.slice(0, 3);

  const card = (
    <div
      id={id}
      role="tooltip"
      style={{
        position: 'fixed',
        top: box?.top,
        left: box?.left,
        width: CARD_W,
        transform: box?.above ? 'translateY(-100%)' : undefined,
        zIndex: 70,
      }}
      className="pointer-events-none animate-float-in overflow-hidden rounded-[14px] border border-[#E4EFED] bg-white shadow-[0_18px_44px_rgba(10,46,54,.22)]"
    >
      {images.length > 0 && (
        <div className={`grid gap-px bg-[#EAF2F1] ${images.length > 1 ? 'grid-cols-3' : ''}`}>
          {images.map((src, i) => (
            // eslint-disable-next-line @next/next/no-img-element -- proxied Google photo; next/image can't optimize an authenticated proxy route
            <img
              key={src}
              src={src}
              alt=""
              loading="lazy"
              className={`w-full object-cover ${images.length === 1 ? 'h-[112px]' : i === 0 ? 'col-span-3 h-[96px]' : 'h-[52px]'}`}
            />
          ))}
        </div>
      )}
      <div className="p-3">
        <div className="text-[13.5px] font-extrabold leading-tight text-ink">{preview.name}</div>
        {meta && (
          <div className="mt-0.5 text-[11px] font-bold uppercase tracking-[0.03em] text-ink-muted">
            {meta}
          </div>
        )}
        {preview.blurb && (
          <p className="m-0 mt-1.5 line-clamp-4 text-[12px] leading-[1.5] text-ink-muted">
            {preview.blurb}
          </p>
        )}
        {preview.facts.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {preview.facts.map((fact) => (
              <span
                key={fact}
                className="rounded-md bg-[#F1F6F5] px-[7px] py-0.5 text-[11px] font-bold text-ink-muted"
              >
                {fact}
              </span>
            ))}
          </div>
        )}
        {(preview.priceLabel || preview.ratingLabel) && (
          <div className="mt-2 flex items-center gap-2 border-t border-dashed border-[#E7EFEE] pt-2 text-[12px] font-bold">
            {preview.priceLabel && <span className="text-gold">{preview.priceLabel}</span>}
            {preview.ratingLabel && <span className="text-ink-muted">{preview.ratingLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <button
        ref={ref}
        type="button"
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        onClick={() => (open ? hide() : show())}
        aria-describedby={open ? id : undefined}
        aria-label={t('About {name}', { name: preview.name })}
        className="cursor-help rounded-[3px] font-bold text-ink underline decoration-teal/40 decoration-dotted underline-offset-[3px] transition-colors hover:decoration-teal focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal"
      >
        {label}
      </button>
      {preview.href ? (
        <Link
          href={preview.href}
          className="ml-1 align-middle text-[11px] font-bold text-coral underline-offset-2 hover:underline"
        >
          {t('view')}
        </Link>
      ) : null}
      {open && typeof document !== 'undefined' ? createPortal(card, document.body) : null}
    </>
  );
}
