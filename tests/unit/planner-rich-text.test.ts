import { describe, expect, it } from 'vitest';
import { parseInline, parseRichText } from '@/lib/planner/rich-text';

/* What ZilAi actually writes, and what the chat bubble has to make of it. The bug these guard: the
 * reply was printed as a raw string, so "* **Blue Bay Beach**" reached the visitor with its asterisks
 * intact and every line collapsed into one. */

describe('parseInline', () => {
  it('splits emphasis out of the surrounding words', () => {
    expect(parseInline('Start at **Blue Bay Beach** for the snorkelling')).toEqual([
      { text: 'Start at ', bold: false },
      { text: 'Blue Bay Beach', bold: true },
      { text: ' for the snorkelling', bold: false },
    ]);
  });

  it('handles a line that is only a name, and the __alt__ form', () => {
    expect(parseInline('**Gris Gris**')).toEqual([{ text: 'Gris Gris', bold: true }]);
    expect(parseInline('__Rochester Falls__')).toEqual([{ text: 'Rochester Falls', bold: true }]);
  });

  it('leaves an unmatched asterisk as literal text', () => {
    expect(parseInline('open 9–5 * closed Sunday')).toEqual([
      { text: 'open 9–5 * closed Sunday', bold: false },
    ]);
  });

  it('keeps state per call — a second call is not offset by the first', () => {
    parseInline('**one** **two**');
    expect(parseInline('**three**')).toEqual([{ text: 'three', bold: true }]);
  });
});

describe('parseRichText', () => {
  it('turns a bulleted list of bold names into list items, markers stripped', () => {
    const blocks = parseRichText(
      'Here is the south:\n\n* **Blue Bay Beach**\n* **Gris Gris** — rough sea\n- **Rochester Falls**',
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: 'paragraph',
      lines: [[{ text: 'Here is the south:', bold: false }]],
    });
    expect(blocks[1]!.kind).toBe('list');
    const list = blocks[1] as Extract<(typeof blocks)[number], { kind: 'list' }>;
    expect(list.items.map((i) => i.map((s) => s.text).join(''))).toEqual([
      'Blue Bay Beach',
      'Gris Gris — rough sea',
      'Rochester Falls',
    ]);
    expect(list.items[0]![0]!.bold).toBe(true);
  });

  it('never reads the opening ** of a bold name as a bullet marker', () => {
    const blocks = parseRichText('**Blue Bay Beach** is the one to start with.');
    expect(blocks[0]!.kind).toBe('paragraph');
  });

  it('keeps consecutive lines in one paragraph and a blank line as a break', () => {
    const blocks = parseRichText('Good pick.\nThe south suits you.\n\n1h 20 driving all in.');
    expect(blocks).toHaveLength(2);
    const first = blocks[0] as Extract<(typeof blocks)[number], { kind: 'paragraph' }>;
    expect(first.lines).toHaveLength(2);
  });

  it('strips heading hashes rather than leaking them, keeping the words', () => {
    const blocks = parseRichText('## Day 1\nStart early.');
    const para = blocks[0] as Extract<(typeof blocks)[number], { kind: 'paragraph' }>;
    expect(para.lines[0]).toEqual([{ text: 'Day 1', bold: true }]);
    expect(para.lines[1]![0]!.text).toBe('Start early.');
  });

  it('returns nothing for empty or whitespace-only text', () => {
    expect(parseRichText('')).toEqual([]);
    expect(parseRichText('  \n\n ')).toEqual([]);
  });

  it('handles CRLF line endings', () => {
    const blocks = parseRichText('One.\r\n\r\n* **Two**');
    expect(blocks.map((b) => b.kind)).toEqual(['paragraph', 'list']);
  });
});
