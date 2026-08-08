/**
 * Card photography for the /belle-mare hotel rail, with its licence recorded next to it.
 *
 * WHY THIS FILE EXISTS SEPARATELY from destination-hotels.ts: that file is editorial copy the owner
 * edits freely. This one is a LICENCE REGISTER. Every entry names the photographer, the licence and
 * the page it came from, so "are we allowed to publish this?" has an answer in the repo rather than
 * in someone's memory. Anything added here must carry the same.
 *
 * A CARD SHOWS THE PROPERTY OR IT SHOWS NOTHING. An earlier pass filled the eleven hotels with no
 * free photograph using a picture of the stretch of lagoon each one sits on, captioned with the
 * place name. The owner rejected it on sight — "they're not for the real hotels" — and that is the
 * right call: a beach under a hotel's name reads as that hotel however it is captioned. So the
 * fallback is the typographic card, which claims nothing. Do not reintroduce area photography here;
 * the guard in tests/unit/belle-mare-page.test.ts fails the build if you do.
 *
 * WHAT MAY GO IN HERE. Only files we can publish commercially AND that depict the property itself:
 * Wikimedia Commons under CC BY / CC BY-SA, our own photographs, or a file a hotel's press office
 * has given us in writing. A Google Images result is NOT a source — that index is mostly
 * OTA-commissioned shoots (Booking and Expedia license their own), photographers' own work and
 * stock comps, and a hotel can only grant what the hotel owns. See destination-hotels.ts.
 *
 * TO ADD ONE: drop the file in /public/hotels/, add an entry with `credit: null` (our own file) or
 * the press office's terms, and record the permission in the commit message. Setting `image` on the
 * hotel in destination-hotels.ts also works and takes precedence over this register.
 */

export interface HotelPhoto {
  /** Commons thumbnail (proxied via /api/img at render) or a path under /public. */
  url: string;
  /** Attribution. `null` only for our own files and permissioned press images, which need none. */
  credit: { author: string; licence: string; source: string } | null;
}

const commons = (file: string) => `https://commons.wikimedia.org/wiki/File:${file}`;

/**
 * The three Belle Mare properties Wikimedia Commons actually photographs.
 *
 * Verified against the Commons API on 2026-08-09. Searches for the other eleven return either
 * nothing or pictures of the surrounding coast — in particular Commons holds no file for Anahita
 * or Beau Champ at all, so Four Seasons and Anahita Golf cannot be filled from a free source.
 */
export const BELLE_MARE_HOTEL_PHOTOS: Record<string, HotelPhoto> = {
  'lux-belle-mare': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c1/LUX%2A_Belle_Mare_Hotel_in_Mauritius.jpg/1280px-LUX%2A_Belle_Mare_Hotel_in_Mauritius.jpg',
    // Uploaded to Commons by LUX* Resorts' own e-commerce staff — as close to a press release as a
    // free licence gets, and the strongest provenance of the three.
    credit: {
      author: 'Tejcoomar Luchmun',
      licence: 'CC BY-SA 4.0',
      source: commons('LUX*_Belle_Mare_Hotel_in_Mauritius.jpg'),
    },
  },
  'long-beach-mauritius': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/5/59/Mauritius_long_beach_golf_spa_ressort.jpg/1280px-Mauritius_long_beach_golf_spa_ressort.jpg',
    credit: {
      author: 'Arne Müseler',
      licence: 'CC BY-SA 3.0 DE',
      source: commons('Mauritius_long_beach_golf_spa_ressort.jpg'),
    },
  },
  'one-only-le-saint-geran': {
    url: 'https://upload.wikimedia.org/wikipedia/commons/thumb/e/ed/MAURITIUS_SAINT-GERAN_HOTEL_1_-_panoramio.jpg/1280px-MAURITIUS_SAINT-GERAN_HOTEL_1_-_panoramio.jpg',
    credit: {
      author: 'otterboris',
      licence: 'CC BY 3.0',
      source: commons('MAURITIUS_SAINT-GERAN_HOTEL_1_-_panoramio.jpg'),
    },
  },
};

export function hotelPhoto(slug: string): HotelPhoto | null {
  return BELLE_MARE_HOTEL_PHOTOS[slug] ?? null;
}
