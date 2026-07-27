/**
 * The character budgets every SEO surface is measured against — the editor counters, the Google
 * snippet preview and the health audit all read them from here so a title that shows "58/60" in
 * the editor can never be flagged as too long by the audit.
 *
 * The maxima are Google's practical display limits (pixel-based in reality, so treat them as
 * guidance). The minima are ours: shorter than this and the snippet is wasting space that could
 * carry a keyword or a reason to click.
 */
export const TITLE_BUDGET = 60;
export const DESC_BUDGET = 160;

/** Below these a title/description is too thin to be doing any work. */
export const TITLE_MIN = 20;
export const DESC_MIN = 70;
