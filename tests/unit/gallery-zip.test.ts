import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import {
  MAX_ZIP_PHOTOS,
  extractZipPhotos,
  isZipPhotoPath,
  pickZipPhotoPaths,
} from '@/lib/admin/gallery-zip';

describe('gallery ZIP intake', () => {
  it('recognises photo and video paths and skips the rest', () => {
    expect(isZipPhotoPath('shoot/IMG_001.JPG')).toBe(true);
    expect(isZipPhotoPath('a/b.png')).toBe(true);
    expect(isZipPhotoPath('clip.mp4')).toBe(true);
    expect(isZipPhotoPath('notes.txt')).toBe(false);
    expect(isZipPhotoPath('folder/')).toBe(false);
    expect(isZipPhotoPath('__MACOSX/shoot/IMG_001.jpg')).toBe(false);
    expect(isZipPhotoPath('shoot/._IMG_001.jpg')).toBe(false);
    expect(isZipPhotoPath('.DS_Store')).toBe(false);
    expect(isZipPhotoPath('')).toBe(false);
  });

  it('caps the picks in archive order', () => {
    const paths = ['b.jpg', 'notes.txt', 'a.jpg', 'c.mp4'];
    expect(pickZipPhotoPaths(paths, 2)).toEqual(['b.jpg', 'a.jpg']);
    expect(pickZipPhotoPaths(paths)).toHaveLength(3);
    expect(
      pickZipPhotoPaths(Array.from({ length: MAX_ZIP_PHOTOS + 10 }, (_, i) => `${i}.jpg`)),
    ).toHaveLength(MAX_ZIP_PHOTOS);
  });

  it('extracts the media with original bytes and names', async () => {
    const zip = new JSZip();
    zip.file('IMG_001.jpg', new Uint8Array([1, 2, 3]));
    zip.file('clip.mp4', new Uint8Array([4, 5]));
    zip.file('notes.txt', 'hello');
    zip.file('__MACOSX/._IMG_001.jpg', new Uint8Array([9]));
    const blob = await zip.generateAsync({ type: 'blob' });
    const media = await extractZipPhotos(blob);
    expect(media.map((m) => m.name)).toEqual(['IMG_001.jpg', 'clip.mp4']);
    expect(new Uint8Array(await media[0]!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});
