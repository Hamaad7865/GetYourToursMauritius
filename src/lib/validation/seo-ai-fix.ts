import { z } from 'zod';

/**
 * POST /api/v1/seo/ai-fix — one-click Gemini rewrite of a Health-check issue.
 *
 * The request names ONLY the page. Everything else (current title/description, budgets, brand
 * rule, duplicate check) is loaded server-side, so a stale or tampered client cannot talk the
 * server into writing something it has not measured itself.
 */

export const seoAiFixRequestSchema = z.object({
  /** Public path of the page to fix, e.g. "/activities/sunset-catamaran". */
  path: z.string().min(1).max(200),
});
export type SeoAiFixRequest = z.infer<typeof seoAiFixRequestSchema>;

/** The model's raw rewrite. Validated by Zod, then VERIFIED against the audit — the schema
 *  alone is not the guardrail (a 61-char title passes max(200) but still fails the audit). */
export const seoAiFixSuggestionSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(500),
});
export type SeoAiFixSuggestion = z.infer<typeof seoAiFixSuggestionSchema>;

export const seoAiFixResponseSchema = z.object({
  /** False when no Gemini model is configured — the panel says so instead of fixing. */
  available: z.boolean(),
  /**
   * True only when the rewrite passes the full server-side verification (budgets, brand,
   * keyword, duplicates). The browser saves NOTHING unless this is true — an unverified
   * suggestion is shown for manual editing instead.
   */
  verified: z.boolean(),
  /** The EFFECTIVE (shipped) title/description the audit measured. */
  title: z.string(),
  description: z.string(),
  /**
   * The exact strings to persist. Identical to title/description except for blog posts, whose
   * meta_title ships WITHOUT the brand (the root template appends it) — the client must never
   * derive this itself or the brand doubles up.
   */
  saveTitle: z.string(),
  saveDescription: z.string(),
  titleChars: z.number(),
  descriptionChars: z.number(),
  /** Health-check issue codes this rewrite clears, per the server-side re-audit. */
  fixedCodes: z.array(z.string()),
  /** Human-readable note: what changed, or why verification failed. */
  note: z.string().nullable(),
});
export type SeoAiFixResponse = z.infer<typeof seoAiFixResponseSchema>;
