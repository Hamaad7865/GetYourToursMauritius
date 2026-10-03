'use client';

import { useMemo, type ReactNode } from 'react';
import YARL, { type ImageProps, type Slide } from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/counter.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import './lightbox.css';
import { useT } from '@/components/site/PreferencesProvider';
import { viewerSlides, type ViewerItem } from '@/lib/images/viewer-slides';
import { IconPlay } from './icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

// Two things the library does not know about our slides: a YouTube / Vimeo player (its video plugin is for
// uploaded files only), and the untouched file behind a resized photo, which the fallback script goes back to.
declare module 'yet-another-react-lightbox' {
  export interface EmbedSlide extends GenericSlide {
    type: 'embed';
    embedUrl: string;
    title: string;
  }
  interface SlideTypes {
    embed: EmbedSlide;
  }
  interface SlideImage {
    original?: string;
    thumbnailOriginal?: string;
  }
}

export interface LightboxViewerProps {
  items: ViewerItem[];
  /** The slide to open on. Read once, when the viewer opens. */
  index: number;
  onClose: () => void;
}

/** The little round play mark over a film's thumbnail, so it reads as a film and not a photo. */
function PlayMark() {
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0 grid place-items-center">
      <span className="grid h-7 w-7 place-items-center rounded-full bg-ink/65 text-white ring-1 ring-white/30">
        <IconPlay width={12} height={12} />
      </span>
    </span>
  );
}

/** Thumbnails for the slides the library cannot picture itself: an uploaded film shows its first frame, a
 *  YouTube link its still, Vimeo (which offers none) a dark tile. A photo whose thumbnail is a RESIZED copy is
 *  drawn here too, because the library's own thumbnail <img> cannot carry the marker the fallback script
 *  needs; every other photo falls through to the library's own. */
function renderThumbnail({ slide }: { slide: Slide }): ReactNode {
  if (slide.type === undefined || slide.type === 'image') {
    if (!slide.thumbnailOriginal || !slide.thumbnail) return undefined;
    return (
      <img
        src={slide.thumbnail}
        data-src-original={slide.thumbnailOriginal}
        alt=""
        loading="lazy"
        className="h-full w-full object-cover"
      />
    );
  }
  if (slide.type === 'video') {
    const src = slide.sources[0]?.src;
    return (
      <>
        {src && (
          // `#t=0.1` makes iOS Safari paint a frame instead of a black box.
          <video
            src={`${src}#t=0.1`}
            muted
            playsInline
            preload="metadata"
            className="h-full w-full object-cover"
          />
        )}
        <PlayMark />
      </>
    );
  }
  if (slide.type === 'embed') {
    return (
      <>
        {slide.thumbnail ? (
          <img src={slide.thumbnail} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : (
          <span className="block h-full w-full bg-ink" />
        )}
        <PlayMark />
      </>
    );
  }
  return undefined;
}

/**
 * A YouTube / Vimeo player at the largest 16:9 that fits the slide. Only the slide on screen loads its player:
 * the carousel keeps its neighbours ready, and a player loaded behind the photo would start playing there
 * (both links autoplay). Moving away unmounts it, which also stops it.
 */
function EmbedFrame({
  slide,
  offset,
  rect,
}: {
  slide: Extract<Slide, { type: 'embed' }>;
  offset: number;
  rect: { width: number; height: number };
}) {
  const width = Math.max(0, Math.min(rect.width, rect.height * (16 / 9), 1024));
  const size = { width, height: Math.round((width * 9) / 16) };
  return offset === 0 ? (
    <iframe
      src={slide.embedUrl}
      title={slide.title}
      allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
      allowFullScreen
      className="rounded-xl bg-black"
      style={size}
    />
  ) : (
    <div aria-hidden className="rounded-xl bg-black" style={size} />
  );
}

/** A resized photo that fails to load (the feature off on this host, the quota used up, the origin not
 *  allowed) goes back to the original — the same safety net every other photo on the site has. */
function imageProps(slide: Slide): ImageProps {
  return (
    'original' in slide && slide.original ? { 'data-src-original': slide.original } : {}
  ) as ImageProps;
}

/**
 * The full-screen photo viewer: swipe and pinch on a phone, arrows and keyboard on a desktop, zoom, a counter
 * and a thumbnail strip that follows the photo on show. It is the `yet-another-react-lightbox` library, themed
 * in `./lightbox.css`; it brings its own dialog behaviour — the page behind goes inert, Escape closes, the
 * body stops scrolling and focus returns to what opened it — so callers need no `useDialog`.
 *
 * Loaded on demand by `./Lightbox` and never on the server, so none of it is in a page's first paint.
 */
export default function LightboxViewer({ items, index, onClose }: LightboxViewerProps) {
  const t = useT();
  const slides = useMemo(() => viewerSlides(items), [items]);
  const labels = useMemo(
    () => ({
      Previous: t('Previous photo'),
      Next: t('Next photo'),
      Close: t('Close gallery'),
      'Zoom in': t('Zoom in'),
      'Zoom out': t('Zoom out'),
      Lightbox: t('Photo viewer'),
      Carousel: t('Carousel'),
      'Photo gallery': t('Photo gallery'),
      Slide: t('Slide'),
      '{index} of {total}': t('{index} of {total}'),
      Thumbnails: t('Thumbnails'),
    }),
    [t],
  );
  // One photo needs no counter and no strip of one thumbnail.
  const several = slides.length > 1;
  // The thumbnail strip is a looping window of five around the photo on show. With fewer than five photos
  // that window is wider than the list and shows one of them twice, so a short gallery does not loop (its
  // arrows stop at the ends) and keeps every photo within reach of the strip; from five up the loop and the
  // strip are clean. `preload` is both how many neighbours are ready to swipe to and the strip's reach.
  const finite = slides.length < 5;
  const preload = finite ? Math.max(1, slides.length - 1) : 2;

  return (
    <YARL
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={several ? [Counter, Thumbnails, Video, Zoom] : [Video, Zoom]}
      className="bmt-lightbox"
      labels={labels}
      animation={{ swipe: 450, easing: { swipe: 'cubic-bezier(0.22, 1, 0.36, 1)' } }}
      controller={{ closeOnBackdropClick: true, closeOnPullDown: true }}
      carousel={{ preload, finite, imageProps }}
      thumbnails={{
        position: 'bottom',
        width: 64,
        height: 48,
        border: 2,
        borderRadius: 10,
        padding: 0,
        gap: 10,
        imageFit: 'cover',
        vignette: false,
        showToggle: false,
      }}
      zoom={{ maxZoomPixelRatio: 3 }}
      render={{
        slide: ({ slide, offset, rect }) =>
          slide.type === 'embed' ? (
            <EmbedFrame slide={slide} offset={offset} rect={rect} />
          ) : undefined,
        thumbnail: renderThumbnail,
        // One photo has nowhere to go: no arrows (the library would draw two disabled ones).
        ...(several ? {} : { buttonPrev: () => null, buttonNext: () => null }),
      }}
    />
  );
}
