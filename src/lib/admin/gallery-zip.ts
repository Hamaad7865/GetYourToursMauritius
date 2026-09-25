import JSZip from 'jszip';

/**
 * Bulk gallery upload: one ZIP in, many photos out. The browser unzips and the files go up
 * through the normal gallery path. Full quality, always — no downscale, no recompress: what the
 * photographer shot is what the guest sees.
 */

/** Max files taken from one ZIP — a wedding dump, not an archive of everything. */
export const MAX_ZIP_PHOTOS = 150;

const MEDIA_EXT = /\.(jpe?g|png|webp|gif|bmp|avif|tiff?|mp4|webm|mov|m4v|ogv)$/i;

/** True for a ZIP path that looks like a photo or video (skips folders, __MACOSX droppings). */
export function isZipPhotoPath(path: string): boolean {
  if (!path || path.endsWith('/') || path.includes('__MACOSX/') || path.startsWith('._')) {
    return false;
  }
  const base = path.split('/').pop() ?? '';
  if (base.startsWith('._') || base.startsWith('.')) return false;
  return MEDIA_EXT.test(base);
}

/** Media entries of a ZIP, in archive order, capped — pure, so it's unit-tested. */
export function pickZipPhotoPaths(paths: string[], maxCount: number = MAX_ZIP_PHOTOS): string[] {
  const out: string[] = [];
  for (const p of paths) {
    if (out.length >= maxCount) break;
    if (isZipPhotoPath(p)) out.push(p);
  }
  return out;
}

export interface ZipMedia {
  name: string;
  blob: Blob;
}

/** Media files out of a ZIP, in archive order (capped), original bytes. Runs in node too. */
export async function extractZipPhotos(zipBlob: Blob): Promise<ZipMedia[]> {
  const zip = await JSZip.loadAsync(zipBlob);
  const paths = pickZipPhotoPaths(Object.keys(zip.files));
  const out: ZipMedia[] = [];
  for (const path of paths) {
    const file = zip.files[path];
    if (!file || file.dir) continue;
    out.push({ name: path.split('/').pop() ?? path, blob: await file.async('blob') });
  }
  return out;
}

export interface PreparedZip {
  files: File[];
  /** Files taken from the ZIP. */
  picked: number;
  /** Entries skipped (non-media, or over the cap). */
  skipped: number;
}

/** A ZIP file → upload-ready Files, original quality. */
export async function prepareZipPhotos(zipFile: Blob, _zipName: string): Promise<PreparedZip> {
  const zip = await JSZip.loadAsync(zipFile);
  const all = Object.keys(zip.files).filter((p) => !p.endsWith('/'));
  const mediaPaths = all.filter(isZipPhotoPath);
  const picked = mediaPaths.slice(0, MAX_ZIP_PHOTOS);
  const files: File[] = [];
  for (const path of picked) {
    const file = zip.files[path];
    if (!file || file.dir) continue;
    files.push(new File([await file.async('blob')], path.split('/').pop() ?? path));
  }
  return { files, picked: files.length, skipped: all.length - files.length };
}
