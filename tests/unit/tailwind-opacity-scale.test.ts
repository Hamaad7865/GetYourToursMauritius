import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import resolveConfig from 'tailwindcss/resolveConfig';
import tailwindConfig from '../../tailwind.config';

/**
 * Guards the opacity modifier on colour utilities (`border-ink/10`, `bg-white/95`, …).
 *
 * The trap: an opacity step that is not on Tailwind's scale does not error, it simply produces NO
 * RULE. `border-ink/12` looks deliberate in the source, survives typecheck, lint and every test, and
 * ships — but no `.border-ink\/12` is ever generated, so the element falls through to whatever it
 * would have had anyway. For a border that is Tailwind preflight's default `borderColor.DEFAULT`,
 * i.e. gray-200 `rgb(229,231,235)`: near enough to the intended `rgb(10 46 54 / .12)` on a white card
 * that nobody notices, and wrong in hue rather than in weight. For a background there is no preflight
 * default at all, so `bg-white/97` renders fully TRANSPARENT — which is how the ZilAi saved-chats
 * overlay (`absolute inset-0 … bg-white/97 backdrop-blur-sm`) came to let the chat behind it show
 * straight through. Found 2026-08-09: 25 border usages across 17 files plus that one overlay.
 *
 * The scale is read from Tailwind's own resolved config rather than hardcoded, so this stays correct
 * across a Tailwind upgrade (v3.3 added the in-between steps 15/35/45/…) and picks up any
 * `theme.extend.opacity` we add later — extending the theme is the supported way to make a step like
 * 12 real, and doing so should make this test pass, not require editing it.
 *
 * Source scan on purpose: the suite runs in the `node` environment with no jsdom, and jsdom has no
 * CSS cascade anyway — this repo already guards drift this way (snap-rail-scroll-padding,
 * hydration-safety, edge-runtime).
 */

/** The opacity steps Tailwind will actually emit a rule for. */
const VALID_STEPS = new Set(Object.keys(resolveConfig(tailwindConfig).theme.opacity));

/**
 * Utilities that take a colour, and therefore an opacity modifier. Anchoring on these is what keeps
 * the scan off Tailwind's FRACTION utilities — `top-1/2`, `w-2/3`, `-translate-y-1/2` share the
 * `-N/N` shape but are unrelated and perfectly valid. The segment before the slash must be a colour
 * NAME (`ink`, `ink-muted`, `teal-dark`) or an arbitrary value (`[#0A2E36]`), never a number.
 */
const COLOUR_UTILITIES =
  'bg|text|border|ring|divide|outline|decoration|accent|caret|fill|stroke|placeholder|shadow|from|via|to';

const MODIFIER = new RegExp(
  // not preceded by a word char or hyphen, so `photo-ink/12` or a variant's `hover:` both behave
  `(?<![\\w-])(${COLOUR_UTILITIES})-` +
    // colour name (kebab) or arbitrary value — deliberately NOT a bare number
    `([a-z][a-z0-9]*(?:-[a-z][a-z0-9]*)*|\\[[^\\]\\s]+\\])` +
    // a plain integer modifier; `/[0.06]` and `/[.06]` are arbitrary and always generate, so skip them
    `\\/(\\d{1,3})(?![\\w.])`,
  'g',
);

/** Mirrors `content` in tailwind.config.ts — if that widens, widen this. */
const ROOTS = ['app', 'src'];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

const files = ROOTS.flatMap((root) => sourceFiles(join(process.cwd(), root)));

const usages = files.flatMap((file) =>
  [...readFileSync(file, 'utf8').matchAll(MODIFIER)].map((m) => ({
    file: file.slice(process.cwd().length + 1).replaceAll('\\', '/'),
    className: `${m[1]}-${m[2]}/${m[3]}`,
    // Every group is non-optional in MODIFIER, so a match always fills them; the fallback only
    // satisfies `noUncheckedIndexedAccess`, and '' is not on the scale so it would fail loudly
    // rather than silently pass if that ever stopped being true.
    step: m[3] ?? '',
  })),
);

describe('tailwind opacity modifiers', () => {
  it('reads a real opacity scale from the tailwind config', () => {
    // If theme.opacity ever resolves empty the assertion below would fail everything; if it somehow
    // resolved to "every number" it would pass everything. Pin both ends.
    expect(VALID_STEPS.has('10')).toBe(true);
    expect(VALID_STEPS.has('100')).toBe(true);
    expect(VALID_STEPS.has('12')).toBe(false);
  });

  it('finds the colour utilities (guards against a broken scan)', () => {
    // ~126 distinct colour/opacity classes exist today; zero means the regex or the walk broke and
    // the assertion below would pass vacuously.
    expect(usages.length).toBeGreaterThan(100);
  });

  it('only uses steps Tailwind will generate a rule for', () => {
    const offenders = usages.filter((u) => !VALID_STEPS.has(u.step));
    const detail = [...new Set(offenders.map((o) => `${o.className}  (${o.file})`))].join('\n  ');

    expect(
      offenders,
      `These opacity steps are not on Tailwind's scale (${[...VALID_STEPS].join(', ')}), so Tailwind ` +
        `emits NO rule for them and the element silently falls back — a border to preflight's ` +
        `gray-200, a background to transparent. Use a neighbouring step, an arbitrary modifier like ` +
        `/[0.12], or add the step to theme.extend.opacity.\n  ${detail}`,
    ).toEqual([]);
  });
});
