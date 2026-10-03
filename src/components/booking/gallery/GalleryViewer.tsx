'use client';

import { useEffect, useMemo, useState, type ReactNode, type SVGProps } from 'react';
import YARL, { IconButton, useLightboxState } from 'yet-another-react-lightbox';
import Slideshow from 'yet-another-react-lightbox/plugins/slideshow';
import Thumbnails from 'yet-another-react-lightbox/plugins/thumbnails';
import Video from 'yet-another-react-lightbox/plugins/video';
import Zoom from 'yet-another-react-lightbox/plugins/zoom';
import { IconDownload, IconHeart, IconHeartFill } from '@/components/ui/icons';
import {
  VIEWER_ANIMATION,
  VIEWER_CLASS,
  VIEWER_CONTROLLER,
  VIEWER_THUMBNAILS,
  imageProps,
  renderThumbnail,
  sharedLabels,
} from '@/components/ui/viewer-parts';
import { carouselWindow, viewerSlides } from '@/lib/images/viewer-slides';
import {
  galleryItemsKey,
  galleryViewerItems,
  mediaBaseName,
  type GalleryPhoto,
  type TFn,
} from '@/lib/booking/gallery-view';
import { isVideoUrl } from '@/lib/media';

// The library says a button's name by looking its English label up in the `labels` table; our two toolbar buttons
// are its own `IconButton`s, so their labels are registered here and translated in that same table below.
declare module 'yet-another-react-lightbox' {
  interface Labels {
    'Add to favourites'?: string;
    'Remove from favourites'?: string;
    Download?: string;
  }
}

/** How long each photo stays up in the slideshow. The coral progress bar's CSS animation (`animate-gallery-bar`)
 *  runs for the same four seconds. */
const SLIDESHOW_MS = 4000;

export interface GalleryViewerProps {
  t: TFn;
  items: readonly GalleryPhoto[];
  /** The file to open on. Read once, when the viewer opens. */
  initialIndex: number;
  /** Start the slideshow as soon as the viewer opens. */
  slideshow: boolean;
  favs: ReadonlySet<string>;
  onToggleFav: (id: string) => void;
  /** Download the ORIGINAL of this file (never the resized copy the viewer shows). */
  onDownload: (photo: GalleryPhoto) => void;
  onClose: () => void;
}

/** The solid heart for a favourited file, in the brand coral. */
function FilledHeart(p: SVGProps<SVGSVGElement>) {
  return <IconHeartFill {...p} className={`${p.className ?? ''} text-coral`} />;
}

function FavouriteButton({
  items,
  favs,
  onToggle,
}: {
  items: readonly GalleryPhoto[];
  favs: ReadonlySet<string>;
  onToggle: (id: string) => void;
}) {
  const { currentIndex } = useLightboxState();
  const item = items[currentIndex];
  if (!item) return null;
  const fav = favs.has(item.id);
  return (
    <IconButton
      label={fav ? 'Remove from favourites' : 'Add to favourites'}
      icon={fav ? FilledHeart : IconHeart}
      onClick={() => onToggle(item.id)}
      aria-pressed={fav}
    />
  );
}

function DownloadButton({
  items,
  onDownload,
}: {
  items: readonly GalleryPhoto[];
  onDownload: (photo: GalleryPhoto) => void;
}) {
  const { currentIndex } = useLightboxState();
  const item = items[currentIndex];
  if (!item) return null;
  return <IconButton label="Download" icon={IconDownload} onClick={() => onDownload(item)} />;
}

/**
 * What sits over the photo besides the library's own controls: the position and the file name (top left), the
 * slideshow's progress bar (a film plays through on its own, so it gets none) and, for the first few seconds, the
 * hint about zooming. It has to live inside the viewer to know which file is on show.
 */
function Chrome({
  t,
  items,
  playing,
}: {
  t: TFn;
  items: readonly GalleryPhoto[];
  playing: boolean;
}) {
  const { currentIndex } = useLightboxState();
  const [hint, setHint] = useState(true);
  useEffect(() => {
    const id = setTimeout(() => setHint(false), 3800);
    return () => clearTimeout(id);
  }, []);
  const item = items[currentIndex];
  if (!item) return null;
  const film = isVideoUrl(item.url);
  return (
    <>
      {playing && !film && (
        <span
          key={`bar-${currentIndex}`}
          aria-hidden
          className="animate-gallery-bar pointer-events-none absolute left-0 top-0 z-[2] h-[3px] w-full bg-coral"
        />
      )}
      <div className="pointer-events-none absolute left-0 top-0 m-3 flex max-w-[calc(100%-290px)] items-baseline gap-3 p-2.5 text-white sm:max-w-[calc(100%-340px)]">
        <span className="whitespace-nowrap text-[15px] font-bold tabular-nums">
          {currentIndex + 1} / {items.length}
        </span>
        <span className="hidden truncate text-[13px] text-[#9fb5b8] sm:inline">
          {mediaBaseName(item.url)}
        </span>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute bottom-24 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-full bg-black/60 px-3.5 py-2 text-[13px] font-semibold text-white transition-opacity duration-500"
        style={{ opacity: hint && !film ? 1 : 0 }}
      >
        {t('Scroll to zoom · drag to move')}
      </span>
    </>
  );
}

/**
 * The customers' full-screen gallery viewer: the same library, skin and gestures as the tour galleries' (see
 * `@/components/ui/LightboxViewer`), plus what a delivered shoot needs — favourites, a download of the ORIGINAL
 * file, a slideshow with a progress bar, the file name and position, and zoom by wheel. A film plays in the
 * browser's own player (seek, volume, full screen), and the slideshow waits for it to finish.
 *
 * Loaded on demand by `./GalleryLightbox`, which also hands focus back to what opened it.
 */
export default function GalleryViewer({
  t,
  items,
  initialIndex,
  slideshow,
  favs,
  onToggleFav,
  onDownload,
  onClose,
}: GalleryViewerProps) {
  // The library resets itself to the photo it was opened on whenever it is given a NEW list of slides, and the
  // page builds a fresh array on every favourite toggle. Keying on the files keeps a heart tap from sending the
  // viewer back to where it started.
  const key = galleryItemsKey(items);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- deliberately keyed on the files (`key`), not the array
  const slides = useMemo(() => viewerSlides(galleryViewerItems(items)), [key]);

  // Where the viewer is, so that if the list changes under it (un-favouriting inside the Favourites tab removes
  // that file) it stays on the same place instead of jumping back to where it opened.
  const [position, setPosition] = useState(initialIndex);
  const [playing, setPlaying] = useState(false);

  // Nothing left to show (the last favourite was just removed): leave, rather than sit on a blank, locked page.
  useEffect(() => {
    if (slides.length === 0) onClose();
  }, [slides.length, onClose]);

  const labels = useMemo(
    () => ({
      ...sharedLabels(t),
      Previous: t('Previous'),
      Next: t('Next'),
      Close: t('Close'),
      Play: t('Play slideshow'),
      Pause: t('Pause slideshow'),
      'Add to favourites': t('Add to favourites'),
      'Remove from favourites': t('Remove from favourites'),
      Download: t('Download'),
    }),
    [t],
  );

  const several = slides.length > 1;
  const { finite, preload } = carouselWindow(slides.length);
  const buttons: ReactNode[] = [
    'zoom',
    ...(several ? ['slideshow'] : []),
    <FavouriteButton key="fav" items={items} favs={favs} onToggle={onToggleFav} />,
    <DownloadButton key="download" items={items} onDownload={onDownload} />,
    'close',
  ];

  return (
    <YARL
      open
      close={onClose}
      index={Math.min(position, Math.max(0, slides.length - 1))}
      slides={slides}
      plugins={several ? [Thumbnails, Video, Zoom, Slideshow] : [Video, Zoom]}
      className={VIEWER_CLASS}
      labels={labels}
      animation={VIEWER_ANIMATION}
      controller={VIEWER_CONTROLLER}
      carousel={{ preload, finite, imageProps }}
      thumbnails={VIEWER_THUMBNAILS}
      // Wheel zoom: the page behind is locked while this is open, so the wheel is free to mean zoom.
      zoom={{ maxZoomPixelRatio: 3, scrollToZoom: true }}
      slideshow={{ autoplay: slideshow, delay: SLIDESHOW_MS }}
      toolbar={{ buttons }}
      on={{
        view: ({ index }) => setPosition(index),
        slideshowStart: () => setPlaying(true),
        slideshowStop: () => setPlaying(false),
      }}
      render={{
        thumbnail: renderThumbnail,
        controls: () => <Chrome t={t} items={items} playing={playing} />,
        // One file has nowhere to go: no arrows (the library would draw two disabled ones).
        ...(several ? {} : { buttonPrev: () => null, buttonNext: () => null }),
      }}
    />
  );
}
