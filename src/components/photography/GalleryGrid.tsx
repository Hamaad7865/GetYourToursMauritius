'use client';

import { responsiveImage } from '@/lib/images/resize';
import { PHOTO_CARD } from '@/lib/images/presets';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useT } from '@/components/site/PreferencesProvider';
import { GALLERY_TAGS, videoSource, type GalleryTag } from '@/lib/catalogue/photography';
import { IconChevronLeft, IconChevronRight, IconX } from '@/components/ui/icons';

/** One tile: a photo, or a video (an uploaded file or a YouTube / Vimeo link). */
export interface GalleryItem {
  key: string;
  kind: 'image' | 'video';
  /** The photo, or the video's URL. */
  src: string;
  /** What the tile shows before anything plays (the photo, a video's cover, a YouTube frame). */
  thumb: string | null;
  alt: string;
  categories: GalleryTag[];
  /** Tailwind aspect class — mixed ratios make the masonry read as a contact sheet. */
  aspect: string;
}

type Filter = GalleryTag | 'all';

const TAB_LABEL: Record<Filter, string> = {
  all: 'All',
  weddings: 'Weddings',
  films: 'Films',
  couples: 'Couples',
  family: 'Family',
};

/**
 * The photography gallery: category tabs, a CSS-columns masonry, and a full-screen viewer that
 * steps through the filtered set (arrow keys / swipe / Esc) and PLAYS videos in place — an uploaded
 * file natively, a YouTube or Vimeo link through the provider's no-cookie / player embed, loaded only
 * when opened so the page stays light.
 *
 * `syncUrl` keeps the chosen category in `?c=` (the gallery page), so a link can open on one
 * category; `limit` shows the first N on /photography with a link on to the full page.
 */
export function GalleryGrid({
  items,
  limit,
  initialFilter = 'all',
  syncUrl = false,
  tone = 'dark',
}: {
  items: GalleryItem[];
  limit?: number;
  initialFilter?: Filter;
  syncUrl?: boolean;
  tone?: 'dark' | 'light';
}) {
  const t = useT();
  const [filter, setFilter] = useState<Filter>(initialFilter);
  const [open, setOpen] = useState<number | null>(null);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = {
      all: items.length,
      weddings: 0,
      films: 0,
      couples: 0,
      family: 0,
    };
    for (const it of items) for (const tag of it.categories) c[tag] += 1;
    return c;
  }, [items]);
  // Only offer tabs that have something in them (All always).
  const tabs: Filter[] = ['all', ...GALLERY_TAGS.filter((g) => counts[g] > 0)];
  const filtered = filter === 'all' ? items : items.filter((i) => i.categories.includes(filter));
  const visible = limit ? filtered.slice(0, limit) : filtered;

  function choose(next: Filter) {
    setFilter(next);
    if (syncUrl) {
      const url = new URL(window.location.href);
      if (next === 'all') url.searchParams.delete('c');
      else url.searchParams.set('c', next);
      window.history.replaceState(null, '', url);
    }
  }

  return (
    <>
      {tabs.length > 1 && (
        <div
          role="tablist"
          aria-label={t('Gallery categories')}
          className={`mx-auto mt-8 flex w-fit max-w-full gap-1 overflow-x-auto rounded-lg p-1.5 ${tone === 'light' ? 'bg-teal-tint/50' : 'bg-white/[0.06]'}`}
        >
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={filter === tab}
              onClick={() => choose(tab)}
              className={`whitespace-nowrap rounded-full px-5 py-2 text-sm font-bold transition ${
                filter === tab
                  ? tone === 'light'
                    ? 'bg-teal-dark text-white'
                    : 'bg-white text-ink'
                  : tone === 'light'
                    ? 'text-ink-muted hover:text-teal-dark'
                    : 'text-white/70 hover:text-white'
              }`}
            >
              {t(TAB_LABEL[tab])}
              <span className="ml-1.5 text-[12px] opacity-70">{counts[tab]}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-8 columns-1 gap-5 sm:columns-2 lg:columns-3 [&>*]:mb-5">
        {visible.map((item, i) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setOpen(i)}
            aria-label={
              item.kind === 'video'
                ? t('Play video: {title}', { title: item.alt })
                : t('Open photo: {title}', { title: item.alt })
            }
            className="group relative block w-full break-inside-avoid overflow-hidden rounded-2xl bg-white/5 text-left outline-none ring-teal-bright focus-visible:ring-2"
          >
            <Tile item={item} />
            {item.kind === 'video' && (
              <span
                aria-hidden
                className="absolute inset-0 grid place-items-center bg-ink/20 transition group-hover:bg-ink/30"
              >
                <span className="grid h-16 w-16 place-items-center rounded-full bg-white/95 text-ink shadow-xl transition group-hover:scale-105">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                    <path d="M8 5.5v13l11-6.5z" />
                  </svg>
                </span>
              </span>
            )}
            {item.kind === 'video' && (
              <span className="absolute left-4 top-4 rounded-full bg-ink/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-white backdrop-blur">
                {t('Film')}
              </span>
            )}
          </button>
        ))}
      </div>

      {open !== null && visible[open] && (
        <Viewer items={visible} index={open} onIndex={setOpen} onClose={() => setOpen(null)} />
      )}
    </>
  );
}

function Tile({ item }: { item: GalleryItem }) {
  if (item.thumb) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        {...responsiveImage(item.thumb, {
          sizes: '(min-width: 1024px) 380px, (min-width: 640px) 46vw, 92vw',
          widths: PHOTO_CARD.widths,
        })}
        alt={item.alt}
        loading="lazy"
        className={`${item.aspect} w-full object-cover transition duration-500 group-hover:scale-[1.02]`}
      />
    );
  }
  // An uploaded video with no cover: its first frame is the thumbnail.
  const src = videoSource(item.src);
  if (src?.kind === 'file') {
    return (
      <video
        src={`${src.src}#t=0.1`}
        muted
        playsInline
        preload="metadata"
        aria-hidden
        className={`${item.aspect} w-full object-cover`}
      />
    );
  }
  return <span className={`${item.aspect} block w-full bg-ink`} aria-hidden />;
}

function Viewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: GalleryItem[];
  index: number;
  onIndex: (i: number) => void;
  onClose: () => void;
}) {
  const t = useT();
  const item = items[index]!;
  const closeRef = useRef<HTMLButtonElement>(null);
  const touchX = useRef<number | null>(null);
  const go = useCallback(
    (d: number) => onIndex((index + d + items.length) % items.length),
    [index, items.length, onIndex],
  );

  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = overflow;
      prev?.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  const video = item.kind === 'video' ? videoSource(item.src) : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={item.alt}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/95 p-4 backdrop-blur-sm sm:p-10"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      onTouchStart={(e) => {
        touchX.current = e.touches[0]?.clientX ?? null;
      }}
      onTouchEnd={(e) => {
        const start = touchX.current;
        const end = e.changedTouches[0]?.clientX;
        touchX.current = null;
        if (start == null || end == null || Math.abs(end - start) < 50) return;
        go(end < start ? 1 : -1);
      }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label={t('Close')}
        className="absolute right-4 top-4 grid h-11 w-11 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20"
      >
        <IconX width={20} height={20} />
      </button>
      {items.length > 1 && (
        <>
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label={t('Previous')}
            className="absolute left-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:grid"
          >
            <IconChevronLeft width={22} height={22} />
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            aria-label={t('Next')}
            className="absolute right-3 top-1/2 hidden h-12 w-12 -translate-y-1/2 place-items-center rounded-full bg-white/10 text-white hover:bg-white/20 sm:grid"
          >
            <IconChevronRight width={22} height={22} />
          </button>
        </>
      )}

      <figure className="flex max-h-full w-full max-w-5xl flex-col items-center">
        {video?.kind === 'youtube' || video?.kind === 'vimeo' ? (
          <div className="aspect-video w-full overflow-hidden rounded-xl bg-black">
            <iframe
              key={item.key}
              src={video.embedUrl}
              title={item.alt}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="h-full w-full"
            />
          </div>
        ) : video?.kind === 'file' ? (
          <video
            key={item.key}
            src={video.src}
            poster={item.thumb ?? undefined}
            controls
            autoPlay
            playsInline
            className="max-h-[80vh] w-full rounded-xl bg-black"
          />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={item.key}
            {...responsiveImage(item.src, { sizes: '100vw', widths: [1200, 1600, 2400] })}
            alt={item.alt}
            className="max-h-[80vh] w-auto max-w-full rounded-xl object-contain"
          />
        )}
        <figcaption className="mt-3 text-center text-[13px] text-white/70">
          {item.alt}
          {items.length > 1 && (
            <span className="ml-2 text-white/40">
              {index + 1} / {items.length}
            </span>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
