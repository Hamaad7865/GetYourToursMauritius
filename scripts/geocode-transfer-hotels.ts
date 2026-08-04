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

/**
 * Curated coordinates per hotel slug — refreshed 2026-08-04 from the Google Geocoding API (via the
 * Maps JS SDK on the live site, where the browser key is referrer-valid). The previous table was
 * hand-placed and off by >1.5 km for 25 of the 45 hotels — enough that `nearestTransfer` could snap
 * a Places pick to the wrong neighbour; the fare survives (zones are coarse) but the hotel NAMED to
 * the guest was wrong. The 13 worst movers were verified against the geocoder's formatted_address
 * (e.g. Ambre really is on "Coastal Road Palmar", not 3 km south of it).
 */
const CURATED: Record<string, { lat: number; lng: number }> = {
  // East coast
  'lux-belle-mare': { lat: -20.19902, lng: 57.78235 },
  'constance-belle-mare-plage': { lat: -20.16728, lng: 57.76617 },
  'long-beach-mauritius': { lat: -20.17272, lng: 57.76983 },
  'shangri-la-le-touessrok': { lat: -20.25154, lng: 57.79723 },
  'ambre-mauritius': { lat: -20.2061, lng: 57.78643 },
  'radisson-blu-azuri': { lat: -20.09392, lng: 57.7088 },
  'anahita-golf-spa': { lat: -20.27864, lng: 57.78889 },
  'four-seasons-anahita': { lat: -20.28435, lng: 57.79041 },
  'one-only-le-saint-geran': { lat: -20.16051, lng: 57.75628 },
  'the-residence-mauritius': { lat: -20.19788, lng: 57.77973 },
  'emeraude-beach-attitude': { lat: -20.19007, lng: 57.77342 },
  'tropical-attitude': { lat: -20.23723, lng: 57.8005 },
  'solana-beach': { lat: -20.17665, lng: 57.77043 },
  // North coast
  'trou-aux-biches-beachcomber': { lat: -20.03016, lng: 57.54756 },
  'canonnier-beachcomber': { lat: -20.00251, lng: 57.55366 },
  'lux-grand-gaube': { lat: -20.00234, lng: 57.65979 },
  'ravenala-attitude': { lat: -20.08351, lng: 57.51703 },
  'westin-turtle-bay': { lat: -20.09068, lng: 57.51044 },
  'le-meridien-ile-maurice': { lat: -20.07066, lng: 57.51622 },
  'victoria-beachcomber': { lat: -20.0752, lng: 57.51283 },
  'royal-palm-beachcomber': { lat: -20.00654, lng: 57.57891 },
  'mauricia-beachcomber': { lat: -20.0093, lng: 57.57995 },
  'veranda-grand-baie': { lat: -20.00842, lng: 57.5788 },
  'lagoon-attitude': { lat: -19.99448, lng: 57.63648 },
  'zilwa-attitude': { lat: -20.00314, lng: 57.64767 },
  'recif-attitude': { lat: -20.0556, lng: 57.52202 },
  'coin-de-mire-attitude': { lat: -19.98616, lng: 57.60677 },
  'veranda-pointe-aux-biches': { lat: -20.04688, lng: 57.52913 },
  // West coast
  'paradis-beachcomber': { lat: -20.4369, lng: 57.3206 },
  'dinarobin-beachcomber': { lat: -20.44911, lng: 57.31508 },
  'lux-le-morne': { lat: -20.44505, lng: 57.32846 },
  'st-regis-mauritius': { lat: -20.46117, lng: 57.31023 },
  'sugar-beach-mauritius': { lat: -20.30367, lng: 57.36564 },
  'la-pirogue': { lat: -20.29861, lng: 57.36488 },
  'sands-suites': { lat: -20.31641, lng: 57.37181 },
  'maradiva-villas': { lat: -20.31434, lng: 57.36977 },
  'pearle-beach': { lat: -20.29371, lng: 57.36349 },
  'hilton-mauritius': { lat: -20.30842, lng: 57.36727 },
  // Geocoder matched only a generic "Mauritius" address for the Riu, but the point it returned sits
  // on the Le Morne peninsula where the hotel is — usable, just not rooftop-verified.
  'riu-le-morne': { lat: -20.46678, lng: 57.3109 },
  // South coast
  'sofitel-so-mauritius': { lat: -20.50935, lng: 57.43576 },
  'heritage-le-telfair': { lat: -20.50644, lng: 57.40974 },
  'tamassa-bel-ombre': { lat: -20.50878, lng: 57.41603 },
  'shandrani-beachcomber': { lat: -20.4456, lng: 57.70452 },
  'preskil-island-resort': { lat: -20.42181, lng: 57.72197 },
  'outrigger-mauritius': { lat: -20.51089, lng: 57.41706 },
};

async function geocode(name: string, key: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    `${name}, Mauritius`,
  )}&region=mu&key=${key}`;
  const res = await fetch(url);
  const j = (await res.json()) as {
    results?: Array<{ geometry?: { location?: { lat: number; lng: number } } }>;
  };
  const loc = j.results?.[0]?.geometry?.location;
  return loc ? { lat: loc.lat, lng: loc.lng } : null;
}

/**
 * Apply coordinates by targeted text replacement inside each hotel's own block, never by parsing the
 * whole array. The original JSON.parse round-trip broke the day prettier reformatted the generated
 * file to single quotes — silently, since nobody re-runs this script often — and a round-trip also
 * rewrites every line of a 2,000-line file when only two numbers changed.
 */
async function main(): Promise<void> {
  const useApi = process.argv.includes('--geocode');
  const key = process.env.GOOGLE_MAPS_API_KEY ?? '';
  let src = readFileSync(FILE, 'utf8');

  // Block boundaries: each hotel starts at its `slug:` line and runs to the next one (or EOF).
  const slugRe = /slug:\s*'([^']+)'/g;
  const marks = [...src.matchAll(slugRe)].map((m) => ({ slug: m[1]!, at: m.index! }));

  // REVERSE order: replacements change block lengths, and `marks` holds offsets into the string as
  // it was scanned — editing back-to-front is what keeps every yet-unprocessed offset valid.
  let filled = 0;
  for (let i = marks.length - 1; i >= 0; i -= 1) {
    const { slug, at } = marks[i]!;
    const end = i + 1 < marks.length ? marks[i + 1]!.at : src.length;
    let c: { lat: number; lng: number } | null = CURATED[slug] ?? null;
    if (useApi && key) {
      const name = /hotelName:\s*'([^']+)'/.exec(src.slice(at, end))?.[1] ?? slug;
      const g = await geocode(name, key);
      if (g) c = g;
    }
    if (!c) {
      console.warn(`Missing coords for ${slug}`);
      continue;
    }
    const block = src.slice(at, end);
    // Number() drops toFixed's trailing zeros (57.78640 → 57.7864) — prettier rejects them.
    const num = (v: number): string => String(Number(v.toFixed(5)));
    const next = block
      .replace(/lat:\s*-?[\d.]+/, `lat: ${num(c.lat)}`)
      .replace(/lng:\s*-?[\d.]+/, `lng: ${num(c.lng)}`);
    if (!/lat:\s*-?[\d.]+/.test(block)) {
      console.warn(`No lat/lng fields to update for ${slug} — regenerate the file first`);
      continue;
    }
    src = src.slice(0, at) + next + src.slice(end);
    filled += 1;
  }

  writeFileSync(FILE, src, 'utf8');
  console.log(
    `Wrote coords for ${filled}/${marks.length} hotels${useApi && key ? ' (geocoded)' : ' (curated)'}.`,
  );
}

void main();
