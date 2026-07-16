/**
 * Sources blog hero photos from Pexels into `public/blog/`, and writes the credit manifest.
 *
 *   npx tsx scripts/fetch-blog-photos.ts          # fetch anything missing
 *   npx tsx scripts/fetch-blog-photos.ts --force  # re-fetch everything
 *
 * WHY THIS IS FUSSY: Pexels search is fuzzy and will happily answer "Chamarel seven coloured earth"
 * with a photo of Humahuaca (Argentina), and "Mauritius rupee" with Indian banknotes. Publishing that
 * on a Mauritius operator's blog is worse than no photo. So every candidate must NAME a real Mauritian
 * place in its alt text (MU_PLACES) or it is rejected — we only ship photos we can actually verify are
 * Mauritius. Roughly 63 such photos exist on Pexels, which is why we do heroes (evocative) and NOT
 * per-section illustrations (evidential — those need the operator's own photos).
 *
 * Licence: Pexels — free for commercial use, no attribution required. We record the photographer in
 * `public/blog/credits.json` anyway, so provenance is auditable and credit is possible later.
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const root = process.cwd();
const OUT_DIR = join(root, 'public', 'blog');
const MANIFEST = join(OUT_DIR, 'credits.json');
/** next.config sets `images.unoptimized` (Cloudflare Pages serves static assets as-is), so NOTHING
 *  shrinks these at build time — raw Pexels JPEGs are 250–670 KB each and would ship verbatim to a
 *  phone. We resize + re-encode to WebP here instead: ~1600px is plenty for a full-width hero band,
 *  and the same file is reused as the 16:9 index thumbnail. */
const MAX_WIDTH = 1600;
const WEBP_QUALITY = 78;

function loadEnvLocal(): Record<string, string> {
  const out: Record<string, string> = {};
  const path = join(root, '.env.local');
  if (!existsSync(path)) return out;
  for (const raw of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** A photo is only accepted if its alt NAMES somewhere in Mauritius — see the header note. */
const MU_PLACES =
  /mauritius|mauritian|le morne|flic en flac|grand baie|belle mare|trou aux biches|trou-aux-biches|ile aux cerfs|île aux cerfs|blue bay|port louis|chamarel|tamarin|grand bassin|pamplemousses|mahebourg|black river|rivière noire|riviere noire|moka|pereybere|albion|cap malheureux|calodyne|rodrigues/i;

/** Never acceptable as a travel-blog hero, even if the alt says "Mauritius": posed model/fashion
 *  shoots and flag close-ups. (The first run handed "day trips from Flic en Flac" a photo captioned
 *  "Fashionable young man poses in a lush field", and the markets guide a shot of flagpoles.) */
const REJECT_SUBJECT = /fashionab|posing|\bposes\b|\bmodel\b|portrait|flagpole|\bflags?\b/i;

/** Landmark-specific posts must not be fronted by a DIFFERENT recognisable landmark — a reader who
 *  knows Mauritius spots "that's Le Morne, not Grand Bassin" instantly, and it reads as fakery. These
 *  posts may only use a neutral/generic Mauritius shot, or none at all. */
const LANDMARK_POSTS = new Set([
  'port-louis-things-to-do',
  'grand-bassin-guide',
  'chamarel-guide',
  'casela-nature-park-guide',
  'black-river-gorges-guide',
  'tamarind-falls-guide',
  'mauritius-markets-guide',
  'street-food-mauritius',
  'mauritian-food-dishes',
]);
const NAMED_LANDMARK =
  /le morne|flic en flac|trou aux biches|trou-aux-biches|blue bay|grand baie|ile aux cerfs|île aux cerfs|pereybere|calodyne|rodrigues/i;

/** Per-post search queries, best match first. Falls back down the list until a verified photo lands. */
const QUERIES: Record<string, string[]> = {
  'best-time-to-visit-mauritius': ['Mauritius beach sunny', 'Mauritius lagoon'],
  'things-to-do-in-mauritius': ['Mauritius island aerial', 'Mauritius'],
  'mauritius-airport-transfer-guide': ['Mauritius road coast', 'Mauritius'],
  'getting-around-mauritius': ['Mauritius road', 'Mauritius island'],
  'best-beaches-in-mauritius': ['Mauritius beach', 'Trou aux Biches'],
  'best-waterfalls-in-mauritius': ['Mauritius waterfall', 'Mauritius nature'],
  'mauritius-7-day-itinerary': ['Mauritius aerial', 'Mauritius island'],
  'swimming-with-dolphins-mauritius': ['dolphins Mauritius', 'Mauritius sea'],
  'ile-aux-cerfs-guide': ['Ile aux Cerfs Mauritius', 'Mauritius lagoon boat'],
  'mauritius-on-a-budget': ['Mauritius beach', 'Mauritius'],
  'catamaran-cruises-mauritius': ['sailboat Mauritius', 'Mauritius boat lagoon'],
  'mauritius-with-kids': ['Mauritius beach family', 'Mauritius shallow lagoon'],
  'mauritius-honeymoon-guide': ['Mauritius sunset beach', 'Le Morne'],
  'north-vs-south-mauritius': ['Mauritius aerial coast', 'Mauritius island'],
  'snorkeling-in-mauritius': ['Blue Bay Mauritius', 'Mauritius clear water'],
  'scuba-diving-mauritius': ['Mauritius underwater', 'Mauritius sea'],
  'hiking-le-morne': ['Le Morne Brabant', 'Le Morne'],
  'black-river-gorges-guide': ['Black River Gorges Mauritius', 'Mauritius mountains'],
  'tamarind-falls-guide': ['Mauritius waterfall', 'Tamarin Mauritius'],
  'chamarel-guide': ['Chamarel Mauritius', 'Mauritius mountains'],
  'grand-bassin-guide': ['Grand Bassin Mauritius', 'Mauritius lake'],
  'casela-nature-park-guide': ['Mauritius nature park', 'Mauritius mountains'],
  'port-louis-things-to-do': ['Port Louis Mauritius', 'Mauritius city'],
  'mauritian-food-dishes': ['Mauritius market food', 'Port Louis Mauritius'],
  'street-food-mauritius': ['Port Louis Mauritius market', 'Mauritius city'],
  'whale-dolphin-watching': ['dolphins Mauritius', 'Mauritius sea boat'],
  'kitesurfing-mauritius': ['kitesurfing Mauritius', 'Le Morne'],
  'deep-sea-fishing-mauritius': ['Mauritius fishing boat', 'Mauritius sea'],
  'mauritius-in-december': ['Mauritius beach summer', 'Mauritius lagoon'],
  'mauritius-cyclone-season': ['Mauritius clouds sea', 'Mauritius'],
  'money-in-mauritius': ['Mauritius beach', 'Mauritius island'],
  'sim-card-internet-mauritius': ['Mauritius coast', 'Mauritius island'],
  'is-mauritius-safe': ['Mauritius beach calm', 'Mauritius'],
  'mauritius-entry-requirements': ['Mauritius aerial', 'Mauritius island'],
  'what-to-pack-for-mauritius': ['Mauritius beach palm', 'Mauritius'],
  'ile-aux-cerfs-vs-blue-bay': ['Blue Bay Mauritius', 'Ile aux Cerfs Mauritius'],
  'day-trips-from-grand-baie': ['Grand Baie Mauritius', 'Mauritius north coast'],
  'day-trips-from-flic-en-flac': ['Flic en Flac Mauritius', 'Mauritius west coast'],
  'sunset-spots-mauritius': ['Mauritius sunset', 'Le Morne sunset'],
  'mauritius-markets-guide': ['Port Louis Mauritius market', 'Mauritius city'],
};

interface PexelsPhoto {
  id: number;
  alt: string | null;
  photographer: string;
  photographer_url: string;
  url: string;
  src: { large2x: string; large: string };
}

interface Credit {
  slug: string;
  file: string;
  photoId: number;
  alt: string;
  photographer: string;
  photographerUrl: string;
  pexelsUrl: string;
}

const env = { ...loadEnvLocal(), ...process.env };
const KEY = env.PEXELS_API_KEY;
if (!KEY) {
  console.error('Missing PEXELS_API_KEY in .env.local');
  process.exit(1);
}
const force = process.argv.includes('--force');

async function search(query: string): Promise<PexelsPhoto[]> {
  const res = await fetch(
    `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=80&orientation=landscape`,
    { headers: { Authorization: KEY! } },
  );
  if (!res.ok) throw new Error(`pexels ${res.status} for "${query}"`);
  const json = (await res.json()) as { photos?: PexelsPhoto[] };
  return json.photos ?? [];
}

mkdirSync(OUT_DIR, { recursive: true });
const credits: Credit[] = existsSync(MANIFEST)
  ? (JSON.parse(readFileSync(MANIFEST, 'utf8')) as Credit[])
  : [];
const usedIds = new Set(force ? [] : credits.map((c) => c.photoId));
const bySlug = new Map(credits.map((c) => [c.slug, c]));

let fetched = 0;
let skipped = 0;
const unresolved: string[] = [];

/** Is this photo defensible as THIS post's hero? */
function acceptable(slug: string, p: PexelsPhoto): boolean {
  const alt = p.alt ?? '';
  if (!MU_PLACES.test(alt)) return false; // must be verifiably Mauritius
  if (REJECT_SUBJECT.test(alt)) return false; // no posed-model / flag shots
  if (usedIds.has(p.id)) return false; // one photo per post — the index shows all 40 side by side
  // A landmark post may not be fronted by a different, recognisable landmark.
  if (LANDMARK_POSTS.has(slug) && NAMED_LANDMARK.test(alt)) return false;
  return true;
}

for (const [slug, queries] of Object.entries(QUERIES)) {
  const file = join(OUT_DIR, `${slug}.webp`);
  if (!force && existsSync(file) && bySlug.has(slug)) {
    skipped += 1;
    continue;
  }

  let picked: PexelsPhoto | null = null;
  for (const q of queries) {
    const photos = await search(q);
    picked = photos.find((p) => acceptable(slug, p)) ?? null;
    if (picked) break;
  }
  if (!picked) {
    // Deliberately ship NO hero rather than a bad one. The card + post already render fine without an
    // image (`p.heroImageUrl &&` guards), so a text-only card beats a misleading photo.
    unresolved.push(slug);
    console.log(`  ⚠️  ${slug.padEnd(34)} no defensible photo — leaving heroless`);
    continue;
  }

  const img = await fetch(picked.src.large2x);
  if (!img.ok) {
    unresolved.push(slug);
    continue;
  }
  const raw = Buffer.from(await img.arrayBuffer());
  const out = await sharp(raw)
    .resize({ width: MAX_WIDTH, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  writeFileSync(file, out);

  usedIds.add(picked.id);
  const credit: Credit = {
    slug,
    file: `/blog/${slug}.webp`,
    photoId: picked.id,
    alt: picked.alt ?? '',
    photographer: picked.photographer,
    photographerUrl: picked.photographer_url,
    pexelsUrl: picked.url,
  };
  bySlug.set(slug, credit);
  fetched += 1;
  console.log(
    `  ✓ ${slug.padEnd(34)} ${String(Math.round(raw.length / 1024)).padStart(4)}→${String(Math.round(out.length / 1024)).padStart(3)} KB  ${(picked.alt ?? '').slice(0, 40)}`,
  );
}

const merged = [...bySlug.values()].sort((a, b) => a.slug.localeCompare(b.slug));
writeFileSync(MANIFEST, JSON.stringify(merged, null, 2) + '\n', 'utf8');

// Emit the slug → hero map the blog reads. Generated (not hand-edited) so it can never drift from the
// files actually on disk; `_blog.gen.ts` stays untouched, and an admin-written post still overrides
// its seed entirely (see blog-live.ts), so this only ever fills in the code-generated seed posts.
const mapFile = join(root, 'src', 'lib', 'content', 'blog-images.ts');
const entries = merged.map((c) => `  '${c.slug}': '${c.file}',`).join('\n');
writeFileSync(
  mapFile,
  `// AUTO-GENERATED by scripts/fetch-blog-photos.ts — do not edit by hand.
// Hero photo per seed post. Sourced from Pexels (free for commercial use, no attribution required);
// provenance + photographer for every file is recorded in public/blog/credits.json.
// Only photos whose alt text NAMES a real Mauritian place are accepted — see the script header for why.

export const BLOG_HERO: Record<string, string> = {
${entries}
};
`,
  'utf8',
);

console.log(
  `\nfetched ${fetched}, skipped ${skipped} (already present), unresolved ${unresolved.length}`,
);
if (unresolved.length) console.log('unresolved:', unresolved.join(', '));
console.log(`manifest: public/blog/credits.json (${merged.length} photos)`);
console.log(`map:      src/lib/content/blog-images.ts (${merged.length} heroes)`);
