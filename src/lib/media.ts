/**
 * Uploaded video files play inline; everything else renders as an image. Extension-based on
 * purpose: activity/booking photos carry no media-type column, so the URL is the only signal.
 * Pure — safe on the server, the client and in tests.
 */

const VIDEO_EXT = /\.(mp4|webm|mov|m4v|ogv)(\?|#|$)/i;

/** True when `url` points at an uploaded video file (not a YouTube/Vimeo page). */
export function isVideoUrl(url: string): boolean {
  try {
    return VIDEO_EXT.test(new URL(url, 'https://placeholder.invalid').pathname);
  } catch {
    return VIDEO_EXT.test(url);
  }
}

/**
 * Gallery order for package pages: videos first (the lead tile plays), then photos — stable, so
 * the owner's relative order within each kind is kept. The cover stays untouched: it is always
 * images[0] (an image-only upload), which is what cards, search and SEO read.
 */
export function videosFirst<T extends { url: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => Number(isVideoUrl(b.url)) - Number(isVideoUrl(a.url)));
}

/* ---------------------------------------------------------------------------------------------
 * Video sources: an uploaded file (mp4 / webm / mov) or a YouTube / Vimeo link. One parser decides how a
 * gallery plays it and what it shows before it plays — so the admin, the grid and the viewer agree.
 * ------------------------------------------------------------------------------------------- */

export type VideoSource =
  | { kind: 'youtube'; id: string; embedUrl: string; thumbUrl: string }
  | { kind: 'vimeo'; id: string; embedUrl: string; thumbUrl: null }
  | { kind: 'file'; src: string; thumbUrl: null };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;

/** How to play `url`, or null when it is not a recognisable video. */
export function videoSource(url: string): VideoSource | null {
  let u: URL;
  try {
    u = new URL(url.trim(), 'https://placeholder.invalid');
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');
  let yt: string | null = null;
  if (host === 'youtu.be') yt = u.pathname.slice(1).split('/')[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const parts = u.pathname.split('/').filter(Boolean);
    yt =
      u.searchParams.get('v') ??
      (['embed', 'shorts', 'live', 'v'].includes(parts[0] ?? '') ? (parts[1] ?? null) : null);
  }
  if (yt && YOUTUBE_ID.test(yt)) {
    return {
      kind: 'youtube',
      id: yt,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}?autoplay=1&rel=0&playsinline=1`,
      thumbUrl: `https://i.ytimg.com/vi/${yt}/hqdefault.jpg`,
    };
  }
  if (host === 'vimeo.com' || host === 'player.vimeo.com') {
    const id = u.pathname.split('/').filter((p) => /^\d+$/.test(p))[0];
    if (id) {
      return {
        kind: 'vimeo',
        id,
        embedUrl: `https://player.vimeo.com/video/${id}?autoplay=1`,
        thumbUrl: null,
      };
    }
  }
  if (/\.(mp4|webm|mov|m4v|ogv)$/i.test(u.pathname)) {
    return { kind: 'file', src: url.trim(), thumbUrl: null };
  }
  return null;
}

const VIDEO_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  ogv: 'video/ogg',
};

/** The media type a `<video><source type>` wants for an uploaded file, or null when `url` is not one. */
export function videoMime(url: string): string | null {
  let path: string;
  try {
    path = new URL(url.trim(), 'https://placeholder.invalid').pathname;
  } catch {
    return null;
  }
  const ext = /\.([a-z0-9]+)$/i.exec(path)?.[1]?.toLowerCase();
  return (ext && VIDEO_MIME[ext]) || null;
}

export type MediaKind = 'image' | 'file' | 'youtube' | 'vimeo';

/**
 * What a gallery URL is. Anything that is not a recognisable video is a photo — a URL pasted without a
 * file extension (a CDN link) is still a picture.
 */
export function mediaKind(url: string): MediaKind {
  return videoSource(url)?.kind ?? 'image';
}
