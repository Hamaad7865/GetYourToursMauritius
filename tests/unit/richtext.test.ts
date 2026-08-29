import { describe, expect, it } from 'vitest';
import { parseInline, parseBlocks, type InlineToken } from '@/lib/content/richtext';

/* The markdown-lite parser behind blog rich text. All the risk lives here (the React renderer is a
 * thin walk of this tree), so it is exercised hard: every mark, nesting, malformed input, the block
 * classifier and the legacy auto-links. */

/** Flatten a token tree back to its visible text — handy for asserting "renders as typed". */
function plain(tokens: InlineToken[]): string {
  return tokens.map((t) => (t.kind === 'text' ? t.value : plain(t.children))).join('');
}

describe('parseInline — inline marks', () => {
  it('leaves plain text as a single text token', () => {
    expect(parseInline('just words')).toEqual([{ kind: 'text', value: 'just words' }]);
  });

  it('parses bold and italic', () => {
    expect(parseInline('a **b** c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'strong', children: [{ kind: 'text', value: 'b' }] },
      { kind: 'text', value: ' c' },
    ]);
    expect(parseInline('a _b_ c')).toEqual([
      { kind: 'text', value: 'a ' },
      { kind: 'em', children: [{ kind: 'text', value: 'b' }] },
      { kind: 'text', value: ' c' },
    ]);
  });

  it('nests italic inside bold and bold inside a link label', () => {
    expect(parseInline('**a _b_**')).toEqual([
      {
        kind: 'strong',
        children: [
          { kind: 'text', value: 'a ' },
          { kind: 'em', children: [{ kind: 'text', value: 'b' }] },
        ],
      },
    ]);
    expect(parseInline('[**go**](/x)')).toEqual([
      {
        kind: 'link',
        href: '/x',
        newTab: false,
        children: [{ kind: 'strong', children: [{ kind: 'text', value: 'go' }] }],
      },
    ]);
  });
});

describe('parseInline — links', () => {
  it('parses an internal link, same tab by default', () => {
    expect(parseInline('[book](/airport)')).toEqual([
      {
        kind: 'link',
        href: '/airport',
        newTab: false,
        children: [{ kind: 'text', value: 'book' }],
      },
    ]);
  });

  it('opens in a new tab only when {_blank} is present — never inferred from the URL', () => {
    expect(parseInline('[x](https://a.com){_blank}')[0]).toMatchObject({ newTab: true });
    // An external URL WITHOUT the flag stays same-tab, so the editor checkbox is the single source
    // of truth — unchecking it is honoured.
    expect(parseInline('[x](https://a.com)')[0]).toMatchObject({ newTab: false });
  });

  it('trims the URL', () => {
    expect(parseInline('[x](  /y  )')[0]).toMatchObject({ href: '/y' });
  });

  it('does NOT auto-link a bare shortcut inside an explicit link label', () => {
    const [tok] = parseInline('[/activities](/somewhere)');
    expect(tok).toEqual({
      kind: 'link',
      href: '/somewhere',
      newTab: false,
      children: [{ kind: 'text', value: '/activities' }],
    });
  });
});

describe('parseInline — malformed input renders as typed, never throws', () => {
  const junk = ['**oops', 'a _ b', '[label](', '[no url]()', '[](/x)', '**', '_', '][()'];
  for (const s of junk) {
    it(`keeps ${JSON.stringify(s)} literal`, () => {
      expect(() => parseInline(s)).not.toThrow();
      expect(plain(parseInline(s))).toBe(s);
    });
  }
});

describe('parseInline — legacy auto-links', () => {
  it('turns the four bare internal paths into friendly links', () => {
    expect(parseInline('See /airport-transfers today')).toEqual([
      { kind: 'text', value: 'See ' },
      {
        kind: 'link',
        href: '/airport-transfers',
        newTab: false,
        children: [{ kind: 'text', value: 'airport transfers' }],
      },
      { kind: 'text', value: ' today' },
    ]);
  });

  it('prefers the longest path (planner, not a prefix of it)', () => {
    const [tok] = parseInline('/ai-road-trip-planner');
    expect(tok).toMatchObject({ kind: 'link', href: '/ai-road-trip-planner' });
  });
});

describe('parseBlocks — block classifier', () => {
  it('maps ### and #### to headings and everything else to paragraphs', () => {
    expect(parseBlocks(['### Head', '#### Sub', 'Body text']).map((b) => b.kind)).toEqual([
      'h3',
      'h4',
      'p',
    ]);
  });

  it('honours a heading marker only at the very start of the block', () => {
    const block = parseBlocks(['a ### not a heading'])[0]!;
    expect(block.kind).toBe('p');
    expect(plain(block.children)).toBe('a ### not a heading');
  });

  it('strips the marker and parses inline formatting in the heading', () => {
    const block = parseBlocks(['### See **this**'])[0]!;
    expect(block.kind).toBe('h3');
    expect(block.children).toEqual([
      { kind: 'text', value: 'See ' },
      { kind: 'strong', children: [{ kind: 'text', value: 'this' }] },
    ]);
  });

  it('drops blank paragraphs', () => {
    expect(parseBlocks(['', '   ', 'real'])).toHaveLength(1);
  });

  it('renders a plain-text post exactly as its text (no markers = no change)', () => {
    const paras = ['First paragraph with no marks.', 'Second one here.'];
    const blocks = parseBlocks(paras);
    expect(blocks.every((b) => b.kind === 'p')).toBe(true);
    expect(blocks.map((b) => plain(b.children))).toEqual(paras);
  });
});
