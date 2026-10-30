import type { TourSummary } from '@/lib/validation/tours';
import type { HomePicks } from '@/lib/validation/home-picks';
import type { Interest } from '@/lib/recent/interest';
import { HOME_TOURS_MAX, homeTile, pickHomeTours, type HomeTour } from './home-tours';

/**
 * Which row the homepage shows under the hero, and which tours are in it
 * (docs/superpowers/specs/2026-10-17-first-visit-home-row-design.md). First rule that fits wins:
 *
 *   1. guides  — the tours of the guides this visitor read (newest guide first), minus what
 *                "Continue planning" already shows; on the island, the ones free tomorrow first.
 *   2. island  — browsing from Mauritius: tours with a free seat tomorrow, most booked first.
 *   3. popular — everyone else: our most-booked tours (api_home_picks).
 *   4. private — today's row, when the picks are missing or too thin: the private day tours.
 *
 * Every heading is a claim about every tile under it, so no row tops up with tours it does not describe:
 * a row that cannot fill HOME_ROW_MIN tiles truthfully falls through to the next rule instead.
 *
 * Pure: the server calls it with no interest and no location (rules 3–4 — what Google sees); the browser
 * calls it again with both.
 */

export type HomeRowVariant = 'guides' | 'island' | 'popular' | 'private';

/** Fewer tiles than this and the row's heading would oversell it. */
export const HOME_ROW_MIN = 3;

export interface HomeRowInput {
  /** The catalogue, in catalogue order (the homepage's searchActivities result). */
  activities: readonly TourSummary[];
  /** api_home_picks, or null when it could not be loaded. */
  picks: HomePicks | null;
  /** Tomorrow in Mauritius as the caller sees it; null trusts `picks.date` (the server, at render). */
  tomorrow: string | null;
  /** Guides read, newest first (gytm:interest). */
  interest?: readonly Interest[];
  /** Slugs already shown in "Continue planning": cart, viewed, wishlist. */
  continuing?: readonly string[];
  /** Browsing from Mauritius (/api/planner/locality). */
  onIsland?: boolean;
}

export interface HomeRow {
  variant: HomeRowVariant;
  tiles: HomeTour[];
}

/** Up to HOME_TOURS_MAX tiles for these slugs, in order: each once, skipping `skip`, unknown and photo-less tours. */
function tilesFor(
  slugs: Iterable<string>,
  bySlug: ReadonlyMap<string, TourSummary>,
  skip: ReadonlySet<string> = new Set(),
): HomeTour[] {
  const out: HomeTour[] = [];
  const seen = new Set<string>();
  for (const slug of slugs) {
    if (out.length >= HOME_TOURS_MAX) break;
    if (seen.has(slug) || skip.has(slug)) continue;
    seen.add(slug);
    const tour = bySlug.get(slug);
    const tile = tour ? homeTile(tour) : null;
    if (tile) out.push(tile);
  }
  return out;
}

export function chooseHomeRow(input: HomeRowInput): HomeRow {
  const { activities, picks } = input;
  const bySlug = new Map(activities.map((a) => [a.slug, a]));
  // A cached answer read after midnight is about today, not tomorrow: then nothing counts as free.
  const freshFree =
    picks && (input.tomorrow === null || picks.date === input.tomorrow) ? picks.freeTomorrow : [];
  const free = new Set(freshFree);

  // 1. Guides read.
  const guideSlugs = [...new Set((input.interest ?? []).flatMap((i) => i.slugs))];
  const ordered = input.onIsland
    ? [...guideSlugs.filter((s) => free.has(s)), ...guideSlugs.filter((s) => !free.has(s))]
    : guideSlugs;
  const guides = tilesFor(ordered, bySlug, new Set(input.continuing ?? []));
  if (guides.length >= HOME_ROW_MIN) return { variant: 'guides', tiles: guides };

  // 2. On the island.
  if (input.onIsland && picks && free.size > 0) {
    const ranked = picks.mostBooked.filter((s) => free.has(s));
    const rest = activities.map((a) => a.slug).filter((s) => free.has(s));
    const island = tilesFor([...ranked, ...rest], bySlug);
    if (island.length >= HOME_ROW_MIN) return { variant: 'island', tiles: island };
  }

  // 3. Most booked.
  if (picks) {
    const popular = tilesFor(picks.mostBooked, bySlug);
    if (popular.length >= HOME_ROW_MIN) return { variant: 'popular', tiles: popular };
  }

  // 4. Today's row.
  return { variant: 'private', tiles: pickHomeTours(activities) };
}

/** The row's heading. Literal t() calls on purpose, so scripts/i18n-scan.mjs sees every key. */
export function homeRowHeading(variant: HomeRowVariant, t: (key: string) => string): string {
  switch (variant) {
    case 'guides':
      return t('Picked from the guides you’ve read');
    case 'island':
      return t('Still free tomorrow');
    case 'popular':
      return t('Most booked by our guests');
    case 'private':
      return t('Private day tours with your own driver');
  }
}

/** Tomorrow's date in Mauritius (UTC+4, no DST) as YYYY-MM-DD — what api_home_picks calls `date`. */
export function mauritiusTomorrow(now: Date): string {
  return new Date(now.getTime() + (4 + 24) * 3_600_000).toISOString().slice(0, 10);
}

const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((s) => typeof s === 'string');

/**
 * A /activities/picks answer, checked by hand in the browser: homePicksSchema is the contract, but zod
 * is not in the homepage's bundle and this row should not be what puts it there.
 */
export function isHomePicks(value: unknown): value is HomePicks {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.date === 'string' && isStrings(v.mostBooked) && isStrings(v.freeTomorrow);
}
