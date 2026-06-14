/**
 * Best-effort HTML extraction for the import script. The source pages are
 * Elementor (no structured product data), so this pulls candidate activity titles
 * from heading tags. It is intentionally conservative — its output is reviewed and
 * folded into seed/catalogue.json by hand, never trusted blindly.
 */
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&#8211;': '–',
  '&#8217;': '’',
  '&#039;': "'",
  '&quot;': '"',
};

export function stripHtml(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')
    .replace(/&[a-z#0-9]+;/gi, (m) => ENTITIES[m] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

/** Extracts deduplicated text from <h2>/<h3> headings (typical Elementor card titles). */
export function extractHeadings(html: string): string[] {
  const out: string[] = [];
  for (const match of html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi)) {
    const text = stripHtml(match[1] ?? '');
    if (text.length >= 3 && text.length <= 120) {
      out.push(text);
    }
  }
  return [...new Set(out)];
}
