/**
 * Search-result snippet sizing, shared by every content family that builds its meta description
 * from prose (attraction blurbs, area intros, French blog excerpts).
 *
 * Google shows roughly 155–160 characters of a description on desktop. A description that runs over
 * is cut wherever Google likes — usually mid-sentence — and one that was hard-sliced by us (the old
 * attraction builder did `.slice(0, 320)`) ends mid-word, which reads as broken and invites Google to
 * rewrite it from page text instead.
 */

/** The description budget. Kept a little under Google's window so the ellipsis never lands on us. */
export const SNIPPET_MAX = 155;

/** Abbreviations whose full stop is not a sentence end ("St. Regis", "Mt. Cocotte"). */
const ABBREVIATION = /\b(?:St|Ste|Mt|Dr|Mr|Mrs|Ms|No|vs|etc|approx|e\.g|i\.e)$/i;

/**
 * Fit prose into at most `max` characters: whole sentences first — a description that ends on a full
 * stop reads as written — and, when even the first sentence is too long, whole words plus "…". Never
 * cuts mid-word.
 */
export function fitSnippet(text: string, max: number = SNIPPET_MAX): string {
  const clean = normalise(text);
  if (clean.length <= max) return clean;
  const sentences = wholeSentences(clean, max);
  // A lone short sentence would waste most of the window; words + ellipsis say more.
  return sentences.length >= max * 0.6 ? sentences : wordCut(clean, max);
}

/**
 * `lead` plus a closing `tail` (a booking line). Prefers as many whole sentences of the lead as fit
 * WITH the tail; then whole sentences alone; only then a word cut. So a long first sentence keeps its
 * room, and a short one gets the tail instead of an ellipsis.
 */
export function snippetWithTail(lead: string, tail: string, max: number = SNIPPET_MAX): string {
  const clean = normalise(lead);
  if (clean.length + 1 + tail.length <= max) return `${clean} ${tail}`;
  const withTail = wholeSentences(clean, max - 1 - tail.length);
  if (withTail) return `${withTail} ${tail}`;
  return fitSnippet(clean, max);
}

function normalise(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** The longest run of whole sentences from the start of `clean` within `max`, or ''. */
function wholeSentences(clean: string, max: number): string {
  if (clean.length <= max && /[.!?]["”’)]?$/.test(clean)) return clean;
  let sentences = '';
  const end = /[.!?]["”’)]?(?= [A-ZÀ-ÝÉÎ«"“‘(0-9])/g;
  for (let m = end.exec(clean); m; m = end.exec(clean)) {
    const stop = m.index + m[0].length;
    if (stop > max) break;
    if (ABBREVIATION.test(clean.slice(0, m.index))) continue;
    sentences = clean.slice(0, stop);
  }
  return sentences;
}

function wordCut(clean: string, max: number): string {
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:–—-]+$/, '')}…`;
}
