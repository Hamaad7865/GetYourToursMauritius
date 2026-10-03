import { describe, expect, it } from 'vitest';
import {
  PAGE_IMAGE_KEEP_UNDER_BYTES,
  PAGE_IMAGE_MAX_EDGE,
  fitWithin,
  isPreparable,
  needsWork,
  outputType,
  renamedFor,
  worthKeeping,
} from '@/lib/images/prepare-upload';

/**
 * The admin uploads page photos straight from the browser to Supabase Storage, and every upload was a raw
 * camera file (the biggest in production is 11.7 MB; 45 are over 3 MB). Page photos are now shrunk in the
 * browser before they go up. The browser part (decode, canvas, encode) needs a real canvas and is checked
 * in a browser; these tests pin every DECISION around it: what is touched, how big the result is, which
 * format, what it is called, and when to keep the original instead. Guest-gallery uploads never go
 * through this at all — they must stay full quality.
 */
describe('isPreparable', () => {
  it('touches only JPEG, PNG and WebP photos', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp'])
      expect(isPreparable(t), t).toBe(true);
  });

  it('passes everything else through untouched: GIF animation, SVG, HEIC, video, PDF, unknown', () => {
    for (const t of [
      'image/gif',
      'image/svg+xml',
      'image/heic',
      'video/mp4',
      'application/pdf',
      '',
    ]) {
      expect(isPreparable(t), t).toBe(false);
    }
  });
});

describe('fitWithin', () => {
  it('scales the long edge down to the cap, keeping the shape (landscape)', () => {
    expect(fitWithin(6000, 4000)).toEqual({ width: 2400, height: 1600 });
    expect(fitWithin(5980, 3992)).toEqual({ width: 2400, height: 1602 });
  });

  it('does the same for a portrait photo', () => {
    expect(fitWithin(5421, 8131)).toEqual({ width: 1600, height: 2400 });
  });

  it('never enlarges a photo that is already small enough', () => {
    expect(fitWithin(1000, 800)).toEqual({ width: 1000, height: 800 });
    expect(fitWithin(2400, 1200)).toEqual({ width: 2400, height: 1200 });
  });

  it('takes a different cap', () => {
    expect(fitWithin(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
  });

  it('never returns a zero side, and leaves nonsense sizes alone', () => {
    expect(fitWithin(10000, 3)).toEqual({ width: 2400, height: 1 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });
});

describe('needsWork', () => {
  const ok = { width: 2000, height: 1300, bytes: PAGE_IMAGE_KEEP_UNDER_BYTES };

  it('leaves a photo that is already web-sized and light exactly as it is', () => {
    expect(needsWork(ok)).toBe(false);
  });

  it('works on one that is too big in pixels', () => {
    expect(needsWork({ ...ok, width: PAGE_IMAGE_MAX_EDGE + 1 })).toBe(true);
    expect(needsWork({ ...ok, height: PAGE_IMAGE_MAX_EDGE + 1 })).toBe(true);
  });

  it('works on one that is heavy even though its pixels are fine', () => {
    expect(needsWork({ ...ok, bytes: PAGE_IMAGE_KEEP_UNDER_BYTES + 1 })).toBe(true);
  });
});

describe('outputType', () => {
  it('prefers WebP whenever the browser can encode it', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp']) {
      expect(outputType(t, true), t).toBe('image/webp');
    }
  });

  it('otherwise keeps the family: JPEG stays JPEG, PNG stays PNG', () => {
    expect(outputType('image/jpeg', false)).toBe('image/jpeg');
    expect(outputType('image/png', false)).toBe('image/png');
  });

  it('gives up (keep the original) for a WebP when it cannot encode WebP, and for anything else', () => {
    expect(outputType('image/webp', false)).toBeNull();
    expect(outputType('image/gif', true)).toBeNull();
    expect(outputType('video/mp4', true)).toBeNull();
  });
});

describe('renamedFor', () => {
  it('swaps the extension for the one that matches the new format', () => {
    expect(renamedFor('Honeymoon Shoot 01.JPG', 'image/webp')).toBe('Honeymoon Shoot 01.webp');
    expect(renamedFor('a.b.c.png', 'image/jpeg')).toBe('a.b.c.jpg');
    expect(renamedFor('scan.webp', 'image/png')).toBe('scan.png');
  });

  it('adds one when there was none, and never produces an empty name', () => {
    expect(renamedFor('IMG_4821', 'image/webp')).toBe('IMG_4821.webp');
    expect(renamedFor('', 'image/webp')).toBe('photo.webp');
    expect(renamedFor('.jpg', 'image/webp')).toBe('photo.webp');
  });
});

describe('worthKeeping', () => {
  it('keeps the new file only when it is clearly smaller (at least 10%)', () => {
    expect(worthKeeping(1000, 800)).toBe(true);
    expect(worthKeeping(1000, 900)).toBe(true);
  });

  it('keeps the ORIGINAL when re-encoding did not help — never trade quality for nothing', () => {
    expect(worthKeeping(1000, 901)).toBe(false);
    expect(worthKeeping(1000, 1000)).toBe(false);
    expect(worthKeeping(1000, 1500)).toBe(false);
  });
});
