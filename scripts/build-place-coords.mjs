#!/usr/bin/env node
/**
 * Build src/lib/content/_place-coords.gen.ts — stored coordinates for every tour itinerary stop,
 * alternative stop and meeting point, so tour pages stop paying Google Geocoding per visitor.
 *
 * WHY: Oct 2026 the Geocoding API billed 19,561 calls ($30). Not one of the 101 published itinerary
 * stops had coordinates, so every visitor's browser geocoded every stop again.
 *
 * Source: OpenStreetMap Nominatim (ODbL — may be stored, with attribution), never Google's geocoder
 * (its results may not be stored long-term). Hand-placed OVERRIDES below win over OSM; UNPLACEABLE
 * names are stored as null so the site never spends a call on them.
 *
 * REVIEW FIRST, WRITE SECOND (same discipline as scripts/geocode-activities.mjs):
 *
 *     node scripts/build-place-coords.mjs                          # names from Supabase (.env.local)
 *     node scripts/build-place-coords.mjs --env=.env.local.live    # …from another env file (PROD)
 *     node scripts/build-place-coords.mjs --names-file=names.json  # …or from a JSON array of names
 *     node scripts/build-place-coords.mjs --apply                  # write the generated file
 *
 * Names already in the generated file are kept and not looked up again. Nominatim's usage policy:
 * max 1 request/second, an identifying User-Agent — honoured below.
 *
 * You do NOT need this for a new stop: saving the tour in /admin pins it automatically (stop-pins.ts →
 * /api/v1/admin/place-pins) and stores the pin on the stop itself. This table is only the fallback for
 * stops saved before that existed, and for meeting points.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const OUT = 'src/lib/content/_place-coords.gen.ts';
const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const apply = process.argv.includes('--apply');

/** Must match normalisePlaceName() in src/lib/maps/place-coords.ts — a unit test asserts every key
 *  in the generated file is already normalised, so drift shows up as a red test. */
const norm = (name) =>
  name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/,?\s*mauritius\s*$/, '')
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();

/** Mauritius main island, generously bounded (same box as geocode-activities.mjs, plus the northern
 *  islets — Flat Island / Gunner's Quoin sit at ≈ -19.88). */
const BOUNDS = { minLat: -20.6, maxLat: -19.75, minLng: 57.25, maxLng: 57.85 };
const inMauritius = (p) =>
  p.lat > BOUNDS.minLat && p.lat < BOUNDS.maxLat && p.lng > BOUNDS.minLng && p.lng < BOUNDS.maxLng;

/** Hand-placed pins (keys normalised). For OSM misses and OSM hits that were wrong on review. */
const OVERRIDES = {
  // Plus Code PQ5H+9V9 (decoded: -20.29163, 57.77963) — the Grand River South East boat jetty.
  'pq5h+9v9 grand river south east': { lat: -20.2916, lng: 57.7796 },
  // Port Louis city tour: the Kaylasson temple (OSM "Sockalingum Meenatchee Ammen Kovil"), the
  // capital's best-known Tamil temple.
  'tamil temple': { lat: -20.14968, lng: 57.51949 },
  // South tour, after Chamarel: the roadside viewpoint over Le Morne and Ile aux Benitiers (OSM
  // "Viewpoint Chamarel").
  'viewpoint of benitier island': { lat: -20.4212, lng: 57.38641 },
  // The boat tours' waterfall up the Grand River South East (OSM "Cascade"), both spellings.
  'g r s e waterfall': { lat: -20.29176, lng: 57.76065 },
  'grand river south east waterfall': { lat: -20.29176, lng: 57.76065 },
  // The islet just north of Ile aux Cerfs — not named in OSM; placed by hand from the map.
  'ilot mangenie': { lat: -20.261, lng: 57.805 },
};

/** A better OSM search for a stop name that is misspelt or informal (keys normalised). The stored
 *  coordinates still come from OSM; only the question asked changes. */
const ALIASES = {
  'route royale maho trou d eau douce': "Trou d'Eau Douce",
  'aigrette island': 'Île aux Aigrettes',
  'benitier island': 'Île aux Bénitiers',
  'bois cheri tea factory and musuem': 'Bois Chéri',
  'chamarel 7 color earth + waterfall': 'Terres des 7 Couleurs',
  'crystal rock tamarin': 'Crystal Coral rock',
  'deux freres jetty': 'Deux Frères',
  'floreal factory shop': 'Floréal',
  'frederick hendrick musuem': 'Frederik Hendrik Museum',
  'grand bassin sacred lake of the hindu temple': 'Grand Bassin',
  'gris gris viewpoint': 'Gris Gris',
  'ile aux cerf island': 'Île aux Cerfs',
  'ile aux phare': 'Île au Phare',
  'manioc biscuit factory tour': 'Biscuiterie Rault',
  'naval mahebourg museum': 'National History Museum Mahébourg',
  'odysseo oceanarium': 'Odysseo',
  'tamarin bay': 'Tamarin Public Beach',
  'grand bay beach': 'Grand Baie Public Beach',
  'port louis caudan waterfront': 'Caudan Waterfront, Port Louis',
};

/** Names to leave to the live geocoder until a human places them in OVERRIDES. Empty since
 *  2026-11-11 — every published stop is placed. New stops are pinned by the admin save anyway. */
const SKIP = [];

/** Not a place — a description. Stored as null: never geocoded, the map simply has no pin for it. */
const UNPLACEABLE = [
  'hotel airbnb guesthouse or cruise port pickup across',
  'pick up and drop off at all parts of the island',
];

function readEnv(file) {
  const env = {};
  if (!existsSync(file)) return env;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  return env;
}

async function namesFromSupabase(envFile) {
  const env = readEnv(envFile);
  const base = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error(`${envFile} is missing the Supabase URL or service-role key`);
  const res = await fetch(
    `${base}/rest/v1/activities?status=eq.published&select=meeting_point,extra`,
    { headers: { apikey: key, authorization: `Bearer ${key}` } },
  );
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const out = [];
  for (const a of await res.json()) {
    const stops = Array.isArray(a.extra?.itinerary) ? a.extra.itinerary : [];
    if (stops.length && a.meeting_point) out.push(a.meeting_point);
    for (const s of stops) {
      if (s?.title) out.push(s.title);
      for (const o of Array.isArray(s?.options) ? s.options : []) if (o?.title) out.push(o.title);
    }
  }
  return out;
}

function readExisting() {
  if (!existsSync(OUT)) return {};
  const src = readFileSync(OUT, 'utf8');
  const start = src.indexOf('= {');
  if (start < 0) return {};
  // The file is Prettier-formatted TS (single quotes, unquoted keys), not JSON — evaluate the object
  // literal. It is our own generated, committed file, never outside input.
  return Function(`"use strict"; return (${src.slice(start + 2, src.lastIndexOf('}') + 1)});`)();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function nominatim(name) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('countrycodes', 'mu');
  url.searchParams.set('limit', '1');
  url.searchParams.set('q', `${name}, Mauritius`);
  const res = await fetch(url, { headers: { 'User-Agent': 'belle-mare-tours-coords-script/1.0' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const [top] = await res.json();
  return top ? { lat: Number(top.lat), lng: Number(top.lon), label: top.display_name } : null;
}

async function main() {
  const namesFile = arg('names-file');
  const raw = namesFile
    ? JSON.parse(readFileSync(namesFile, 'utf8'))
    : await namesFromSupabase(arg('env') ?? '.env.local');

  const byKey = new Map(); // normalised key → first spelling seen
  for (const n of raw) if (n && norm(n)) byKey.set(norm(n), byKey.get(norm(n)) ?? n);

  const table = readExisting();
  for (const [k, v] of Object.entries(OVERRIDES)) table[k] = v;
  for (const k of UNPLACEABLE) table[k] = null;

  const misses = [];
  const suspect = [];
  for (const [key, name] of byKey) {
    if (key in table || SKIP.includes(key)) continue;
    await sleep(1100); // Nominatim: ≤ 1 request / second
    const hit = await nominatim(ALIASES[key] ?? name).catch((e) => ({ error: e.message }));
    if (!hit || hit.error) {
      misses.push(`${name}${hit?.error ? `  (${hit.error})` : ''}`);
    } else if (!inMauritius(hit)) {
      suspect.push(`${name}  →  ${hit.lat}, ${hit.lng}  ${hit.label}`);
    } else {
      table[key] = { lat: Number(hit.lat.toFixed(5)), lng: Number(hit.lng.toFixed(5)) };
      console.log(
        `NEW  ${name}${ALIASES[key] ? `  (as "${ALIASES[key]}")` : ''}\n       ${table[key].lat}, ${table[key].lng}   ${hit.label}`,
      );
    }
  }

  console.log(`\n${byKey.size} distinct names · ${Object.keys(table).length} in table`);
  if (misses.length)
    console.log(`\nNO MATCH — add to OVERRIDES or UNPLACEABLE:\n  ${misses.join('\n  ')}`);
  if (suspect.length) console.log(`\nOFF-ISLAND (never written):\n  ${suspect.join('\n  ')}`);

  if (!apply) {
    console.log('\nDry run — check every NEW row on a map, then re-run with --apply.');
    return;
  }
  const sorted = Object.fromEntries(Object.entries(table).sort(([a], [b]) => a.localeCompare(b)));
  const { format, resolveConfig } = await import('prettier');
  const source =
    '// GENERATED by scripts/build-place-coords.mjs — do not hand-edit; add OVERRIDES there and re-run.\n' +
    '// Coordinates © OpenStreetMap contributors (ODbL), except hand-placed overrides.\n' +
    `export const PLACE_COORDS: Record<string, { lat: number; lng: number } | null> = ${JSON.stringify(sorted, null, 2)};\n`;
  // Written Prettier-formatted so `npm run format:check` stays green without a manual step.
  writeFileSync(OUT, await format(source, { ...(await resolveConfig(OUT)), filepath: OUT }));
  console.log(`\nWrote ${OUT}`);
}

main().catch((err) => {
  console.error(`✗ build-place-coords failed: ${err.message}`);
  process.exit(1);
});
