import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

/**
 * The fonts live in app/fonts and are loaded with next/font/local. next/font/google fetched them from
 * Google on every `next build`, and from 2026-11-02 that fetch kept failing in CI ("Cannot read
 * properties of null (reading '1')"). A red build stops the release, so the work being shipped never
 * went live until someone re-ran the job.
 *
 * Each family is split in two. Its latin file is loaded by a localFont() call; its other character
 * subsets and its size-matched fallback are declared in app/fonts/fonts.css. The halves must agree:
 * - on the family name, or the subsets never join the font;
 * - on the weight range, or `font-extrabold` text renders heavier in one subset than in the other;
 * - on the fallback, which must be the pinned face in fonts.css, not one next/font/local computes
 *   (for Bricolage that came out 7% larger than before).
 */

const ROOT = process.cwd();
const FONTS_CSS = join(ROOT, 'app', 'fonts', 'fonts.css');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

const rel = (file: string) =>
  file
    .slice(ROOT.length + 1)
    .split(sep)
    .join('/');

const files = [...sourceFiles(join(ROOT, 'app')), ...sourceFiles(join(ROOT, 'src'))].map(
  (file) => ({ file, src: readFileSync(file, 'utf8') }),
);

/** Every localFont({ … }) call: the file it loads, its weight range, family name and fallback. */
const localFonts = files.flatMap(({ file, src }) =>
  [...src.matchAll(/localFont\(\{([\s\S]*?)\n\}\);/g)].map(([, body]) => ({
    file: rel(file),
    path: resolve(dirname(file), /src: '([^']+)'/.exec(body!)?.[1] ?? ''),
    weight: /weight: '([^']+)'/.exec(body!)?.[1],
    family: /prop: 'font-family', value: '([^']+)'/.exec(body!)?.[1],
    fallback: /fallback: \['([^']+)'\]/.exec(body!)?.[1],
    computesFallback: !/adjustFontFallback: false/.test(body!),
  })),
);

/** Every @font-face in fonts.css: family, weight range and the file it points at (if any). */
const css = readFileSync(FONTS_CSS, 'utf8');
const faces = [...css.matchAll(/@font-face \{([\s\S]*?)\}/g)].map(([, body]) => ({
  family: /font-family: '([^']+)'/.exec(body!)?.[1],
  weight: /font-weight: ([^;]+);/.exec(body!)?.[1],
  url: /url\('([^']+)'\)/.exec(body!)?.[1],
  local: /src: local\('([^']+)'\)/.exec(body!)?.[1],
}));
const subsetFaces = faces.filter((f) => f.url);

describe('fonts are self-hosted', () => {
  it('nothing imports next/font/google', () => {
    const offenders = files
      .filter(({ src }) => /from\s+['"]next\/font\/google['"]/.test(src))
      .map(({ file }) => rel(file));
    expect(offenders, 'use next/font/local with a file in app/fonts').toEqual([]);
  });

  it('finds the three families (guards against a broken scan)', () => {
    expect(new Set(localFonts.map((f) => f.family))).toEqual(
      new Set(['Plus Jakarta Sans', 'Bricolage Grotesque', 'Hanken Grotesk']),
    );
    expect(subsetFaces.length).toBeGreaterThanOrEqual(8);
  });

  it('every font file referenced exists', () => {
    for (const { file, path } of localFonts) {
      expect(path.endsWith('.woff2'), file).toBe(true);
      expect(existsSync(path), `${file}: ${path}`).toBe(true);
    }
    for (const { url } of subsetFaces) {
      expect(existsSync(resolve(dirname(FONTS_CSS), url!)), url).toBe(true);
    }
  });

  it('a family declares the same weight range in its latin file and its other subsets', () => {
    for (const { file, family, weight } of localFonts) {
      expect(weight, `${file} ${family}`).toMatch(/^\d00 \d00$/);
      const subsets = subsetFaces.filter((f) => f.family === family);
      expect(subsets.length, `${family} has no other subsets in fonts.css`).toBeGreaterThan(0);
      for (const face of subsets) expect(face.weight, `${family} in fonts.css`).toBe(weight);
    }
  });

  it('a family falls back to its pinned Arial face, not a computed one', () => {
    for (const { file, family, fallback, computesFallback } of localFonts) {
      expect(computesFallback, `${file} ${family}: set adjustFontFallback: false`).toBe(false);
      expect(fallback, `${file} ${family}`).toBe(`${family} Fallback`);
      const face = faces.find((f) => f.family === fallback);
      expect(face?.local, `${fallback} is not declared in fonts.css`).toBe('Arial');
    }
  });
});
