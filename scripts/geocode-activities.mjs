#!/usr/bin/env node
/**
 * Fill activities.lat / activities.lng so the map can pin each activity where it actually happens.
 *
 * WHY: on 2026-08-03, 42 of 43 published activities had NO coordinates — only one did. The map was not
 * mis-placing them; it had nothing to place, so every pin fell back to roughly one spot and the
 * markers piled into the sea. This is a DATA gap, not a map bug.
 *
 * REVIEW FIRST, WRITE SECOND — the default is a dry run that writes nothing:
 *
 *     node scripts/geocode-activities.mjs              # propose, print a table, change nothing
 *     node scripts/geocode-activities.mjs --apply      # write the ones you accepted
 *     node scripts/geocode-activities.mjs --apply --only=slug-a,slug-b
 *
 * A geocoder is confidently wrong often enough that auto-writing 42 rows unreviewed is how an activity
 * ends up pinned in the wrong village — or the wrong ocean. Two guards:
 *
 *   1. EVERY result is bounds-checked against Mauritius. Anything outside is marked SUSPECT and is
 *      NEVER written, even with --apply. (Geocoding "Le Morne" without a country hint cheerfully
 *      returns places in France.)
 *   2. Google's own precision is reported. ROOFTOP / RANGE_INTERPOLATED is a real place;
 *      APPROXIMATE usually means it fell back to a town or the island centroid — treat it as a
 *      starting point to correct in /admin, not as truth.
 *
 * Needs GOOGLE_MAPS_API_KEY (a SERVER key — a browser key restricted by HTTP referrer returns
 * REQUEST_DENIED here) plus the Supabase service-role key. Both are read from .env.local.
 */
import { readFileSync } from 'node:fs';

const env = {};
for (const line of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
}

const SUPABASE = (env.NEXT_PUBLIC_SUPABASE_URL || '').replace(/\/+$/, '');
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const MAPS_KEY = env.GOOGLE_MAPS_API_KEY || env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

const apply = process.argv.includes('--apply');
const onlyArg = process.argv.find((a) => a.startsWith('--only='));
const only = onlyArg ? new Set(onlyArg.slice('--only='.length).split(',').filter(Boolean)) : null;

/** Mauritius main island, generously bounded. Rodrigues (~-19.7, 63.4) is deliberately OUTSIDE: no
 *  activity runs there today, so a hit that far east is a geocoder mistake, not a real location. */
const BOUNDS = { minLat: -20.6, maxLat: -19.95, minLng: 57.25, maxLng: 57.85 };
const inMauritius = (lat, lng) =>
  lat >= BOUNDS.minLat && lat <= BOUNDS.maxLat && lng >= BOUNDS.minLng && lng <= BOUNDS.maxLng;

const rest = async (path, init = {}) => {
  const res = await fetch(`${SUPABASE}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      authorization: `Bearer ${SERVICE_KEY}`,
      'content-type': 'application/json',
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.status === 204 ? null : res.json();
};

/**
 * What we ask Google. The activity's own location text is the best signal; meeting_point is the
 * fallback (it is often "Trou aux Biches public beach" — better than the title). ", Mauritius" is
 * ALWAYS appended: without it "Belle Mare" resolves to France, and "Grand Baie" to Haiti.
 */
function queryFor(a) {
  const parts = [a.location, a.meeting_point, a.region]
    .map((s) => (s || '').trim())
    .filter(Boolean);
  const best = parts[0] || (a.title || '').trim();
  return `${best}, Mauritius`;
}

async function geocode(query) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  // region+components keep the search on the island even when the text is ambiguous.
  url.searchParams.set('components', 'country:MU');
  url.searchParams.set('key', MAPS_KEY);
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await res.json();
  if (body.status === 'ZERO_RESULTS') return { status: body.status };
  if (body.status !== 'OK') {
    // OVER_QUERY_LIMIT / REQUEST_DENIED are account problems, not data problems — say so plainly.
    return { status: body.status, error: body.error_message };
  }
  const top = body.results[0];
  return {
    status: 'OK',
    lat: top.geometry.location.lat,
    lng: top.geometry.location.lng,
    precision: top.geometry.location_type,
    address: top.formatted_address,
  };
}

async function main() {
  if (!SUPABASE || !SERVICE_KEY)
    throw new Error('.env.local is missing the Supabase URL or service-role key');
  if (!MAPS_KEY) throw new Error('.env.local is missing GOOGLE_MAPS_API_KEY (needs a SERVER key)');

  const rows = await rest(
    'activities?status=eq.published&or=(lat.is.null,lng.is.null)' +
      '&select=id,slug,title,location,region,meeting_point&order=slug',
  );
  const targets = only ? rows.filter((r) => only.has(r.slug)) : rows;

  console.log(
    `${rows.length} published activities without coordinates${only ? ` (${targets.length} selected)` : ''}\n`,
  );
  if (targets.length === 0) return;

  const accepted = [];
  const suspect = [];
  const failed = [];

  for (const a of targets) {
    const query = queryFor(a);
    const hit = await geocode(query);

    if (hit.status !== 'OK') {
      failed.push({ ...a, query, reason: hit.error || hit.status });
      console.log(
        `  ✗ ${a.slug}\n      asked: ${query}\n      ${hit.status}${hit.error ? ` — ${hit.error}` : ''}`,
      );
      continue;
    }
    const ok = inMauritius(hit.lat, hit.lng);
    (ok ? accepted : suspect).push({ ...a, ...hit, query });
    console.log(
      `  ${ok ? '✓' : '⚠ SUSPECT'} ${a.slug}\n` +
        `      asked: ${query}\n` +
        `      got:   ${hit.address}\n` +
        `      at:    ${hit.lat.toFixed(5)}, ${hit.lng.toFixed(5)}  (${hit.precision})` +
        (ok ? '' : '  — OUTSIDE MAURITIUS, will not be written'),
    );
  }

  console.log(
    `\n${accepted.length} inside Mauritius · ${suspect.length} suspect (never written) · ${failed.length} failed`,
  );
  const approximate = accepted.filter((a) => a.precision === 'APPROXIMATE').length;
  if (approximate > 0) {
    console.log(
      `${approximate} of the accepted results are APPROXIMATE — Google fell back to a town or the ` +
        `island centre. Check those on the map and correct them in /admin.`,
    );
  }

  if (!apply) {
    console.log(
      `\nDry run — nothing written. Re-run with --apply to save the ${accepted.length} accepted.`,
    );
    return;
  }

  for (const a of accepted) {
    await rest(`activities?id=eq.${a.id}`, {
      method: 'PATCH',
      headers: { prefer: 'return=minimal' },
      body: JSON.stringify({ lat: a.lat, lng: a.lng }),
    });
  }
  console.log(`\n✓ wrote coordinates for ${accepted.length} activities`);
}

main().catch((err) => {
  console.error(`✗ geocode-activities failed: ${err.message}`);
  process.exit(1);
});
