import { z } from 'zod';

/**
 * The admin assistant — request/response shapes for POST /api/v1/admin/assistant.
 *
 * The assistant is GLOBAL (every back-office screen), so the request carries where the operator is
 * and what they are looking at, and the response can carry PROPOSED ACTIONS the browser applies
 * with the operator's own session after they press Apply. The server never writes: see
 * `src/lib/services/admin-assistant.ts` for why that split is load-bearing.
 */

export const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(20000),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

/** Where the operator is, and what that screen has on it. Context, never instructions. */
export const assistantPageContextSchema = z.object({
  /** The admin path, e.g. "/admin/quotes" — the assistant tailors itself to the screen. */
  path: z.string().max(200),
  /** A human label for the screen, e.g. "Quotes". */
  screen: z.string().max(80),
  /** A compact summary of what is on screen (the open quote, the tour being edited…). */
  detail: z.string().max(4000).nullish(),
});
export type AssistantPageContext = z.infer<typeof assistantPageContextSchema>;

export const adminAssistantRequestSchema = z.object({
  messages: z
    .array(assistantMessageSchema)
    .min(1, 'Say something first.')
    .max(24, 'This conversation is too long — start a fresh one.'),
  page: assistantPageContextSchema.nullish(),
});
export type AdminAssistantRequest = z.infer<typeof adminAssistantRequestSchema>;

/* --------------------------------------------------------------------------------------------- */
/* Proposed actions — what the assistant offers to do, for the operator to apply                    */
/* --------------------------------------------------------------------------------------------- */

/**
 * The CONTENT fields the assistant may propose for a tour. Deliberately no price, no option, no
 * capacity, no status: the apply path runs `contentOnly`, so an AI-authored tour arrives as a DRAFT
 * with words but no money, and the operator prices and publishes it. Every field is optional so an
 * update can patch one thing (e.g. only `highlights`) without restating the tour.
 */
export const tourContentPatchSchema = z.object({
  title: z.string().max(200).optional(),
  summary: z.string().max(1000).optional(),
  description: z.string().max(8000).optional(),
  location: z.string().max(200).optional(),
  meetingPoint: z.string().max(400).optional(),
  cancellationPolicy: z.string().max(2000).optional(),
  seoTitle: z.string().max(200).optional(),
  seoDescription: z.string().max(400).optional(),
  highlights: z.array(z.string().max(300)).max(12).optional(),
  inclusions: z.array(z.string().max(300)).max(20).optional(),
  exclusions: z.array(z.string().max(300)).max(20).optional(),
  whatToBring: z.array(z.string().max(300)).max(20).optional(),
  importantInfo: z.array(z.string().max(500)).max(20).optional(),
});
export type TourContentPatch = z.infer<typeof tourContentPatchSchema>;

export const assistantActionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('create_tour'),
    /** One line for the card's header, e.g. "Create draft tour “Sunset catamaran”". */
    label: z.string().max(200),
    /** What the operator still has to do — always non-empty (pricing, at minimum). */
    caveat: z.string().max(400),
    patch: tourContentPatchSchema,
  }),
  z.object({
    kind: z.literal('update_tour'),
    label: z.string().max(200),
    caveat: z.string().max(400),
    /** The activity being changed — resolved by the model from a read tool, never invented. */
    activityId: z.string().max(80),
    activityTitle: z.string().max(200),
    patch: tourContentPatchSchema,
  }),
  z.object({
    kind: z.literal('draft_quote_from_email'),
    label: z.string().max(200),
    caveat: z.string().max(400),
    /** The pasted thread, handed back verbatim for the existing email→quote pipeline. */
    email: z.string().max(20000),
  }),
]);
export type AssistantAction = z.infer<typeof assistantActionSchema>;

export const adminAssistantResponseSchema = z.object({
  /** False when no Gemini model is configured — the panel says so instead of chatting. */
  available: z.boolean(),
  reply: z.string().nullable(),
  /** Proposed actions, shown as cards under the reply. Nothing is applied without a click. */
  actions: z.array(assistantActionSchema).max(4).default([]),
});
export type AdminAssistantResponse = z.infer<typeof adminAssistantResponseSchema>;
