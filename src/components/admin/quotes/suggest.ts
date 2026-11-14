import {
  customLineDraft,
  formatMinorAsEuros,
  type QuoteLineDraft,
} from '@/components/admin/quotes/state';

/**
 * The one "add an item" box: what it suggests for what the operator has typed, and the line each
 * suggestion becomes. Pure.
 *
 * Three sources in one list, because that is how the work is actually done (209 of 278 real lines were
 * typed by hand, 58 came from the rental picker and 11 from "Add tour"):
 *
 *  - PAST LINES: every hand-typed (custom) line on an earlier quote, once per wording, at the price it
 *    was LAST quoted at. Picking one makes a custom line at that price, quantity one, which the
 *    operator then adjusts — it is a starting point, never a catalogue price.
 *  - CATALOGUE TOURS and FLEET VEHICLES: exactly what TourPicker and RentalPicker offer. Picking one
 *    does NOT build a line here; the screen opens that picker with the tour or vehicle chosen, so
 *    `tourLineDrafts` / `rentalLineDraft` remain the only builders of those lines and a picked tour is
 *    the very line "Add tour" makes.
 *  - NEW: the typed text as a new custom line, unpriced.
 */

/** Lowercase, accents stripped, whitespace collapsed: "  Île  aux Cerfs " -> "ile aux cerfs". */
export function searchKey(text: string | null | undefined): string {
  return String(text ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** One earlier custom line, as `loadCustomLineHistory` reads it. */
export interface PastLineRow {
  description: string | null;
  unitAmountMinor: number;
  /** When the quote it sits on was last saved — "last" means newest by this. */
  quotedAt: string;
}

export interface PastLine {
  description: string;
  unitAmountMinor: number;
  lastQuotedAt: string;
  /** How many earlier lines share this wording. */
  uses: number;
}

/** One entry per wording (by {@link searchKey}), at its newest price, newest first. */
export function pastLinesFrom(rows: readonly PastLineRow[]): PastLine[] {
  const byKey = new Map<string, PastLine>();
  for (const row of rows) {
    const description = (row.description ?? '').replace(/\s+/g, ' ').trim();
    const key = searchKey(description);
    if (!key) continue;
    const seen = byKey.get(key);
    if (!seen) {
      byKey.set(key, {
        description,
        unitAmountMinor: row.unitAmountMinor,
        lastQuotedAt: row.quotedAt,
        uses: 1,
      });
      continue;
    }
    seen.uses += 1;
    if (Date.parse(row.quotedAt) > Date.parse(seen.lastQuotedAt)) {
      seen.description = description;
      seen.unitAmountMinor = row.unitAmountMinor;
      seen.lastQuotedAt = row.quotedAt;
    }
  }
  return [...byKey.values()].sort(
    (a, b) => Date.parse(b.lastQuotedAt) - Date.parse(a.lastQuotedAt),
  );
}

export interface TourOption {
  id: string;
  title: string;
  status: string;
}

export interface VehicleOption {
  slug: string;
  name: string;
  dailyRateMinor: number;
}

export type ItemSuggestion =
  | { kind: 'past'; key: string; line: PastLine }
  | { kind: 'tour'; key: string; tour: TourOption }
  | { kind: 'vehicle'; key: string; vehicle: VehicleOption }
  | { kind: 'new'; key: string; text: string };

export interface SuggestionSources {
  past: readonly PastLine[];
  tours: readonly TourOption[];
  vehicles: readonly VehicleOption[];
}

const LIMIT = { past: 5, tours: 4, vehicles: 3 } as const;

/** 0 = starts with the query, 1 = a word starts with it, 2 = contains every word; null = no match. */
function rank(text: string, query: string): number | null {
  const key = searchKey(text);
  const words = query.split(' ').filter(Boolean);
  if (!words.every((w) => key.includes(w))) return null;
  if (key.startsWith(query)) return 0;
  if (key.split(' ').some((w) => w.startsWith(words[0]!))) return 1;
  return 2;
}

function ranked<T>(
  items: readonly T[],
  text: (item: T) => string,
  query: string,
  limit: number,
): T[] {
  return items
    .map((item, index) => ({ item, index, score: rank(text(item), query) }))
    .filter((x): x is { item: T; index: number; score: number } => x.score !== null)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .slice(0, limit)
    .map((x) => x.item);
}

/**
 * The list under the box. Nothing typed: the most recent past lines. Something typed: matching past
 * lines (newest first within a rank), tours, vehicles, then "add it as a new item".
 */
export function itemSuggestions(input: string, sources: SuggestionSources): ItemSuggestion[] {
  const query = searchKey(input);
  if (!query) {
    return sources.past
      .slice(0, LIMIT.past)
      .map((line) => ({ kind: 'past' as const, key: `past:${searchKey(line.description)}`, line }));
  }
  const tours = [...sources.tours].sort((a, b) => a.title.localeCompare(b.title));
  const vehicles = [...sources.vehicles].sort((a, b) => a.name.localeCompare(b.name));
  return [
    ...ranked(sources.past, (l) => l.description, query, LIMIT.past).map((line) => ({
      kind: 'past' as const,
      key: `past:${searchKey(line.description)}`,
      line,
    })),
    ...ranked(tours, (t) => t.title, query, LIMIT.tours).map((tour) => ({
      kind: 'tour' as const,
      key: `tour:${tour.id}`,
      tour,
    })),
    ...ranked(vehicles, (v) => v.name, query, LIMIT.vehicles).map((vehicle) => ({
      kind: 'vehicle' as const,
      key: `vehicle:${vehicle.slug}`,
      vehicle,
    })),
    { kind: 'new' as const, key: 'new', text: input.trim() },
  ];
}

/** A past line as a new custom line: its wording, its last price, quantity one. */
export function pastLineDraft(line: PastLine): QuoteLineDraft {
  return {
    ...customLineDraft(),
    description: line.description,
    unitText: formatMinorAsEuros(line.unitAmountMinor),
  };
}

/** Typed text as a new custom line, unpriced — the operator types the price. */
export function newItemDraft(text: string): QuoteLineDraft {
  return { ...customLineDraft(), description: text.trim() };
}
