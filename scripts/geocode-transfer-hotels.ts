/**
 * Fill src/lib/content/_transfers.gen.ts with each hotel's { lat, lng } so the airport-transfer maps can
 * pin every resort and draw the SSR → hotel route.
 *
 * Coordinates come from a CURATED table below (resort locations are well-known and stable). If a real,
 * non-referrer-restricted server key is available in GOOGLE_MAPS_API_KEY, pass `--geocode` to refresh
 * each coord from the Google Geocoding API instead (more precise; the owner can re-run after the SEO
 * content workflow regenerates the file):
 *
 *   GOOGLE_MAPS_API_KEY=... npx tsx scripts/geocode-transfer-hotels.ts --geocode
 *
 * Without `--geocode` it just applies the curated table (no network, deterministic).
 */
import { readFileSync, writeFileSync } from 'node:fs';

const FILE = 'src/lib/content/_transfers.gen.ts';

/** Curated approximate coordinates per hotel slug (good to a few hundred metres — enough for a pin + a
 *  road route from the airport). Refresh with --geocode for exact rooftop coordinates. */
const CURATED: Record<string, { lat: number; lng: number }> = {
  // East coast
  'lux-belle-mare': { lat: -20.1916, lng: 57.7725 },
  'constance-belle-mare-plage': { lat: -20.1989, lng: 57.7745 },
  'long-beach-mauritius': { lat: -20.2069, lng: 57.7785 },
  'shangri-la-le-touessrok': { lat: -20.27, lng: 57.7905 },
  'ambre-mauritius': { lat: -20.2331, lng: 57.7806 },
  'radisson-blu-azuri': { lat: -20.1083, lng: 57.7203 },
  'anahita-golf-spa': { lat: -20.282, lng: 57.7785 },
  'four-seasons-anahita': { lat: -20.2862, lng: 57.7793 },
  'one-only-le-saint-geran': { lat: -20.1646, lng: 57.78 },
  'the-residence-mauritius': { lat: -20.205, lng: 57.7773 },
  'emeraude-beach-attitude': { lat: -20.2122, lng: 57.776 },
  'tropical-attitude': { lat: -20.2456, lng: 57.7875 },
  'solana-beach': { lat: -20.215, lng: 57.777 },
  // North coast
  'trou-aux-biches-beachcomber': { lat: -20.0331, lng: 57.5455 },
  'canonnier-beachcomber': { lat: -20.0067, lng: 57.5681 },
  'lux-grand-gaube': { lat: -19.9876, lng: 57.6566 },
  'ravenala-attitude': { lat: -20.0874, lng: 57.5167 },
  'westin-turtle-bay': { lat: -20.0884, lng: 57.5152 },
  'le-meridien-ile-maurice': { lat: -20.0606, lng: 57.5226 },
  'victoria-beachcomber': { lat: -20.0641, lng: 57.5212 },
  'royal-palm-beachcomber': { lat: -20.0033, lng: 57.5806 },
  'mauricia-beachcomber': { lat: -20.012, lng: 57.5841 },
  'veranda-grand-baie': { lat: -20.0061, lng: 57.5876 },
  'lagoon-attitude': { lat: -19.9836, lng: 57.6427 },
  'zilwa-attitude': { lat: -19.9758, lng: 57.6431 },
  'recif-attitude': { lat: -20.0556, lng: 57.5226 },
  'coin-de-mire-attitude': { lat: -19.9869, lng: 57.6135 },
  'veranda-pointe-aux-biches': { lat: -20.0492, lng: 57.523 },
  // West coast
  'paradis-beachcomber': { lat: -20.453, lng: 57.3206 },
  'dinarobin-beachcomber': { lat: -20.456, lng: 57.3186 },
  'lux-le-morne': { lat: -20.4491, lng: 57.3219 },
  'st-regis-mauritius': { lat: -20.4575, lng: 57.316 },
  'sugar-beach-mauritius': { lat: -20.2872, lng: 57.3641 },
  'la-pirogue': { lat: -20.2884, lng: 57.3645 },
  'sands-suites': { lat: -20.296, lng: 57.366 },
  'maradiva-villas': { lat: -20.2905, lng: 57.3651 },
  'pearle-beach': { lat: -20.274, lng: 57.3651 },
  'hilton-mauritius': { lat: -20.292, lng: 57.3648 },
  'riu-le-morne': { lat: -20.448, lng: 57.3222 },
  // South coast
  'sofitel-so-mauritius': { lat: -20.5012, lng: 57.406 },
  'heritage-le-telfair': { lat: -20.504, lng: 57.3902 },
  'tamassa-bel-ombre': { lat: -20.5031, lng: 57.398 },
  'shandrani-beachcomber': { lat: -20.4432, lng: 57.6975 },
  'preskil-island-resort': { lat: -20.4181, lng: 57.7019 },
  'outrigger-mauritius': { lat: -20.5052, lng: 57.3852 },
};

interface Hotel {
  slug: string;
  hotelName: string;
  lat?: number;
  lng?: number;
  [k: string]: unknown;
}

async function geocode(name: string, key: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    `${name}, Mauritius`,
  )}&region=mu&key=${key}`;
  const res = await fetch(url);
  const j = (await res.json()) as { results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }> };
  const loc = j.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

async function main(): Promise<void> {
  const useApi = process.argv.includes('--geocode');
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  const src = readFileSync(FILE, 'utf8');
  const start = src.indexOf('= [') + 2;
  const end = src.lastIndexOf(']');
  const arr = JSON.parse(src.slice(start, end + 1)) as Hotel[];

  let filled = 0;
  for (const h of arr) {
    let c: { lat: number; lng: number } | null = CURATED[h.slug] ?? null;
    if (useApi && key) {
      const g = await geocode(h.hotelName, key);
      if (g) c = g;
      else if (!c) console.warn(`No geocode + no curated coord for ${h.slug} (${h.hotelName})`);
    }
    if (c) {
      h.lat = Number(c.lat.toFixed(5));
      h.lng = Number(c.lng.toFixed(5));
      filled += 1;
    } else {
      console.warn(`Missing coords for ${h.slug}`);
    }
  }

  const out = src.slice(0, start) + JSON.stringify(arr, null, 2) + src.slice(end + 1);
  writeFileSync(FILE, out, 'utf8');
  console.log(`Wrote coords for ${filled}/${arr.length} hotels${useApi && key ? ' (geocoded)' : ' (curated)'}.`);
}

void main();
