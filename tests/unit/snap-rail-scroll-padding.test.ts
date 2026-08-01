import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the alignment of edge-to-edge snap rails (the home category carousels).
 *
 * A `snap-x snap-mandatory` scroller that fakes the page gutter with its own `px-*` padding has a
 * trap: CSS scroll snapping aligns cards to the SNAPPORT, which is the scroller's padding box — the
 * padding does not move it. So the first card's snap position is `scrollLeft = padding`, and since
 * Chrome re-snaps mandatory scrollers on load, every rail silently scrolled itself 24px right and
 * the first card sat flush with the screen edge while the section heading kept its 24px gutter
 * (reported on mobile 2026-08-01; scrollLeft was 24 on load with nobody touching the page).
 *
 * The fix is `scroll-px-*` matching the visual `px-*`: it insets the snapport to the content box,
 * making the first card's snap position scrollLeft=0 and every later snap land a gutter's width
 * from the edge. This scan enforces that pairing on every mandatory-snap scroller under
 * src/components so the next rail copied from this pattern keeps it.
 *
 * Source scan on purpose: the suite runs in the `node` environment with no jsdom (and jsdom has no
 * layout anyway) — this repo already guards drift this way (hydration-safety, edge-runtime).
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

/** Every className literal (quoted or template) in the file, template expressions included raw. */
function classNames(src: string): string[] {
  return [...src.matchAll(/className=\{?\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)].map(
    (m) => m[1] ?? m[2] ?? m[3] ?? '',
  );
}

const COMPONENTS = join(process.cwd(), 'src', 'components');

describe('mandatory snap rails', () => {
  const rails = tsxFiles(COMPONENTS).flatMap((file) =>
    classNames(readFileSync(file, 'utf8'))
      .filter((cls) => cls.includes('snap-mandatory'))
      .map((cls) => ({ file: file.slice(process.cwd().length + 1), cls })),
  );

  it('finds the snap rails (guards against a broken scan)', () => {
    // The home showcase rail and the shared <Rail> exist today; zero means the scan broke,
    // and the padding assertion below would pass vacuously.
    expect(rails.length).toBeGreaterThanOrEqual(2);
  });

  it.each(rails)('$file: a padded snap scroller insets its snapport to match', ({ file, cls }) => {
    const pads = /(?:^|[\s"'`])px-\d/.test(cls);
    const insets = /(?:^|[\s"'`])scroll-px-\d/.test(cls);

    expect(
      !pads || insets,
      `${file}: this snap-mandatory scroller sets its own px-* gutter but no matching scroll-px-*, ` +
        `so mandatory snapping aligns cards to the padding box and the browser re-snaps the first ` +
        `card flush with the edge on load. Add scroll-px-N equal to px-N.\nclassName: ${cls}`,
    ).toBe(true);
  });
});
