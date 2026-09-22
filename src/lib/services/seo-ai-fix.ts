import { generateObject, type LanguageModelV1 } from 'ai';
import type { ServiceContext } from './context';
import { plannerModel } from './planner-agent';
import { ValidationError } from './errors';
import { BRAND_SUFFIX } from '@/lib/seo/page-registry';
import { TITLE_BUDGET, DESC_BUDGET, TITLE_MIN, DESC_MIN } from '@/lib/seo/budgets';
import { auditPages, type AuditPage, type SeoIssue } from '@/lib/seo/audit';
import { seoAiFixSuggestionSchema, type SeoAiFixResponse } from '@/lib/validation/seo-ai-fix';

/**
 * One-click AI fix for a Health-check issue: Gemini rewrites the title/description, and the
 * server VERIFIES the rewrite against the same audit the panel shows before anything is saved.
 *
 * THE SPLIT THAT MAKES THIS SAFE — the server PROPOSES, the browser APPLIES (the same boundary
 * as the admin assistant in admin-assistant.ts):
 *   - the request names ONLY the page path; current values, budgets, brand rule and duplicate
 *     detection are all loaded server-side, so a stale client cannot smuggle in an unmeasured fix;
 *   - the browser saves NOTHING unless `verified` is true. An unverified suggestion is returned
 *     for manual editing instead — same as typing it by hand;
 *   - only WORDS are ever written (title/description via the existing RLS-gated editor paths).
 *     No price, option, capacity, status or publish state is reachable from here.
 *
 * At most TWO model calls per click (initial + one repair retry) — cost control as well as
 * patience control. A Gemini outage propagates to apiHandler/error_logs rather than returning a
 * polite fake; only malformed tool arguments get the soft landing, mirroring runAdminAssistant.
 */

/** One editable page as the fixer sees it: effective (shipped) values, not raw columns. */
export interface SeoFixPage {
  path: string;
  label: string;
  group: string;
  /** The title/description the page ships TODAY (overrides applied, fallbacks resolved). */
  title: string;
  description: string;
  /**
   * True when the saved value ships absolute and must carry the brand itself: templated hub
   * pages (the override bypasses the `%s | Belle Mare Tours` template), tours (seo_title is
   * absolute), and blog posts (verified WITH the brand, stripped back to meta_title on save).
   */
  requireBrand: boolean;
  /** Which editor owns the write: seo_meta override, the tour row, or the blog post row. */
  kind: 'override' | 'tour' | 'blog';
  /** The tour/blog slug the browser writes back to (null for overrides). */
  slug: string | null;
}

/** Everything the fixer can look at. READ-ONLY — the route wires the database behind this. */
export interface SeoFixPort {
  listPages(): Promise<SeoFixPage[]>;
}

export interface SeoFixCheck {
  ok: boolean;
  problems: string[];
  /** Issue codes the rewrite clears, per the re-audit. */
  fixed: string[];
}

function toAuditPages(pages: SeoFixPage[]): AuditPage[] {
  return pages.map((p) => ({
    path: p.path,
    label: p.label,
    group: p.group,
    title: p.title,
    description: p.description,
    editorPath: '',
    overridable: false,
  }));
}

/** Brand words are covered by the brand rule, not the keyword rule — the keyword must be topical. */
const BRAND_WORDS = new Set(['belle', 'mare', 'tours']);

/**
 * The page's anchor keyword: the first substantial word of the current title (brand stripped).
 * Null when there is nothing to anchor to (missing title) — the model then has a free hand.
 */
export function anchorKeyword(currentTitle: string): string | null {
  const bare = currentTitle.endsWith(BRAND_SUFFIX)
    ? currentTitle.slice(0, -BRAND_SUFFIX.length)
    : currentTitle;
  for (const raw of bare.split(/[^A-Za-zÀ-ÿ]+/)) {
    const word = raw.toLowerCase();
    if (word.length >= 5 && !BRAND_WORDS.has(word)) return word;
  }
  return null;
}

/**
 * Verify a candidate rewrite exactly as the Health panel would measure it: budgets, brand,
 * keyword retention, and no new duplicates. Pure and unit-tested.
 */
export function verifySeoFix(
  pages: SeoFixPage[],
  targetPath: string,
  title: string,
  description: string,
): SeoFixCheck {
  const target = pages.find((p) => p.path === targetPath);
  if (!target) return { ok: false, problems: [`Unknown page ${targetPath}.`], fixed: [] };
  const problems: string[] = [];

  if (title.length < TITLE_MIN || title.length > TITLE_BUDGET) {
    problems.push(
      `Title is ${title.length} characters — it must stay within ${TITLE_MIN}–${TITLE_BUDGET}.`,
    );
  }
  if (description.length < DESC_MIN || description.length > DESC_BUDGET) {
    problems.push(
      `Description is ${description.length} characters — it must stay within ${DESC_MIN}–${DESC_BUDGET}.`,
    );
  }
  if (target.requireBrand && !title.endsWith(BRAND_SUFFIX)) {
    problems.push(`Title must keep the brand ending “${BRAND_SUFFIX}”.`);
  }
  const anchor = anchorKeyword(target.title);
  if (
    anchor &&
    !title.toLowerCase().includes(anchor) &&
    !description.toLowerCase().includes(anchor)
  ) {
    problems.push(
      `The rewrite drops the page's keyword “${anchor}” — keep the topic, not just the length.`,
    );
  }

  const base = toAuditPages(pages);
  const before: SeoIssue[] = auditPages(base).filter((i) => i.path === targetPath);
  const after: SeoIssue[] = auditPages(
    base.map((p) => (p.path === targetPath ? { ...p, title, description } : p)),
  ).filter((i) => i.path === targetPath);
  for (const issue of after) {
    if (issue.code === 'duplicate-title' || issue.code === 'duplicate-description') {
      problems.push(`${issue.message} Pick a distinct wording.`);
    }
  }
  const afterCodes = new Set(after.map((i) => i.code));
  const fixed = before.map((i) => i.code).filter((c) => !afterCodes.has(c));
  return { ok: problems.length === 0, problems, fixed };
}

/** The exact strings the browser persists. Only blog differs from the verified effective values:
 *  meta_title ships WITHOUT the brand (the root template appends it) — derived HERE, server-side,
 *  so the client can never double the brand by deriving it itself. */
export function toSaveValues(
  page: SeoFixPage,
  title: string,
  description: string,
): { saveTitle: string; saveDescription: string } {
  if (page.kind === 'blog') {
    const saveTitle = title.endsWith(BRAND_SUFFIX) ? title.slice(0, -BRAND_SUFFIX.length) : title;
    return { saveTitle, saveDescription: description };
  }
  return { saveTitle: title, saveDescription: description };
}

const SYSTEM = [
  'You write <title> tags and meta descriptions for Belle Mare Tours, a licensed Mauritius tour operator.',
  'Return JSON only, in the requested shape. No explanations, no markdown, no extra keys.',
  'Never invent prices, ratings, awards, or places the page is not about.',
].join(' ');

function buildPrompt(page: SeoFixPage, issues: SeoIssue[], repairWith?: string[]): string {
  const lines = [
    `Page: ${page.label} (${page.path}) — ${page.group}.`,
    `Current title (${page.title.length} chars): ${page.title || '(missing)'}`,
    `Current description (${page.description.length} chars): ${page.description || '(missing)'}`,
    `Issues to fix: ${issues.map((i) => i.message).join(' ')}`,
    `Rules: title ${TITLE_MIN}-${TITLE_BUDGET} characters, description ${DESC_MIN}-${DESC_BUDGET} characters — counts are exact, stay inside.`,
    'Preserve the page topic and its main keyword; shorten by cutting filler, never the subject.',
    'The description sells the click in one or two sentences. No quotes, no exclamation marks.',
  ];
  if (page.requireBrand) {
    lines.push(`The title MUST end with “${BRAND_SUFFIX}” exactly.`);
  } else if (page.title.includes('Belle Mare Tours')) {
    lines.push('Keep the “Belle Mare Tours” brand in the title.');
  }
  if (repairWith?.length) {
    lines.push(
      `Your previous attempt failed verification: ${repairWith.join(' ')} Fix exactly those points.`,
    );
  }
  return lines.join('\n');
}

export async function runSeoAiFix(
  ctx: ServiceContext,
  port: SeoFixPort,
  path: string,
  // Injectable so the fix is testable with a scripted model; defaults to the real Gemini.
  modelOverride?: LanguageModelV1 | null,
): Promise<SeoAiFixResponse> {
  const target = path.trim();
  const pages = await port.listPages();
  const page = pages.find((p) => p.path === target);
  if (!page) {
    throw new ValidationError('Unknown page — reload the Health check and try again.');
  }

  const issues = auditPages(toAuditPages(pages)).filter((i) => i.path === page.path);
  const measured = (title: string, description: string) => ({
    titleChars: title.length,
    descriptionChars: description.length,
    ...toSaveValues(page, title, description),
  });
  if (issues.length === 0) {
    return {
      available: true,
      verified: true,
      title: page.title,
      description: page.description,
      ...measured(page.title, page.description),
      fixedCodes: [],
      note: 'Already clean — nothing to fix.',
    };
  }

  const model = modelOverride !== undefined ? modelOverride : plannerModel(ctx);
  if (!model) {
    return {
      available: false,
      verified: false,
      title: '',
      description: '',
      saveTitle: '',
      saveDescription: '',
      titleChars: 0,
      descriptionChars: 0,
      fixedCodes: [],
      note: 'Gemini is not configured (GOOGLE_GENERATIVE_AI_API_KEY) — ask the owner to set it in Cloudflare Pages and redeploy.',
    };
  }

  const attempt = async (repairWith?: string[]) => {
    const { object } = await generateObject({
      model,
      schema: seoAiFixSuggestionSchema,
      system: SYSTEM,
      prompt: buildPrompt(page, issues, repairWith),
    });
    return { title: object.title.trim(), description: object.description.trim() };
  };

  let candidate = await attempt();
  let check = verifySeoFix(pages, page.path, candidate.title, candidate.description);
  if (!check.ok) {
    candidate = await attempt(check.problems);
    check = verifySeoFix(pages, page.path, candidate.title, candidate.description);
  }

  if (!check.ok) {
    return {
      available: true,
      verified: false,
      title: candidate.title,
      description: candidate.description,
      ...measured(candidate.title, candidate.description),
      fixedCodes: [],
      note: `Gemini's rewrite did not pass verification (${check.problems.join(' ')}) — nothing was saved. Use the suggestion as a starting point for a manual edit.`,
    };
  }
  return {
    available: true,
    verified: true,
    title: candidate.title,
    description: candidate.description,
    ...measured(candidate.title, candidate.description),
    fixedCodes: check.fixed,
    note: null,
  };
}
