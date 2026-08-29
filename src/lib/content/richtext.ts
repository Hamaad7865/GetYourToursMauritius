/*
 * Markdown-lite for blog section bodies.
 *
 * The SEO editor writes a tiny, fixed subset of formatting into the plain-text `paragraphs` a post
 * already stores — no schema change, no HTML. This module is the PARSER only: pure functions that
 * turn a string into a token tree. The React renderer (`@/components/content/RichText`) walks that
 * tree, and the admin preview walks the exact same tree, so the preview cannot drift from the live
 * article. Kept JSX-free on purpose: it unit-tests as a plain `.ts` file (the vitest suite only
 * collects `.ts` tests, not `.tsx`) and stays edge-safe.
 *
 * Grammar (block-level, one entry per already-split paragraph):
 *   "### text"  -> h3      "#### text" -> h4      anything else -> p
 * Inline (nestable, applied inside any block):
 *   **bold**    _italic_   [label](url)   [label](url){_blank}   (the {_blank} => new tab)
 * Plus the four legacy internal shortcuts that older posts embed as bare paths.
 */

export type InlineToken =
  | { kind: 'text'; value: string }
  | { kind: 'strong'; children: InlineToken[] }
  | { kind: 'em'; children: InlineToken[] }
  | { kind: 'link'; href: string; newTab: boolean; children: InlineToken[] };

export type Block = { kind: 'p' | 'h3' | 'h4'; children: InlineToken[] };

/* Bare internal paths older posts wrote into prose, turned into friendly-labelled links. Longest-
 * first so alternation never settles for a prefix. Kept verbatim from the previous page-local
 * renderer so existing articles keep every link they had. */
const AUTO_LINKS: Record<string, string> = {
  '/ai-road-trip-planner': 'AI trip planner',
  '/airport-transfers': 'airport transfers',
  '/attractions': 'things to do in Mauritius',
  '/activities': 'tours & activities',
};
const AUTO_LINK_RE = /(\/ai-road-trip-planner|\/airport-transfers|\/attractions|\/activities)/g;

const NEW_TAB = '{_blank}';

/** Split a run of plain text into text + auto-link tokens. Never runs inside an explicit link
 *  (that would nest a link in a link), so callers pass autoLink=false in that context. */
function emitText(text: string, autoLink: boolean): InlineToken[] {
  if (!text) return [];
  if (!autoLink) return [{ kind: 'text', value: text }];
  const out: InlineToken[] = [];
  for (const part of text.split(AUTO_LINK_RE)) {
    if (!part) continue;
    if (AUTO_LINKS[part]) {
      out.push({
        kind: 'link',
        href: part,
        newTab: false,
        children: [{ kind: 'text', value: AUTO_LINKS[part] }],
      });
    } else {
      out.push({ kind: 'text', value: part });
    }
  }
  return out;
}

/** A link starting at `open` ("["). Returns the parsed pieces and the index just past it, or null
 *  when the shape isn't a complete `[label](url)` — in which case the "[" is treated as literal. */
function matchLink(
  text: string,
  open: number,
): { label: string; href: string; newTab: boolean; end: number } | null {
  const closeBracket = text.indexOf(']', open + 1);
  if (closeBracket === -1 || text[closeBracket + 1] !== '(') return null;
  const closeParen = text.indexOf(')', closeBracket + 2);
  if (closeParen === -1) return null;
  const href = text.slice(closeBracket + 2, closeParen).trim();
  const label = text.slice(open + 1, closeBracket);
  if (!href || !label.trim()) return null; // an empty URL or empty label is not a link
  let end = closeParen + 1;
  const newTab = text.startsWith(NEW_TAB, end);
  if (newTab) end += NEW_TAB.length;
  return { label, href, newTab, end };
}

/**
 * Parse inline formatting into a token tree. Recurses for nesting (bold inside a link, italic inside
 * bold). An unterminated marker (`**oops`, a lone `_`) is emitted as the literal character, so
 * malformed input renders as typed and never throws.
 */
export function parseInline(text: string, autoLink = true): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buf = '';
  let i = 0;
  const flush = () => {
    if (buf) tokens.push(...emitText(buf, autoLink));
    buf = '';
  };

  while (i < text.length) {
    const ch = text[i];

    if (ch === '[') {
      const link = matchLink(text, i);
      if (link) {
        flush();
        tokens.push({
          kind: 'link',
          href: link.href,
          newTab: link.newTab,
          children: parseInline(link.label, false),
        });
        i = link.end;
        continue;
      }
    }

    if (ch === '*' && text[i + 1] === '*') {
      const close = text.indexOf('**', i + 2);
      if (close !== -1) {
        flush();
        tokens.push({ kind: 'strong', children: parseInline(text.slice(i + 2, close), autoLink) });
        i = close + 2;
        continue;
      }
    }

    if (ch === '_') {
      const close = text.indexOf('_', i + 1);
      if (close > i + 1) {
        flush();
        tokens.push({ kind: 'em', children: parseInline(text.slice(i + 1, close), autoLink) });
        i = close + 1;
        continue;
      }
    }

    buf += ch;
    i += 1;
  }

  flush();
  return tokens;
}

/**
 * Classify each already-split paragraph as a heading (H3/H4) or a paragraph, then parse its inline
 * formatting. The heading marker is only honoured at the very start of the block, so a "###" mid-
 * sentence stays literal. Blank paragraphs are dropped.
 */
export function parseBlocks(paragraphs: string[]): Block[] {
  const blocks: Block[] = [];
  for (const para of paragraphs) {
    if (!para.trim()) continue;
    const h4 = /^#{4}\s+/.exec(para);
    const h3 = !h4 && /^#{3}\s+/.exec(para);
    if (h4) {
      blocks.push({ kind: 'h4', children: parseInline(para.slice(h4[0].length)) });
    } else if (h3) {
      blocks.push({ kind: 'h3', children: parseInline(para.slice(h3[0].length)) });
    } else {
      blocks.push({ kind: 'p', children: parseInline(para) });
    }
  }
  return blocks;
}
