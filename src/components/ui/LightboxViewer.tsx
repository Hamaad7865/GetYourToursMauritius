'use client';

import { useMemo } from 'react';
import YARL, { type Slide } from 'yet-another-react-lightbox';
import Counter from 'yet-another-react-lightbox/plugins/counter';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import 'yet-another-react-lightbox/plugins/counter.css';
import { useT } from '@/components/site/PreferencesProvider';
import { carouselWindow, viewerSlides, type ViewerItem } from '@/lib/images/viewer-slides';
import {
  VIEWER_ANIMATION,
  VIEWER_CLASS,
  VIEWER_CONTROLLER,
  VIEWER_THUMBNAILS,
  imageProps,
  renderThumbnail,
  sharedLabels,
} from './viewer-parts';

export interface LightboxViewerProps {
  items: ViewerItem[];
  /** The slide to open on. Read once, when the viewer opens. */
  index: number;
  onClose: () => void;
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

/**
 * The full-screen photo viewer: swipe and pinch on a phone, arrows and keyboard on a desktop, zoom, a counter
 * and a thumbnail strip that follows the photo on show. It is the `yet-another-react-lightbox` library, themed
 * in `./lightbox.css`; it brings its own dialog behaviour — the page behind goes inert, Escape closes, the
 * body stops scrolling — so callers need no `useDialog`, and `./lazyViewer` returns focus to what opened it.
 *
 * Loaded on demand by `./Lightbox` and never on the server, so none of it is in a page's first paint.
 */
export default function LightboxViewer({ items, index, onClose }: LightboxViewerProps) {
  const t = useT();
  const slides = useMemo(() => viewerSlides(items), [items]);
  const labels = useMemo(
    () => ({
      ...sharedLabels(t),
      Previous: t('Previous photo'),
      Next: t('Next photo'),
      Close: t('Close gallery'),
    }),
    [t],
  );
  // One photo needs no counter and no strip of one thumbnail.
  const several = slides.length > 1;
  const { finite, preload } = carouselWindow(slides.length);

  return (
    <YARL
      open
      close={onClose}
      index={index}
      slides={slides}
      plugins={several ? [Counter, Thumbnails, Video, Zoom] : [Video, Zoom]}
      className={VIEWER_CLASS}
      labels={labels}
      animation={VIEWER_ANIMATION}
      controller={VIEWER_CONTROLLER}
      carousel={{ preload, finite, imageProps }}
      thumbnails={VIEWER_THUMBNAILS}
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
