import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the SSR/client agreement on `/checkout`.
 *
 * The checkout page is a server component that renders the `'use client'` <Checkout>, so the tree is
 * server-rendered first and hydrated in the browser. React requires the client's FIRST render to
 * produce byte-identical text to the server's; when it doesn't, it throws away the server HTML and
 * re-renders the whole subtree (React #418) — on the money path, mid-booking.
 *
 * The trap is that the hold — id, expiry, idempotency key — lives in `sessionStorage`, which does not
 * exist on the server. `readHold()` therefore returns an EMPTY expiry during SSR and the real one in
 * the browser. Any render output seeded from it diverges by construction.
 *
 * That is not hypothetical: on 2026-07-31 production logged React #418 (`args[]=text`, a text
 * mismatch) from `/checkout?…&from=cart`. The server had sent "hold your spot for 30:00" while the
 * browser hydrated "28:23", because the countdown's `useState` initialiser read the stored expiry and
 * the clock during render. The remedy is to seed such state with the SAME constant the server uses and
 * correct it in an effect, which runs only after hydration.
 *
 * This test is a source scan rather than a render test on purpose: the suite runs in the `node`
 * environment with no jsdom or Testing Library, and this repo already guards drift this way
 * (see edge-runtime, migration-ledger, catch-up parity).
 */
const CHECKOUT = join(process.cwd(), 'src', 'components', 'checkout', 'Checkout.tsx');
const source = readFileSync(CHECKOUT, 'utf8');

/** Body of every `useState(() => { … })` / `useState(() => …)` lazy initialiser in the file. */
function lazyInitialisers(src: string): string[] {
  const found: string[] = [];
  const marker = 'useState(() =>';
  let at = src.indexOf(marker);
  while (at !== -1) {
    // Walk to the matching close paren of `useState(`, tracking nesting so nested calls don't end it.
    let depth = 0;
    let i = at + 'useState('.length - 1;
    for (; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(src.slice(at, i + 1));
    at = src.indexOf(marker, i);
  }
  return found;
}

describe('checkout hydration safety', () => {
  const initialisers = lazyInitialisers(source);

  it('finds the lazy state initialisers (guards against a broken scan)', () => {
    // If this drops to zero the assertions below pass vacuously.
    expect(initialisers.length).toBeGreaterThan(0);
  });

  it('never seeds render state from the clock', () => {
    // `Date.now()` in an initialiser cannot agree between the server render and the browser's
    // hydration render — they happen at different instants, on different machines.
    const offenders = initialisers.filter((block) => /Date\.now\(\)|new Date\(\)/.test(block));

    expect(
      offenders,
      `useState initialiser reads the clock, so SSR and hydration disagree:\n${offenders.join('\n---\n')}`,
    ).toEqual([]);
  });

  it('never seeds render state from the sessionStorage hold expiry', () => {
    // `expiresAt` comes from readHold(), which returns '' when `typeof window === 'undefined'`.
    // Seeding state from it makes the server render one countdown and the browser another.
    const offenders = initialisers.filter((block) => /\bexpiresAt\b/.test(block));

    expect(
      offenders,
      `useState initialiser reads the stored hold expiry, which is empty during SSR:\n${offenders.join('\n---\n')}`,
    ).toEqual([]);
  });

  it('still renders the countdown from state that an effect maintains', () => {
    // Belt and braces: the fix must keep the countdown working, not delete it.
    expect(source).toMatch(/hold your spot for \{time\} minutes/);
    expect(source).toMatch(/setSecs/);
  });
});
