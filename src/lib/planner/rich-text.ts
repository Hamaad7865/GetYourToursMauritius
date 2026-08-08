/**
 * The tiny slice of Markdown ZilAi actually writes, parsed into data the chat bubble can render as
 * real React nodes.
 *
 * The model emphasises place and activity names with `**double asterisks**` and lists options with
 * `* ` bullets. Rendered as a raw string those markers leak into the bubble — the visitor reads
 * "* **Blue Bay Beach** * **Gris Gris**" as one run-on line, which reads like a broken machine
 * rather than a local answering them. Parsing here (pure, testable, no `dangerouslySetInnerHTML`)
 * keeps the renderer a plain React tree, so nothing the model writes can inject markup.
 *
 * Deliberately NOT a Markdown implementation: no links, images, code or tables. The model is told to
 * write prose, and anything outside this subset falls through as literal text rather than
 * disappearing.
 */

/** One run of text inside a line, flagged when the model wrapped it for emphasis. */
export interface RichSpan {
  text: string;
  bold: boolean;
}

/** A block of an assistant reply: a paragraph (its lines) or a bullet list (its items). */
export type RichBlock =
  | { kind: 'paragraph'; lines: RichSpan[][] }
  | { kind: 'list'; items: RichSpan[][] };

/** A bullet marker opening a line. The trailing space is required — that is what keeps the opening
 *  `**` of a bold name from reading as a bullet. */
const BULLET = /^ {0,4}[*+•-][ \t]+/;
/** A Markdown heading. We don't render headings inside a chat bubble, but the hashes must not leak. */
const HEADING = /^ {0,3}#{1,6}[ \t]+/;

/** Split one line into plain and emphasised runs. Unmatched `*` stays literal. */
export function parseInline(text: string): RichSpan[] {
  // Built per call: a module-level /g regex carries `lastIndex` between callers.
  const emphasis = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  const spans: RichSpan[] = [];
  let last = 0;
  for (let m = emphasis.exec(text); m; m = emphasis.exec(text)) {
    if (m.index > last) spans.push({ text: text.slice(last, m.index), bold: false });
    spans.push({ text: m[1] ?? m[2] ?? '', bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), bold: false });
  return spans;
}

/** Parse an assistant reply into renderable blocks. */
export function parseRichText(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let lines: RichSpan[][] = [];
  let items: RichSpan[][] = [];

  const flushParagraph = () => {
    if (lines.length) {
      blocks.push({ kind: 'paragraph', lines });
      lines = [];
    }
  };
  const flushList = () => {
    if (items.length) {
      blocks.push({ kind: 'list', items });
      items = [];
    }
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) {
      // A blank line ends whichever block is open — only one ever is.
      flushList();
      flushParagraph();
      continue;
    }
    const bullet = BULLET.exec(raw);
    if (bullet) {
      flushParagraph();
      items.push(parseInline(raw.slice(bullet[0].length).trim()));
      continue;
    }
    flushList();
    const heading = HEADING.exec(raw);
    // A heading becomes an emphasised line: chat bubbles have no heading level, and dropping the
    // text would lose the day label the model was trying to give.
    lines.push(
      heading ? [{ text: raw.slice(heading[0].length).trim(), bold: true }] : parseInline(line),
    );
  }

  flushList();
  flushParagraph();
  return blocks;
}
