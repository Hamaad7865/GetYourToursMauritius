import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * `sr-only` never goes on a `<table>` itself; it goes on a `<div>` around it.
 *
 * `sr-only` hides text by shrinking its box to 1px × 1px with `overflow: hidden`. A table ignores all
 * three: it always grows to fit its cells, and overflow does not clip a table box. So an "sr-only"
 * table is still full size (about 225 × 190 px for the Today chart's week), merely invisible, and
 * positioned absolutely where it would have sat. On 16 Nov 2026 the "Money in" chart's table hung
 * below the bottom of the back office, so the page scrolled past the shell: the sticky sidebar slid
 * up off the logo and a white band showed under everything. A `<div className="sr-only">` around the
 * table is a real 1px box whose `overflow: hidden` holds the table in, and a screen reader still
 * reads the table inside it.
 */

const ROOT = process.cwd();

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return tsxFiles(full);
    return name.endsWith('.tsx') ? [full] : [];
  });
}

const rel = (file: string) =>
  file
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');

describe('screen-reader-only tables', () => {
  const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'src'))].map((file) => ({
    file: rel(file),
    src: readFileSync(file, 'utf8'),
  }));

  it('finds the files (guards against a broken scan)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(({ src }) => /<table[\s>]/.test(src))).toBe(true);
  });

  it('no <table> carries sr-only itself (wrap it in <div className="sr-only">)', () => {
    const offenders = files
      .filter(({ src }) => /<table\b[^>]*\bsr-only\b/.test(src))
      .map(({ file }) => file);
    expect(offenders, 'put sr-only on a <div> around the table instead').toEqual([]);
  });
});
