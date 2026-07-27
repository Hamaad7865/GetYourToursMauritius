import { describe, expect, it } from 'vitest';
import {
  applyOverrides,
  auditPages,
  summarize,
  tourAuditPages,
  type AuditPage,
} from '@/lib/seo/audit';
import { TITLE_BUDGET, DESC_BUDGET, TITLE_MIN, DESC_MIN } from '@/lib/seo/budgets';

/* The SEO health panel's engine. It answers "which pages are obviously wrong?" from our own data —
 * no crawler, no ranking API — so it still works on a domain with nothing indexed. */

const OK_TITLE = 'Île aux Cerfs Speedboat Trip with Lunch | Belle Mare Tours'; // 57
const OK_DESC =
  'Speedboat to Île aux Cerfs with a barbecue lunch, waterfall stop and hotel pickup, booked direct with the local operator.'; // ~120

function page(over: Partial<AuditPage> = {}): AuditPage {
  return {
    path: '/x',
    label: 'X',
    group: 'Tours',
    title: OK_TITLE,
    description: OK_DESC,
    editorPath: '/admin/seo',
    overridable: true,
    ...over,
  };
}

describe('auditPages — per-page rules', () => {
  it('passes a page that is within every budget', () => {
    expect(auditPages([page()])).toEqual([]);
  });

  it('flags a missing title and description as errors', () => {
    const codes = auditPages([page({ title: '', description: '  ' })]).map((i) => i.code);
    expect(codes).toContain('missing-title');
    expect(codes).toContain('missing-description');
    expect(
      auditPages([page({ title: '', description: '' })].slice()).every((i) => i.level === 'error'),
    ).toBe(true);
  });

  it('warns past the display budgets, and reports the real length', () => {
    const long = auditPages([page({ title: 'x'.repeat(TITLE_BUDGET + 1) })]);
    expect(long[0]!.code).toBe('title-too-long');
    expect(long[0]!.level).toBe('warning');
    expect(long[0]!.message).toContain(String(TITLE_BUDGET + 1));

    const longDesc = auditPages([page({ description: 'x'.repeat(DESC_BUDGET + 1) })]);
    expect(longDesc[0]!.code).toBe('description-too-long');
  });

  it('warns when a snippet is too thin to be doing work', () => {
    expect(auditPages([page({ title: 'x'.repeat(TITLE_MIN - 1) })])[0]!.code).toBe(
      'title-too-short',
    );
    expect(auditPages([page({ description: 'x'.repeat(DESC_MIN - 1) })])[0]!.code).toBe(
      'description-too-short',
    );
  });

  it('does not double-report: a title is either missing, long or short — never two', () => {
    for (const title of ['', 'x'.repeat(TITLE_BUDGET + 5), 'x'.repeat(3), OK_TITLE]) {
      const titleIssues = auditPages([page({ title })]).filter((i) => i.code.startsWith('title'));
      expect(titleIssues.length).toBeLessThanOrEqual(1);
    }
  });
});

describe('auditPages — cross-page rules', () => {
  it('reports a duplicate title on BOTH offending pages, naming the other', () => {
    const issues = auditPages([
      page({ path: '/a', title: OK_TITLE }),
      page({ path: '/b', title: OK_TITLE }),
    ]).filter((i) => i.code === 'duplicate-title');
    expect(issues.map((i) => i.path).sort()).toEqual(['/a', '/b']);
    expect(issues.find((i) => i.path === '/a')!.message).toContain('/b');
  });

  it('ignores case and whitespace when comparing', () => {
    const issues = auditPages([
      page({ path: '/a', title: 'Belle  Mare Tours' }),
      page({ path: '/b', title: 'belle mare tours' }),
    ]).filter((i) => i.code === 'duplicate-title');
    expect(issues).toHaveLength(2);
  });

  it('treats empty titles as missing, not as duplicates of each other', () => {
    const codes = auditPages([
      page({ path: '/a', title: '' }),
      page({ path: '/b', title: '' }),
    ]).map((i) => i.code);
    expect(codes).not.toContain('duplicate-title');
  });

  it('leaves genuinely distinct pages alone', () => {
    const issues = auditPages([
      page({ path: '/a', title: OK_TITLE }),
      page({
        path: '/b',
        title: 'Dolphin Swim in Tamarin Bay | Belle Mare Tours',
        description: OK_DESC,
      }),
    ]).filter((i) => i.code.startsWith('duplicate'));
    // The two share a description, so that IS flagged — but their titles are distinct.
    expect(issues.every((i) => i.code === 'duplicate-description')).toBe(true);
  });
});

describe('applyOverrides', () => {
  const overrides = new Map([
    ['/x', { title: 'Override title here, long enough', description: '' }],
  ]);

  it('replaces the built-in title on a page that reads seo_meta', () => {
    const [out] = applyOverrides([page()], overrides);
    expect(out!.title).toBe('Override title here, long enough');
  });

  it('keeps the built-in value for a field the override leaves empty', () => {
    const [out] = applyOverrides([page()], overrides);
    expect(out!.description).toBe(OK_DESC);
  });

  it('IGNORES an override on a page that never calls overrideMetadata', () => {
    // A stray seo_meta row for /blog/x or a tour is inert — auditing it would measure a title the
    // page does not ship.
    const [out] = applyOverrides([page({ overridable: false })], overrides);
    expect(out!.title).toBe(OK_TITLE);
  });

  it('leaves a page with no override row untouched', () => {
    const [out] = applyOverrides([page({ path: '/other' })], overrides);
    expect(out!.title).toBe(OK_TITLE);
  });
});

describe('tourAuditPages — mirrors the tour page fallbacks', () => {
  const row = {
    slug: 'north-tour',
    title: 'North Tour',
    summary: 'A full day exploring the north.',
    description: 'Longer description.',
    seoTitle: null as string | null,
    seoDescription: null as string | null,
  };

  it('brands the fallback title and points at the tour editor', () => {
    const [out] = tourAuditPages([row], 'Belle Mare Tours', 'site desc');
    expect(out!.title).toBe('North Tour | Belle Mare Tours');
    expect(out!.path).toBe('/activities/north-tour');
    expect(out!.editorPath).toBe('/admin/activities');
    expect(out!.overridable).toBe(false);
  });

  it('prefers the override when one is set', () => {
    const [out] = tourAuditPages(
      [{ ...row, seoTitle: 'Custom', seoDescription: 'Custom desc' }],
      'Belle Mare Tours',
      'site desc',
    );
    expect(out!.title).toBe('Custom');
    expect(out!.description).toBe('Custom desc');
  });

  it('falls back summary → description → site description', () => {
    expect(tourAuditPages([row], 'Op', 'site desc')[0]!.description).toBe(
      'A full day exploring the north.',
    );
    expect(tourAuditPages([{ ...row, summary: null }], 'Op', 'site desc')[0]!.description).toBe(
      'Longer description.',
    );
    expect(
      tourAuditPages([{ ...row, summary: null, description: null }], 'Op', 'site desc')[0]!
        .description,
    ).toBe('site desc');
  });
});

describe('summarize', () => {
  it('counts pages once even when they raise several issues', () => {
    const pages = [page({ path: '/a', title: '', description: '' }), page({ path: '/b' })];
    const issues = auditPages(pages);
    const s = summarize(pages, issues);
    expect(s.pages).toBe(2);
    expect(s.pagesWithIssues).toBe(1);
    expect(s.errors).toBe(2);
  });

  it('ranks issue types by how many pages they hit', () => {
    // Distinct descriptions throughout, or duplicate-description would outrank the thing under test.
    const pages = [
      page({ path: '/a', title: '', description: `${OK_DESC} One.` }),
      page({ path: '/b', title: '', description: `${OK_DESC} Two.` }),
      page({ path: '/c', description: 'short' }),
    ];
    const s = summarize(pages, auditPages(pages));
    expect(s.byCode[0]!.code).toBe('missing-title');
    expect(s.byCode[0]!.count).toBe(2);
  });

  it('reports a clean site as zero', () => {
    const pages = [
      page({ path: '/a' }),
      page({
        path: '/b',
        title: 'A Totally Different Title Here',
        description: `${OK_DESC} And more.`,
      }),
    ];
    expect(summarize(pages, auditPages(pages))).toMatchObject({ errors: 0, warnings: 0 });
  });
});
