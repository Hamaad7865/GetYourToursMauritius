/**
 * What the full-screen photo viewer shows, built from the plain items a gallery hands over: a photo, an
 * uploaded video file, or a YouTube / Vimeo link. The viewer itself is the `yet-another-react-lightbox`
 * library (`components/ui/LightboxViewer.tsx`); this decides what each item IS as a slide, so those rules —
 * above all which resized copies a photo offers — are testable without a browser.
 *
 * Pure: no DOM, safe on the server, the client and in tests.
 */
import { videoMime } from '@/lib/media';
import { canResize, resizedUrl, resizingEnabled } from './resize';

/**
 * Widths a photo is offered at. The viewer shows one photo big, so this is the top of the ladder in
 * `./resize`; zooming in steps up through them (the library's zoom picks the smallest copy that is sharp enough).
 */
export const VIEWER_WIDTHS = [1200, 1600, 2400] as const;

/** A thumbnail is at most ~72 CSS px wide: the smallest step of the ladder is plenty, even on a 3× phone. */
export const VIEWER_THUMB_WIDTH = 400;

/** What a gallery passes in. `thumb` is a smaller picture of the same item when the page has one (YouTube's
 *  still, the inspiration grid's own small copy); `embedUrl` is the player to embed for a YouTube / Vimeo link. */
export interface ViewerItem {
  src: string;
  thumb?: string | null;
  alt: string;
  /** A video of any kind: an uploaded file, or a YouTube / Vimeo link (then `embedUrl` is set too). */
  video: boolean;
  embedUrl?: string | null;
}

export interface ViewerPhotoSlide {
  src: string;
  alt: string;
  /** The small picture the thumbnail strip shows (otherwise it uses the photo itself). */
  thumbnail?: string;
  /** The untouched picture behind a RESIZED `thumbnail`, for the fallback when that fails to load. */
  thumbnailOriginal?: string;
  /** The untouched file — the fallback script goes back to it when a resized copy fails to load. */
  original?: string;
  /** Resized copies, smallest first, when this photo can be resized. */
  srcSet?: { src: string; width: number; height: number }[];
}

export interface ViewerVideoSlide {
  type: 'video';
  sources: { src: string; type: string }[];
  autoPlay: true;
  controls: true;
}

export interface ViewerEmbedSlide {
  type: 'embed';
  embedUrl: string;
  /** Names the player for a screen reader. */
  title: string;
  thumbnail?: string;
}

export type ViewerSlide = ViewerPhotoSlide | ViewerVideoSlide | ViewerEmbedSlide;

export interface ViewerSlidesOptions {
  /** Override the build switch (tests). */
  enabled?: boolean;
  /** Override the project the build is wired to (tests). */
  supabaseUrl?: string | null;
}

/**
 * How the viewer's carousel is set up for `count` slides. The thumbnail strip under the photo is a looping window
 * of five around the photo on show, and its width is the carousel's `preload` (which is also how many neighbours
 * are ready to swipe to). Under five photos that window is wider than the list and shows one of them twice, so a
 * short gallery does not loop — and `preload` must then reach every photo, or the strip hides some of them.
 * From five up the loop and the strip are clean with two neighbours each side.
 */
export function carouselWindow(count: number): { finite: boolean; preload: number } {
  const finite = count < 5;
  return { finite, preload: finite ? Math.max(1, count - 1) : 2 };
}

/** A photo's real shape is not stored (only its address), so each resized copy gets a height in the usual 3:2
 *  shape. It only steers which copy the library picks and caps nothing visible; the photo itself is never stretched. */
const ASSUMED_ASPECT = 2 / 3;

export function viewerSlides(
  items: readonly ViewerItem[],
  opts: ViewerSlidesOptions = {},
): ViewerSlide[] {
  const enabled = opts.enabled ?? resizingEnabled();
  const supabaseUrl = opts.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const resizable = (src: string) => enabled && canResize(src, supabaseUrl);

  return items.map((item): ViewerSlide => {
    if (item.video && item.embedUrl) {
      return {
        type: 'embed',
        embedUrl: item.embedUrl,
        title: item.alt,
        // YouTube's own still, as it came: it is not ours to resize.
        ...(item.thumb ? { thumbnail: item.thumb } : {}),
      };
    }
    if (item.video) {
      return {
        type: 'video',
        sources: [{ src: item.src, type: videoMime(item.src) ?? 'video/mp4' }],
        autoPlay: true,
        controls: true,
      };
    }

    const thumbSource = item.thumb ?? item.src;
    const slide: ViewerPhotoSlide = { src: item.src, alt: item.alt };
    if (resizable(thumbSource)) {
      slide.thumbnail = resizedUrl(thumbSource, VIEWER_THUMB_WIDTH);
      slide.thumbnailOriginal = thumbSource;
    } else if (item.thumb) {
      slide.thumbnail = item.thumb;
    }
    if (resizable(item.src)) {
      slide.src = resizedUrl(item.src, VIEWER_WIDTHS[0]);
      slide.original = item.src;
      slide.srcSet = VIEWER_WIDTHS.map((width) => ({
        src: resizedUrl(item.src, width),
        width,
        height: Math.round(width * ASSUMED_ASPECT),
      }));
    }
    return slide;
  });
}
