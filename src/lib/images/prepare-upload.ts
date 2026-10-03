/**
 * Shrinks a PAGE photo in the admin's browser before it is uploaded to Supabase Storage.
 *
 * WHY: uploads went up as raw camera files — the biggest in production is 11.7 MB and 45 are over 3 MB,
 * so every page showing them downloaded the lot. A page photo never needs more than ~2400 px on its long
 * edge. Re-encoding in the browser also strips EXIF (GPS included) and makes the upload itself faster.
 *
 * NOT for guest galleries: those must stay full quality (the guest downloads them), so they never go
 * through here. Callers opt IN (`uploadActivityImage(file, slug, { webSize: true })`), which is why a new
 * upload path can never silently degrade a customer's photos.
 *
 * The decisions (what to touch, how big, which format, what to call it, when to keep the original) are pure
 * and unit-tested; the canvas work at the bottom needs a real browser and fails OPEN — anything unexpected
 * (HEIC outside Safari, a decode error, an encoder that returns a different format, a result that is not
 * smaller) uploads the original file untouched.
 */

/** Longest side of a stored page photo, in pixels. */
export const PAGE_IMAGE_MAX_EDGE = 2400;
/** A photo already within the cap AND no heavier than this is left exactly as it is. */
export const PAGE_IMAGE_KEEP_UNDER_BYTES = 500 * 1024;
/** High on purpose: delivery resizes again (Cloudflare, quality 80), so this is not the final squeeze. */
const ENCODE_QUALITY = 0.9;
/** The new file must be at most this fraction of the original, or the original is kept. */
const MIN_SAVING = 0.9;

type Encodable = 'image/webp' | 'image/jpeg' | 'image/png';

/** Only photos the canvas can re-encode without losing something: never GIF (animation), SVG, video. */
export function isPreparable(type: string): boolean {
  return type === 'image/jpeg' || type === 'image/png' || type === 'image/webp';
}

/** `width` × `height` scaled so the long edge is at most `maxEdge`; never enlarged. */
export function fitWithin(
  width: number,
  height: number,
  maxEdge: number = PAGE_IMAGE_MAX_EDGE,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(long > maxEdge)) return { width, height }; // already small enough (or nonsense: leave it)
  const k = maxEdge / long;
  return {
    width: Math.max(1, Math.round(width * k)),
    height: Math.max(1, Math.round(height * k)),
  };
}

/** Whether a decoded photo is worth re-encoding: too many pixels, or too many bytes. */
export function needsWork(input: { width: number; height: number; bytes: number }): boolean {
  return (
    Math.max(input.width, input.height) > PAGE_IMAGE_MAX_EDGE ||
    input.bytes > PAGE_IMAGE_KEEP_UNDER_BYTES
  );
}

/**
 * The format to write: WebP when the browser can encode it (smallest, keeps transparency), otherwise the
 * same family (JPEG stays JPEG, PNG stays PNG). `null` = cannot do it well, keep the original.
 */
export function outputType(sourceType: string, webpSupported: boolean): Encodable | null {
  if (!isPreparable(sourceType)) return null;
  if (webpSupported) return 'image/webp';
  if (sourceType === 'image/jpeg') return 'image/jpeg';
  if (sourceType === 'image/png') return 'image/png';
  return null; // a WebP source we cannot re-encode as WebP
}

/** `name` with the extension that matches `type` (the storage path takes its extension from the name). */
export function renamedFor(name: string, type: Encodable): string {
  const ext = type === 'image/webp' ? 'webp' : type === 'image/png' ? 'png' : 'jpg';
  const dot = name.lastIndexOf('.');
  const stem = (dot > 0 ? name.slice(0, dot) : dot === 0 ? '' : name).trim();
  return `${stem || 'photo'}.${ext}`;
}

/** Keep the re-encoded file only when it is clearly smaller; otherwise the original wins. */
export function worthKeeping(originalBytes: number, resultBytes: number): boolean {
  return resultBytes <= originalBytes * MIN_SAVING;
}

/* ------------------------------------------------------------------------------------------------
 * Browser part (needs createImageBitmap + canvas): verified in a real browser, not in unit tests.
 * ---------------------------------------------------------------------------------------------- */

let webpSupport: Promise<boolean> | undefined;

function canvasToBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/** Safari silently returns a PNG when asked for WebP, so test it once instead of assuming. */
function supportsWebpEncoding(): Promise<boolean> {
  webpSupport ??= (async () => {
    try {
      const probe = document.createElement('canvas');
      probe.width = probe.height = 1;
      return (await canvasToBlob(probe, 'image/webp', ENCODE_QUALITY))?.type === 'image/webp';
    } catch {
      return false;
    }
  })();
  return webpSupport;
}

/**
 * The file to upload for a page photo: a web-sized copy when that is clearly better, otherwise `file`
 * itself. Never throws.
 */
export async function preparePageImage(file: File): Promise<File> {
  if (typeof document === 'undefined' || !isPreparable(file.type)) return file;
  try {
    // 'from-image' bakes the EXIF rotation in, so a portrait phone shot is not saved sideways.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    try {
      const { width, height } = fitWithin(bitmap.width, bitmap.height);
      const shrunk = width !== bitmap.width || height !== bitmap.height;
      if (!shrunk && !needsWork({ width, height, bytes: file.size })) return file;
      const type = outputType(file.type, await supportsWebpEncoding());
      if (!type) return file;
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return file;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bitmap, 0, 0, width, height);
      const blob = await canvasToBlob(canvas, type, ENCODE_QUALITY);
      if (!blob || blob.type !== type || !worthKeeping(file.size, blob.size)) return file;
      return new File([blob], renamedFor(file.name, type), { type, lastModified: Date.now() });
    } finally {
      bitmap.close();
    }
  } catch {
    return file; // fail open: an unusual file uploads as it is
  }
}
