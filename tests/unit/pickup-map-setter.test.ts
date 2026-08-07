import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards every `<PickupMap>` caller that keeps its address and its coordinates in ONE state object.
 *
 * PickupMap fires TWO callbacks for a single keystroke: `onChange(address)` with the new text, and
 * `onCoords(null)` to drop any point resolved earlier (free-typed text is not a place, and a stale
 * lat/lng would price a different address). React batches both into one render.
 *
 * If each handler rebuilds the state object — `setPickup({ ...pickup, label })` then
 * `setPickup({ label: pickup.label, coords })` — both read the SAME pre-keystroke `pickup` from the
 * render closure, so the second call resurrects the old label and the last write wins. The admin
 * quote drawer shipped exactly that: typing in "Guest's hotel or address" reverted every character
 * in the same tick, so the field looked dead and no Places suggestions could ever appear.
 *
 * Functional updaters compose instead of overwriting, in either order. This scan enforces them.
 *
 * Source scan on purpose: the suite runs in `node` with no jsdom (and jsdom has no layout or
 * batching semantics to assert against) — the repo already guards drift this way, see
 * fixed-height-grid-rows and snap-rail-scroll-padding.
 */

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

/** Files that render <PickupMap ... /> — the ones whose handlers this rule is about. */
function pickupMapCallers(): { file: string; src: string }[] {
  return tsxFiles(join(process.cwd(), 'src', 'components'))
    .map((file) => ({ file, src: readFileSync(file, 'utf8') }))
    .filter(({ src, file }) => /<PickupMap[\s/>]/.test(src) && !file.endsWith('PickupMap.tsx'));
}

/**
 * Object-literal setter calls: `setX({ … })`. The functional form `setX((cur) => …)` opens with a
 * paren or an identifier, never a brace, so this matches only the unsafe shape.
 */
function objectLiteralSetterCalls(src: string): string[] {
  return [...src.matchAll(/\bset[A-Z]\w*\(\s*\{/g)].map((m) => m[0]);
}

describe('PickupMap callers update their state functionally', () => {
  it('finds the callers to check (a rename must not silently empty this suite)', () => {
    expect(pickupMapCallers().length).toBeGreaterThan(0);
  });

  it.each(pickupMapCallers().map(({ file }) => file))(
    '%s passes onChange/onCoords handlers that do not rebuild state from a stale closure',
    (file) => {
      const src = readFileSync(file, 'utf8');
      // Only the handlers wired into PickupMap matter — a setter elsewhere in the file is fine.
      const call = /<PickupMap\b[\s\S]*?\/>/.exec(src)?.[0] ?? '';
      expect(call, `no <PickupMap …/> found in ${file}`).not.toBe('');
      expect(
        objectLiteralSetterCalls(call),
        `${file} passes an object literal to a state setter inside <PickupMap>. onChange and ` +
          `onCoords both fire on one keystroke, so an object rebuilt from the render closure ` +
          `reverts the other half. Use the functional form: setX((cur) => ({ ...cur, … })).`,
      ).toEqual([]);
    },
  );
});
