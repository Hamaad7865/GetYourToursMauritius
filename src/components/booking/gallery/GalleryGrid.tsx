'use client';

import { responsiveImage } from '@/lib/images/resize';
import { isVideoUrl } from '@/lib/media';
import { IconDownload, IconHeart, IconHeartFill, IconPlay } from '@/components/ui/icons';
import type { GalleryPhoto, TFn } from '@/lib/booking/gallery-view';

/* eslint-disable @next/next/no-img-element -- gallery photos are external Supabase URLs. */

/**
 * Justified photo grid (the handoff's flex-grow rows): each tile's grow factor is its aspect
 * ratio, so rows fill edge to edge at the toolbar's target height. Hover reveals download /
 * favourite; select mode swaps the overlay for a check ring. Real aspect ratios arrive with
 * each image's load; videos fall back to 16:9 until the lightbox measures them.
 */

const FALLBACK_RATIO = 1.5;

export function GalleryGrid({
  t,
  photos,
  rowHeight,
  selMode,
  selected,
  favs,
  ratios,
  onRatio,
  onOpen,
  onToggleFav,
  onToggleSelect,
  onDownload,
}: {
  t: TFn;
  photos: readonly GalleryPhoto[];
  rowHeight: number;
  selMode: boolean;
  selected: ReadonlySet<string>;
  favs: ReadonlySet<string>;
  ratios: Readonly<Record<string, number>>;
  onRatio: (id: string, ratio: number) => void;
  onOpen: (photo: GalleryPhoto) => void;
  onToggleFav: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onDownload: (photo: GalleryPhoto) => void;
}) {
  return (
    <div className="flex flex-wrap items-start gap-2">
      {photos.map((p, i) => {
        const video = isVideoUrl(p.url);
        const r = ratios[p.id] ?? (video ? 16 / 9 : FALLBACK_RATIO);
        const on = selected.has(p.id);
        const fav = favs.has(p.id);
        return (
          <div
            key={p.id}
            style={{
              flexGrow: Math.round(r * 100),
              flexBasis: `${Math.round(r * rowHeight)}px`,
              aspectRatio: String(r),
              animationDelay: `${Math.min(i, 16) * 40}ms`,
            }}
            className="animate-fade-up relative min-w-0 overflow-hidden rounded-[10px] bg-teal-tint"
          >
            {video ? (
              <video
                src={p.url}
                muted
                playsInline
                preload="metadata"
                onLoadedMetadata={(e) => {
                  const v = e.currentTarget;
                  if (v.videoWidth > 0) onRatio(p.id, v.videoWidth / v.videoHeight);
                }}
                className={`absolute inset-0 h-full w-full object-cover transition duration-200 ${
                  on ? 'scale-[0.93] rounded-lg' : ''
                }`}
              />
            ) : (
              <img
                {...responsiveImage(p.url, {
                  sizes: '(min-width: 640px) 380px, 50vw',
                  widths: [400, 800],
                })}
                alt=""
                loading="lazy"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  if (img.naturalWidth > 0) onRatio(p.id, img.naturalWidth / img.naturalHeight);
                }}
                className={`absolute inset-0 h-full w-full object-cover transition duration-200 ${
                  on ? 'scale-[0.93] rounded-lg' : ''
                }`}
              />
            )}
            {video && (
              <span className="pointer-events-none absolute bottom-2.5 left-2.5 flex items-center gap-1.5 rounded-full bg-ink/70 py-1 pl-2 pr-2.5 text-xs font-bold text-white">
                <IconPlay width={10} height={10} />
                {t('Video')}
              </span>
            )}
            {fav && !selMode && (
              <span className="pointer-events-none absolute right-2 top-2 grid h-[34px] w-[34px] place-items-center text-coral drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]">
                <IconHeartFill width={20} height={20} />
              </span>
            )}
            <div
              role={selMode ? 'checkbox' : undefined}
              aria-checked={selMode ? on : undefined}
              aria-label={selMode ? t('Select photo') : undefined}
              tabIndex={selMode ? 0 : -1}
              onClick={() => (selMode ? onToggleSelect(p.id) : onOpen(p))}
              onKeyDown={(e) => {
                if (selMode && (e.key === 'Enter' || e.key === ' ')) {
                  e.preventDefault();
                  onToggleSelect(p.id);
                }
              }}
              className={`absolute inset-0 rounded-[10px] transition duration-200 ${
                selMode
                  ? `cursor-pointer ${on ? 'bg-teal/10 ring-2 ring-inset ring-teal' : ''}`
                  : 'cursor-zoom-in opacity-0 hover:opacity-100 bg-gradient-to-b from-ink/50 via-ink/0 to-transparent'
              }`}
            >
              {!selMode && (
                <span className="absolute right-2 top-2 flex gap-1.5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDownload(p);
                    }}
                    aria-label={t('Download')}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/90 text-ink transition hover:bg-white"
                  >
                    <IconDownload width={16} height={16} />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onToggleFav(p.id);
                    }}
                    aria-label={fav ? t('Remove from favourites') : t('Add to favourites')}
                    className="grid h-[34px] w-[34px] place-items-center rounded-full bg-white/90 text-ink transition hover:bg-white"
                  >
                    {fav ? (
                      <IconHeartFill width={17} height={17} className="text-coral" />
                    ) : (
                      <IconHeart width={17} height={17} />
                    )}
                  </button>
                </span>
              )}
              {selMode && (
                <span
                  className={`absolute left-2.5 top-2.5 grid h-[26px] w-[26px] place-items-center rounded-full border-2 transition ${
                    on
                      ? 'border-teal bg-teal text-white'
                      : 'border-white bg-ink/30 text-transparent'
                  }`}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                      d="M5 12.8l4.2 4.2L19 7.2"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </span>
              )}
            </div>
          </div>
        );
      })}
      {/* Last-row filler so the final row left-aligns instead of stretching. */}
      <div className="h-0 flex-[100000] basis-0" />
    </div>
  );
}
