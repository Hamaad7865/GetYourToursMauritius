import type { ReactNode } from 'react';
import type { ImageProps, Slide } from 'yet-another-react-lightbox';
import 'yet-another-react-lightbox/styles.css';
import 'yet-another-react-lightbox/plugins/thumbnails.css';
import './lightbox.css';
import { IconPlay } from './icons';

/* eslint-disable @next/next/no-img-element -- CF Pages serves images unoptimized. */

/**
 * The pieces the two full-screen viewers share — the tour / package gallery (`LightboxViewer`) and the customers'
 * own gallery (`GalleryViewer`) — so they look and behave alike. Importing this also brings in the library's
 * stylesheets and the brand skin, so a viewer cannot forget them.
 */

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

/** The class on the library's root that `lightbox.css` hangs the brand skin off. */
export const VIEWER_CLASS = 'bmt-lightbox';

export const VIEWER_ANIMATION = {
  swipe: 450,
  easing: { swipe: 'cubic-bezier(0.22, 1, 0.36, 1)' },
};

/** Tap the dark backdrop or pull down to close — what a phone user reaches for. */
export const VIEWER_CONTROLLER = { closeOnBackdropClick: true, closeOnPullDown: true };

/** The strip's cells. Its size, gap, border and radius are set here, not in the CSS: the library animates the
 *  strip with arithmetic on exactly these numbers. */
export const VIEWER_THUMBNAILS = {
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
} as const;

type Translate = (key: string) => string;

/** The screen-reader labels both viewers say alike. Each viewer adds its own Previous / Next / Close. The
 *  library takes labels as a table keyed by its English text; `{index} of {total}` is its own template. */
export function sharedLabels(t: Translate) {
  return {
    'Zoom in': t('Zoom in'),
    'Zoom out': t('Zoom out'),
    Lightbox: t('Photo viewer'),
    Carousel: t('Carousel'),
    'Photo gallery': t('Photo gallery'),
    Slide: t('Slide'),
    '{index} of {total}': t('{index} of {total}'),
    Thumbnails: t('Thumbnails'),
  };
}

/** The little round play mark over a film's thumbnail, so it reads as a film and not a photo. */
export function PlayMark() {
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
export function renderThumbnail({ slide }: { slide: Slide }): ReactNode {
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

/** A resized photo that fails to load (the feature off on this host, the quota used up, the origin not
 *  allowed) goes back to the original — the same safety net every other photo on the site has. */
export function imageProps(slide: Slide): ImageProps {
  return (
    'original' in slide && slide.original ? { 'data-src-original': slide.original } : {}
  ) as ImageProps;
}
