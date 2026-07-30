import { describe, expect, it } from 'vitest';
import { frenchKeys, usedKeys } from '../../scripts/i18n-scan.mjs';

/**
 * The guard rail for "everything is French". Because a missing key falls back to the English source
 * string, an untranslated string renders as plausible English rather than an obvious error — so
 * nothing surfaces the gap at runtime. This test is the only thing that does.
 *
 * If this fails: add the printed key to the `fr` table in src/lib/i18n/messages.ts. Copy the key
 * from the failure output rather than retyping it — straight vs curly apostrophes are different
 * keys, and a mismatch silently falls back to English.
 */
describe('French translation coverage', () => {
  it('has a French translation for every t() key used in the codebase', () => {
    const fr = frenchKeys();
    const missing = [...usedKeys().entries()]
      .filter(([key]) => !fr.has(key))
      .map(([key, files]) => `${JSON.stringify(key)}  ← ${[...files][0]}`);

    expect(missing, `Missing French translations:\n${missing.join('\n')}`).toEqual([]);
  });

  it('scans a plausible number of files (guards against a broken scanner)', () => {
    // A regex or path change that silently matches nothing would make the test above vacuously
    // pass. Assert the scanner still finds the bulk of the table.
    expect(frenchKeys().size).toBeGreaterThan(1_000);
    expect(usedKeys().size).toBeGreaterThan(900);
  });
});
