/**
 * Generates the per-activity review pool from the raw scrape.
 *
 *   node scripts/gen-review-pool.mjs
 *
 * Reads  data/belle-mare-tours-reviews.json (1,058 real TripAdvisor + Google reviews of Belle Mare
 * Tours, the OPERATOR — not of individual activities) and emits two files:
 *
 *   src/lib/content/_review-pool.gen.ts   the usable reviews, each TAGGED with the topics its text
 *                                         mentions (catamaran, hiking, transfer, …). Server-only:
 *                                         it's ~200 KB and must never reach the client bundle.
 *   src/lib/content/_review-stats.gen.ts  the per-topic aggregate (avg + count) for the RESOLVED set.
 *                                         Tiny + client-safe: the listing cards read it.
 *
 * Both are derived from the same resolved set, so a card's "4.9 (81)" always matches the number of
 * reviews its detail page draws from. Topics with too few matches collapse to `general`.
 *
 * This tagging is what "relevance" means here: a review that talks about the catamaran is shown on
 * catamaran tours. It never claims the reviewer took that exact tour — the page labels the block as
 * operator-wide reviews, and the JSON-LD aggregateRating still reads the activity's REAL DB rating.
 */
import { readFileSync, writeFileSync } from 'node:fs';

/** A topic bucket must have at least this many reviews, else it collapses to `general`. */
const MIN_TOPIC_REVIEWS = 12;
/** How many reviews any one topic keeps (newest-first after sorting), to bound the bundle. */
const MAX_PER_TOPIC = 120;

/** Which topics a review's own words put it in. A review can carry several. */
const TOPIC_PATTERNS = {
  catamaran:
    /\b(catamaran|sail(?:ing|boat)?|cruise|boat trip|ile aux cerfs|île aux cerfs|deer island)\b/i,
  speedboat: /\b(speed ?boat|speedboat|benitiers|bénitiers|crystal rock)\b/i,
  dolphin: /\bdolphins?\b/i,
  hiking:
    /\b(hike|hiking|trek(?:king)?|waterfall|mountain|climb|le morne|black river|gorges|chamarel)\b/i,
  sightseeing: /\b(tour|excursion|driver|guide|sightseeing|day trip|port louis|grand bassin)\b/i,
  transfer: /\b(airport|transfer(?:red|s)?|pick(?:ed|s)?[- ]?up|pickup|driver|chauffeur|taxi)\b/i,
  rental: /\b(scooter|rent(?:al|ed|ing)?|car hire|quad|bike)\b/i,
  water: /\b(snorkel(?:l?ing)?|swim(?:ming)?|sea|beach|lagoon|reef|kayak|paddle|dive|diving)\b/i,
  air: /\b(helicopter|helico|parasail(?:ing)?|skydive|seaplane)\b/i,
};
const TOPICS = Object.keys(TOPIC_PATTERNS);

const raw = JSON.parse(readFileSync('data/belle-mare-tours-reviews.json', 'utf8'));

/** Usable = genuinely positive, substantive, English, human-written (not machine-translated). */
const usable = raw.reviews.filter(
  (r) =>
    r.rating >= 4 &&
    typeof r.text === 'string' &&
    r.text.length >= 80 &&
    r.text.length <= 900 &&
    (r.language === 'en' || !r.language) &&
    !r.machineTranslated &&
    r.author,
);

const hay = (r) => `${r.title ?? ''} ${r.text}`;
const topicsOf = (r) => TOPICS.filter((t) => TOPIC_PATTERNS[t].test(hay(r)));

// Sort deterministically: most helpful first, then newest, then id — stable across runs.
const sorted = [...usable].sort(
  (a, b) =>
    (b.helpfulVotes ?? 0) - (a.helpfulVotes ?? 0) ||
    String(b.publishedDate ?? '').localeCompare(String(a.publishedDate ?? '')) ||
    String(a.id).localeCompare(String(b.id)),
);

// Keep any review that lands in at least one topic, capped per topic so no bucket dominates the file.
const kept = [];
const perTopic = Object.fromEntries(TOPICS.map((t) => [t, 0]));
for (const r of sorted) {
  const topics = topicsOf(r);
  if (topics.length === 0) continue;
  if (!topics.some((t) => perTopic[t] < MAX_PER_TOPIC)) continue;
  topics.forEach((t) => (perTopic[t] += 1));
  kept.push({
    id: String(r.id),
    source: r.source,
    rating: r.rating,
    title: r.title ?? null,
    text: r.text.trim(),
    author: r.author,
    date: r.publishedDate ?? r.travelDate ?? null,
    url: r.url ?? null,
    topics,
  });
}

// ---------------------------------------------------------------------------------------------
// Ratings are computed over EVERY review that mentions the topic — all star ratings, all languages,
// not just the readable 4★+ English ones we display. Averaging only the kept (4★+) set would report
// a flattering 4.9 against the operator's true 4.75, i.e. cherry-picking. The displayed reviews are
// a curated subset; the number above them is the honest aggregate for that topic.
// ---------------------------------------------------------------------------------------------
const round1 = (n) => Math.round(n * 10) / 10;
function statsOf(set) {
  return { avg: round1(set.reduce((s, r) => s + r.rating, 0) / set.length), count: set.length };
}

/**
 * Operator-wide aggregate. Taken from the EXISTING REVIEW_STATS (4.8 / 1,076 — the platforms' own
 * reported totals) rather than re-averaging the scraped rows (which yields 4.7 / 1,058, since Google
 * capped the scrape at 99 of 117). Reusing it keeps the homepage, /reviews and every activity page
 * quoting the same headline number.
 */
const statsSrc = readFileSync('src/lib/content/_reviews.gen.ts', 'utf8');
const totalM = statsSrc.match(/"total":\s*(\d+)/);
const avgM = statsSrc.match(/"average":\s*([\d.]+)/);
if (!totalM || !avgM)
  throw new Error('could not read REVIEW_STATS total/average from _reviews.gen.ts');
const generalStats = { avg: Number(avgM[1]), count: Number(totalM[1]) };

/** Every scraped review mentioning the topic, whatever its rating or language. */
function topicMatchedAll(topic) {
  return raw.reviews.filter((r) => r.text && TOPIC_PATTERNS[topic].test(hay(r)));
}

const stats = { general: { ...generalStats, collapsed: false } };
for (const t of TOPICS) {
  const all = topicMatchedAll(t);
  const display = kept.filter((r) => r.topics.includes(t));
  // A topic needs enough matched reviews AND enough readable ones to display, else it collapses.
  // `collapsed` is exported so the RUNTIME pool falls back to the whole set for the same topics —
  // one rule, or a page's header aggregate and its review texts come from different sets.
  const ok = all.length >= MIN_TOPIC_REVIEWS && display.length >= 6;
  stats[t] = ok ? { ...statsOf(all), collapsed: false } : { ...generalStats, collapsed: true };
}

const banner = (from) =>
  `// AUTO-GENERATED by scripts/gen-review-pool.mjs from ${from}. Do not edit by hand.\n`;

writeFileSync(
  'src/lib/content/_review-stats.gen.ts',
  banner('data/belle-mare-tours-reviews.json') +
    `import type { ReviewTopic } from './review-topics';\n\n` +
    `/** Per-topic aggregate over the RESOLVED review set (topics under the minimum collapse to\n` +
    ` *  \`general\`), so a listing card's rating always matches its detail page's review block. */\n` +
    `export const TOPIC_STATS: Record<ReviewTopic, { avg: number; count: number; collapsed: boolean }> = ${JSON.stringify(stats, null, 2)};\n`,
  'utf8',
);

writeFileSync(
  'src/lib/content/_review-pool.gen.ts',
  banner('data/belle-mare-tours-reviews.json') +
    `import type { ReviewTopic } from './review-topics';\n\n` +
    `export interface PoolReview {\n` +
    `  id: string;\n  source: string;\n  rating: number;\n  title: string | null;\n` +
    `  text: string;\n  author: string;\n  date: string | null;\n  url: string | null;\n` +
    `  topics: ReviewTopic[];\n}\n\n` +
    `/** SERVER-ONLY (~${Math.round(JSON.stringify(kept).length / 1024)} KB). Never import from a 'use client' module. */\n` +
    `export const REVIEW_POOL: PoolReview[] = ${JSON.stringify(kept, null, 2)};\n`,
  'utf8',
);

console.log(`usable: ${usable.length}  kept: ${kept.length}`);
console.table(stats);
