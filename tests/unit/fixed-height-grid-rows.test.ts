import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards fixed-height layout grids against content-sized implicit rows.
 *
 * A `grid` with a pinned height (`h-[240px] sm:h-[360px]`) and column tracks but NO explicit row
 * definition has a trap: its single implicit row is auto-sized, so a child image's `h-full`
 * resolves as `auto` and the row grows to the image's intrinsic aspect-ratio height. The container
 * itself stays pinned (and `overflow: visible`), so the row paints straight past its bottom edge
 * over whatever flows next.
 *
 * That stayed latent in the activity gallery for as long as every catalog photo was landscape —
 * then the owner uploaded portrait 9:16 phone photos (2026-08-03) and the tile row inflated to
 * ~500px inside the 360px grid, drawing the tiles over the description and the trust strip below.
 *
 * The fix is an explicit `grid-rows-*` (Tailwind rows are `minmax(0, 1fr)`, so tracks clamp to the
 * container and `object-cover` crops the photo instead). This scan enforces that on every
 * fixed-height grid that declares column tracks under src/components, so the next gallery copied
 * from this pattern keeps it. Pure centering boxes (`grid h-[54px] place-items-center` icon
 * wrappers) declare no columns and are exempt on purpose.
 *
 * Source scan on purpose: the suite runs in the `node` environment with no jsdom (and jsdom has no
 * layout anyway) — this repo already guards drift this way (snap-rail-scroll-padding, edge-runtime).
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

/** `grid` as a standalone utility (any responsive/state prefix), not `grid-cols-*` etc. */
const isGrid = (cls: string) => /(?:^|[\s"'`])(?:[\w-]+:)?grid(?:$|[\s"'`])/.test(cls);
const hasFixedHeight = (cls: string) => /(?:^|[\s"'`])(?:[\w-]+:)?h-\[\d+(?:px|rem)\]/.test(cls);
const hasColumns = (cls: string) => /(?:^|[\s"'`])(?:[\w-]+:)?grid-cols-/.test(cls);
const hasRows = (cls: string) => /(?:^|[\s"'`])(?:[\w-]+:)?grid-rows-/.test(cls);

describe('fixed-height layout grids', () => {
  const grids = tsxFiles(COMPONENTS).flatMap((file) =>
    classNames(readFileSync(file, 'utf8'))
      .filter((cls) => isGrid(cls) && hasFixedHeight(cls) && hasColumns(cls))
      .map((cls) => ({ file: file.slice(process.cwd().length + 1), cls })),
  );

  it('finds the fixed-height column grids (guards against a broken scan)', () => {
    // The detail-page gallery exists today; zero means the scan broke, and the row assertion
    // below would pass vacuously.
    expect(grids.length).toBeGreaterThanOrEqual(1);
  });

  it.each(grids)('$file: a fixed-height column grid declares explicit rows', ({ file, cls }) => {
    expect(
      hasRows(cls),
      `${file}: this grid pins its height and declares column tracks but no grid-rows-*, so its ` +
        `implicit row is content-sized — one portrait image makes the row outgrow the pinned ` +
        `container and paint over the content below (gallery incident, 2026-08-03). Add ` +
        `grid-rows-N so the tracks clamp to the container and object-cover does the cropping.` +
        `\nclassName: ${cls}`,
    ).toBe(true);
  });
});
