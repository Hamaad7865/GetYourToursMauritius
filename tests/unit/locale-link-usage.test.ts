import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

/**
 * The public site links through `@/components/site/LocaleLink`, not `next/link` directly.
 *
 * `next/link` renders the href it is given. On a French page that was the English URL, every time:
 * the middleware rewrites /fr/… on the way in, and nothing restored the prefix on the way out. A
 * crawl on 2026-10-13 found all 42 tour cards on /fr/activities pointing at English tour pages, and
 * 154 of 236 French pages with no internal link from anywhere. LocaleLink fixes that in one place —
 * but only for files that import it, so this scan fails the build when a public page or component
 * reaches for `next/link` again.
 *
 * The exemptions have no French URL to link to (src/lib/i18n/routing.ts `UNLOCALISED_PREFIXES`), or
 * render where no PreferencesProvider is mounted.
 */

const ROOT = process.cwd();

const EXEMPT: RegExp[] = [
  /^app\/\(site\)\/admin\//,
  /^app\/not-found\.tsx$/,
  /^app\/global-error\.tsx$/,
  /^src\/components\/(admin|account|auth|checkout)\//,
  /^src\/components\/site\/LocaleLink\.tsx$/,
];

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

describe('public links are locale-aware', () => {
  const files = [...tsxFiles(join(ROOT, 'app')), ...tsxFiles(join(ROOT, 'src', 'components'))]
    .map((file) => ({ file: rel(file), src: readFileSync(file, 'utf8') }))
    .filter(({ file }) => !EXEMPT.some((re) => re.test(file)));

  it('finds the public files (guards against a broken scan)', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(files.some(({ src }) => src.includes("from '@/components/site/LocaleLink'"))).toBe(true);
  });

  it('no public page or component imports next/link directly', () => {
    const offenders = files
      .filter(({ src }) => /from\s+['"]next\/link['"]/.test(src))
      .map(({ file }) => file);
    expect(offenders, 'import Link from "@/components/site/LocaleLink" instead').toEqual([]);
  });
});
