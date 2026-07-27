import { TITLE_BUDGET, DESC_BUDGET, TITLE_MIN, DESC_MIN } from '@/lib/seo/budgets';

/**
 * The self-audit behind the SEO health panel.
 *
 * Everything here is computed from OUR OWN data — no crawler, no external API — so it works on a
 * brand-new domain with nothing indexed yet, which is exactly the situation this site is in. It
 * answers "which pages are obviously wrong?", not "which pages rank?" (that is Search Console's
 * job, wired up separately).
 *
 * Pure and side-effect free, so it's unit-tested.
 */

export interface AuditPage {
  path: string;
  label: string;
  /** Which family the page belongs to ("Tours", "Attractions", …) — used to group the results. */
  group: string;
  /** The EFFECTIVE title/description the page ships today (override applied, fallbacks resolved). */
  title: string;
  description: string;
  /** Where the editor goes to fix it. */
  editorPath: string;
  /**
   * True when the page calls `overrideMetadata()`, i.e. a `seo_meta` row for this path actually
   * reaches it. Blog posts and tours carry their own meta columns instead, so an override row would
   * be inert — applying one here would audit a title the page never ships.
   */
  overridable: boolean;
}

/** Overlay the saved `seo_meta` rows so the audit measures what each page ships TODAY. */
export function applyOverrides(
  pages: AuditPage[],
  overrides: Map<string, { title: string; description: string }>,
): AuditPage[] {
  return pages.map((page) => {
    if (!page.overridable) return page;
    const o = overrides.get(page.path);
    if (!o) return page;
    return {
      ...page,
      title: o.title.trim() || page.title,
      description: o.description.trim() || page.description,
    };
  });
}

export type IssueLevel = 'error' | 'warning';

export type IssueCode =
  | 'missing-title'
  | 'title-too-long'
  | 'title-too-short'
  | 'duplicate-title'
  | 'missing-description'
  | 'description-too-long'
  | 'description-too-short'
  | 'duplicate-description';

export interface SeoIssue {
  path: string;
  label: string;
  group: string;
  editorPath: string;
  level: IssueLevel;
  code: IssueCode;
  message: string;
}

/** Duplicate detection ignores case and whitespace runs — "A  B" and "a b" are the same snippet. */
function normalize(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}

function duplicates(pages: AuditPage[], pick: (p: AuditPage) => string): Map<string, AuditPage[]> {
  const byValue = new Map<string, AuditPage[]>();
  for (const page of pages) {
    const key = normalize(pick(page));
    if (!key) continue; // empty is a "missing" issue, not a duplicate one
    const bucket = byValue.get(key);
    if (bucket) bucket.push(page);
    else byValue.set(key, [page]);
  }
  for (const [key, bucket] of byValue) if (bucket.length < 2) byValue.delete(key);
  return byValue;
}

/**
 * Every issue across every page, ordered errors-first then by page. A page can raise more than one.
 */
export function auditPages(pages: AuditPage[]): SeoIssue[] {
  const issues: SeoIssue[] = [];
  const add = (page: AuditPage, level: IssueLevel, code: IssueCode, message: string) =>
    issues.push({
      path: page.path,
      label: page.label,
      group: page.group,
      editorPath: page.editorPath,
      level,
      code,
      message,
    });

  for (const page of pages) {
    const title = page.title.trim();
    const description = page.description.trim();

    if (!title) {
      add(page, 'error', 'missing-title', 'No title tag — Google will invent one from the page.');
    } else if (title.length > TITLE_BUDGET) {
      add(
        page,
        'warning',
        'title-too-long',
        `Title is ${title.length} characters — Google truncates around ${TITLE_BUDGET}, so the end is likely cut.`,
      );
    } else if (title.length < TITLE_MIN) {
      add(
        page,
        'warning',
        'title-too-short',
        `Title is only ${title.length} characters — there is room for the keyword people actually search.`,
      );
    }

    if (!description) {
      add(
        page,
        'error',
        'missing-description',
        'No meta description — Google will pull an arbitrary sentence off the page instead.',
      );
    } else if (description.length > DESC_BUDGET) {
      add(
        page,
        'warning',
        'description-too-long',
        `Description is ${description.length} characters — the tail past ~${DESC_BUDGET} is cut off.`,
      );
    } else if (description.length < DESC_MIN) {
      add(
        page,
        'warning',
        'description-too-short',
        `Description is only ${description.length} characters — too thin to sell the click.`,
      );
    }
  }

  // Duplicates are a page-SET problem: two pages claiming the same snippet compete with each other,
  // and Google may treat one as a near-duplicate of the other.
  for (const [, bucket] of duplicates(pages, (p) => p.title)) {
    for (const page of bucket) {
      const others = bucket.filter((p) => p.path !== page.path).map((p) => p.path);
      add(
        page,
        'error',
        'duplicate-title',
        `Same title as ${others.length === 1 ? others[0] : `${others.length} other pages`} — they compete for the same result.`,
      );
    }
  }
  for (const [, bucket] of duplicates(pages, (p) => p.description)) {
    for (const page of bucket) {
      const others = bucket.filter((p) => p.path !== page.path).map((p) => p.path);
      add(
        page,
        'warning',
        'duplicate-description',
        `Same description as ${others.length === 1 ? others[0] : `${others.length} other pages`}.`,
      );
    }
  }

  const rank = (i: SeoIssue) => (i.level === 'error' ? 0 : 1);
  return issues.sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path));
}

export interface AuditSummary {
  pages: number;
  /** Pages with at least one issue of any level. */
  pagesWithIssues: number;
  errors: number;
  warnings: number;
  /** Issue counts keyed by code, biggest first — the "fix this class of thing" list. */
  byCode: Array<{ code: IssueCode; count: number }>;
}

export function summarize(pages: AuditPage[], issues: SeoIssue[]): AuditSummary {
  const counts = new Map<IssueCode, number>();
  for (const i of issues) counts.set(i.code, (counts.get(i.code) ?? 0) + 1);
  return {
    pages: pages.length,
    pagesWithIssues: new Set(issues.map((i) => i.path)).size,
    errors: issues.filter((i) => i.level === 'error').length,
    warnings: issues.filter((i) => i.level === 'warning').length,
    byCode: [...counts.entries()]
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)),
  };
}

/**
 * Tour pages as audit rows. Mirrors generateMetadata in app/(site)/activities/[slug]/page.tsx:
 * title = seoTitle ?? "<title> | <operator>", description = seoDescription ?? summary ?? description.
 */
export function tourAuditPages(
  rows: Array<{
    slug: string;
    title: string;
    summary: string | null;
    description: string | null;
    seoTitle: string | null;
    seoDescription: string | null;
  }>,
  operator: string,
  siteDescription: string,
): AuditPage[] {
  return rows.map((r) => ({
    path: `/activities/${r.slug}`,
    label: r.title,
    group: 'Tours',
    title: r.seoTitle?.trim() || `${r.title} | ${operator}`,
    description:
      r.seoDescription?.trim() || r.summary?.trim() || r.description?.trim() || siteDescription,
    editorPath: '/admin/activities',
    // The tour page never calls overrideMetadata — its meta lives in its own columns.
    overridable: false,
  }));
}

export const ISSUE_LABELS: Record<IssueCode, string> = {
  'missing-title': 'Missing title',
  'title-too-long': 'Title too long',
  'title-too-short': 'Title too short',
  'duplicate-title': 'Duplicate title',
  'missing-description': 'Missing description',
  'description-too-long': 'Description too long',
  'description-too-short': 'Description too short',
  'duplicate-description': 'Duplicate description',
};
