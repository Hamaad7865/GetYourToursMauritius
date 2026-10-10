import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The ZilAi assistant's shell, pinned at the points where a quiet edit breaks it without failing
 * anything else.
 *
 * Each of these is a property that looks identical in a DOM snapshot whether it holds or not: a
 * panel that shoves the page aside instead of sliding over it, a page that scrolls behind an open
 * sheet, a "button" where a link used to be, an assistant that has crept into every page's HTML.
 * The browser check (the page keeps its full width under the open panel, measured by geometry) is
 * the real proof; this is what keeps that proof true between browser checks.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
/** Comments explain why a class is absent; they must not be able to satisfy — or fail — a scan. */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const css = code(read('src/components/planner/assistant/zilai.css'));

/** The body of the first `@media (<query>) { … }` block, braces balanced. */
function mediaBlock(source: string, query: string): string {
  const start = source.indexOf(`@media ${query}`);
  expect(start, `no @media ${query} block`).toBeGreaterThan(-1);
  const open = source.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open + 1, i);
    }
  }
  throw new Error(`unbalanced @media ${query} block`);
}

describe('the panel is a modal sheet: it slides over the page and never moves it', () => {
  // The first build pushed the page aside on wide screens. The owner asked for a slide-over
  // instead, so "the page is not resized" is now the property worth pinning.
  it('adds no padding to the page', () => {
    expect(css).not.toMatch(/body\s*\{[^}]*padding-left/);
    expect(css).not.toContain('--zilai-offset');
  });

  it('leaves the homepage header spanning the full width, underneath the sheet', () => {
    const header = code(read('src/components/gyg/GygHeader.tsx'));
    expect(header).toContain('fixed inset-x-0 top-0');
    expect(header).not.toContain('--zilai-offset');
  });

  it('dims the page behind the open panel, and lets a click on it through to close', () => {
    const desktop = mediaBlock(css, '(min-width: 1024px)');
    expect(css.match(/\.zilai-scrim\s*\{([^}]*)\}/)?.[1]).toContain('pointer-events: none');
    expect(css).toMatch(
      /\.zilai-root\[data-open='true'\]\[data-canvas='false'\]\s+\.zilai-scrim\s*\{[^}]*pointer-events:\s*auto/,
    );
    // The panel is a fixed-width sheet from this width up (full-screen below it).
    expect(desktop).toMatch(/\.zilai-panel\s*\{[^}]*width:\s*var\(--zilai-w\)/);
  });

  it('slides in by transform, from off the left edge', () => {
    const closed = css.match(/\.zilai-panel\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(closed).toContain('position: fixed');
    expect(closed).toContain('transform: translateX(-100%)');
  });
});

describe('the page underneath cannot scroll while the assistant is open', () => {
  it('locks scroll for the panel and for the canvas alike', () => {
    expect(css).toMatch(/html\[data-zilai\]\s*\{[^}]*overflow:\s*hidden/);
  });
});

describe('a sideways scroller never traps the vertical scroll around it', () => {
  // The comparison table scrolls sideways inside a list that scrolls down. With overscroll
  // contained on both axes, a wheel turn over the table went nowhere: the plan would not scroll.
  it('lets vertical overscroll through', () => {
    expect(css).toMatch(/\.zilai-scroll-x\s*\{[^}]*overscroll-behavior:\s*contain auto/);
    // Declared after the blanket rule, which has the same specificity and would otherwise win.
    expect(css.indexOf('.zilai-scroll-x {')).toBeGreaterThan(css.indexOf('.zilai-scroll {'));
  });

  it('is used by every horizontal scroller in the assistant', () => {
    for (const file of ['CompareTable.tsx', 'ResultsCanvas.tsx']) {
      const source = code(read(`src/components/planner/assistant/${file}`));
      const horizontal = source.match(/className="[^"]*overflow-x-auto[^"]*"/g) ?? [];
      expect(horizontal.length, `${file} has no horizontal scroller`).toBeGreaterThan(0);
      for (const cls of horizontal) expect(cls, file).toContain('zilai-scroll-x');
    }
  });
});

describe('the canvas stays mounted while hidden', () => {
  it('is hidden by visibility + clip-path, never display:none (the map would be rebuilt)', () => {
    const rule = css.match(/\.zilai-canvas\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('visibility: hidden');
    expect(rule).toContain('clip-path');
    expect(rule).not.toMatch(/display:\s*none/);
  });
});

describe('reduced motion leaves everything visible', () => {
  const reduced = mediaBlock(css, '(prefers-reduced-motion: reduce)');

  it('restates the resting frame, not just "no animation"', () => {
    // Killing an animation alone strands an element whose base state is hidden. None is today;
    // this keeps the next keyframe someone adds from quietly becoming the first.
    for (const cls of ['.zilai-msg', '.zilai-card', '.zilai-node', '.zilai-spine', '.zilai-rise']) {
      expect(reduced, `${cls} missing from the reduced-motion reset`).toContain(cls);
    }
    expect(reduced).toMatch(/transform:\s*none\s*!important/);
    expect(reduced).toMatch(/opacity:\s*1\s*!important/);
  });

  it('keeps the highlighter as a static mark — it is information, not decoration', () => {
    expect(reduced).toMatch(/\.zilai-mark\s*\{[^}]*background-size:\s*100% 100%/);
  });
});

describe('the assistant costs a page nothing until it is opened', () => {
  const provider = code(read('src/components/planner/assistant/ZilAiProvider.tsx'));

  it('loads the dock on demand and never renders it on the server', () => {
    expect(provider).toMatch(/dynamic\(\s*loadDock\s*,\s*\{\s*ssr:\s*false\s*\}\s*\)/);
    expect(provider).not.toMatch(/from\s+'\.\/ZilAiDock'/);
  });

  it('ships its stylesheet with the dock, not with every page', () => {
    expect(code(read('src/components/planner/assistant/ZilAiDock.tsx'))).toContain(
      "import './zilai.css'",
    );
    expect(code(read('app/layout.tsx'))).not.toContain('zilai.css');
  });

  it('stays closed on checkout and in the back office', () => {
    expect(provider).toContain("startsWith('/checkout')");
    expect(provider).toContain("startsWith('/admin')");
  });
});

describe('"Plan with AI" is still a link', () => {
  const button = code(read('src/components/planner/assistant/PlanWithAiButton.tsx'));

  it('renders an anchor to the landing page (crawlable, middle-clickable, works without JS)', () => {
    expect(button).toContain('<Link');
    expect(button).toContain("'/ai-road-trip-planner'");
  });

  it('only intercepts a plain click', () => {
    expect(button).toContain('opensInPlace(e)');
  });

  it('sits in the header', () => {
    expect(code(read('src/components/gyg/GygHeader.tsx'))).toContain('<PlanWithAiButton />');
  });
});

describe('a private sightseeing tour can be customised from its own page', () => {
  const button = code(read('src/components/planner/assistant/CustomizeTourButton.tsx'));
  const tourPage = code(read('app/(site)/activities/[slug]/page.tsx'));

  it('is a link to the planner’s ?fromTour= form (new tab, crawler, no JS)', () => {
    expect(button).toContain('<Link');
    expect(button).toContain('/ai-road-trip-planner?fromTour=');
  });

  it('opens the assistant in place with that tour on a plain click', () => {
    expect(button).toContain('opensInPlace(e)');
    expect(button).toContain('openAssistant({ tourSlug: slug })');
  });

  it('is offered on vehicle-priced tours only — the ones the planner can rebuild', () => {
    const uses = tourPage.match(/<CustomizeTourButton\b/g) ?? [];
    expect(uses.length).toBeGreaterThan(0);
    // Every use sits inside a `pricingMode === 'vehicle'` condition.
    for (const m of tourPage.matchAll(/<CustomizeTourButton\b/g)) {
      const before = tourPage.slice(Math.max(0, m.index - 220), m.index);
      expect(before).toContain("pricingMode === 'vehicle'");
    }
  });
});

describe('the trip-date calendar opens on top of the panel, not underneath it', () => {
  // Every block in the panel has a held entrance animation, which makes each one a stacking layer:
  // a later block paints over an earlier one whatever z-index the calendar inside it has. The block
  // the calendar hangs out of has to be lifted itself. Shipped once without this — the calendar
  // opened behind the message box and the starter questions.
  const panel = code(read('src/components/planner/assistant/AssistantPanel.tsx'));

  it('lifts the dates block above the blocks that follow it', () => {
    expect(panel).toMatch(/className="zilai-view relative z-30[^"]*"/);
  });

  it('lifts the dates strip above the conversation', () => {
    expect(panel).toMatch(/className="relative z-20 shrink-0 border-b[^"]*"/);
  });

  it('keeps the menu above both', () => {
    expect(code(read('src/components/planner/assistant/PanelMenu.tsx'))).toContain(
      'absolute inset-0 z-40',
    );
  });
});
