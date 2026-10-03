import { describe, expect, it, vi } from 'vitest';
import {
  EMPTY_ACTIVITY,
  assertMediaValid,
  createActivity,
  imageRows,
  updateActivity,
} from '@/lib/admin/activity-write';

// Any attempt to reach the database fails loudly, so a test can tell "refused up front" from "got as far
// as writing".
vi.mock('@/lib/supabase/browser', () => ({
  getBrowserSupabase: () => {
    throw new Error('the database was touched');
  },
}));

/**
 * What the editor writes to `activity_images`. The rows' `position` is what `heroImage` reads (the image
 * with the lowest position), and cards, search, the share preview and the Product JSON-LD all use it — so a
 * video or a YouTube / Vimeo link in front would be a broken picture everywhere. Both editors (Tours and
 * Photography) save through this, so the guard lives here rather than in either form.
 */
const ID = 'act-1';
const JPG = (n: number) =>
  `https://x.supabase.co/storage/v1/object/public/activity-images/t/${n}.jpg`;
const MP4 = 'https://x.supabase.co/storage/v1/object/public/activity-images/t/film.mp4';
const YT = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
const img = (url: string, alt = '') => ({ url, alt });

describe('imageRows', () => {
  it('numbers the rows from 0 in the order given, for the activity it was asked about', () => {
    expect(imageRows(ID, [img(JPG(1), 'One'), img(JPG(2))])).toEqual([
      { activity_id: ID, url: JPG(1), alt: 'One', position: 0 },
      { activity_id: ID, url: JPG(2), alt: null, position: 1 },
    ]);
  });

  it('trims the URL and the alt text, and drops empty rows (the editor’s blank last row)', () => {
    const rows = imageRows(ID, [
      img(`  ${JPG(1)}  `, '  Beach  '),
      img('   '),
      img('', 'orphan alt'),
    ]);
    expect(rows).toEqual([{ activity_id: ID, url: JPG(1), alt: 'Beach', position: 0 }]);
  });

  it('puts the first photo in front when a video or a link would lead, keeping the rest in order', () => {
    const rows = imageRows(ID, [
      img(MP4, 'Film'),
      img(YT, 'Clip'),
      img(JPG(1), 'Cover'),
      img(JPG(2)),
    ]);
    expect(rows.map((r) => r.url)).toEqual([JPG(1), MP4, YT, JPG(2)]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2, 3]);
  });

  it('keeps each image’s alt text with it when it moves', () => {
    const rows = imageRows(ID, [img(MP4, 'Film'), img(JPG(1), 'Cover')]);
    expect(rows.map((r) => [r.url, r.alt])).toEqual([
      [JPG(1), 'Cover'],
      [MP4, 'Film'],
    ]);
  });

  it('sees a video that has stray spaces around it as a video, not as a photo', () => {
    const rows = imageRows(ID, [img(`  ${MP4}  `), img(JPG(1))]);
    expect(rows[0]!.url).toBe(JPG(1));
  });

  it('leaves a list that already leads with a photo exactly as it is', () => {
    const rows = imageRows(ID, [img(JPG(1)), img(MP4), img(JPG(2)), img(YT)]);
    expect(rows.map((r) => r.url)).toEqual([JPG(1), MP4, JPG(2), YT]);
  });

  it('writes nothing for no images, and cannot invent a photo for a list of only videos', () => {
    expect(imageRows(ID, [])).toEqual([]);
    expect(imageRows(ID, [img(MP4), img(YT)]).map((r) => r.url)).toEqual([MP4, YT]);
  });
});

/* A list of ONLY videos has no photo to put first, so it must never be saved. The forms check it, but the
 * Photography functions and the admin assistant call the same two functions with no form in front of them. */
describe('createActivity / updateActivity refuse videos with no photo before touching the database', () => {
  const draft = { ...EMPTY_ACTIVITY, title: 'North Tour', slug: 'north-tour' };
  const onlyVideos = { ...draft, images: [img(MP4), img(YT)] };

  it('assertMediaValid names the problem, and accepts a photo or no images at all', () => {
    expect(() => assertMediaValid(onlyVideos)).toThrow(/photo/i);
    expect(() => assertMediaValid({ images: [img(MP4), img(JPG(1))] })).not.toThrow();
    expect(() => assertMediaValid({ images: [] })).not.toThrow();
  });

  it('on create', async () => {
    await expect(createActivity(onlyVideos)).rejects.toThrow(/photo/i);
  });

  it('on update', async () => {
    await expect(updateActivity('act-1', onlyVideos)).rejects.toThrow(/photo/i);
  });

  it('for the restricted content role too, which edits the photos', async () => {
    await expect(createActivity(onlyVideos, { contentOnly: true })).rejects.toThrow(/photo/i);
    await expect(updateActivity('act-1', onlyVideos, { contentOnly: true })).rejects.toThrow(
      /photo/i,
    );
  });

  it('lets a list with a photo go on to the database (the guard does not over-block)', async () => {
    const withPhoto = { ...draft, images: [img(MP4), img(JPG(1))] };
    await expect(createActivity(withPhoto)).rejects.toThrow(/database was touched/);
    await expect(updateActivity('act-1', withPhoto)).rejects.toThrow(/database was touched/);
  });
});
