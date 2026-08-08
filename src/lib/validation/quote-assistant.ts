import { z } from 'zod';

/**
 * The admin Gemini chat — request/response shapes for POST /api/v1/admin/quotes/assistant.
 *
 * The request is the WHOLE visible thread, resent each turn (the route holds no chat state, exactly
 * like the planner): the browser keeps the messages, the server grounds the reply with tools. The
 * caps are generous for a working conversation but bound the model bill — a thread longer than the
 * cap simply drops its oldest turns client-side.
 */

export const assistantMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().min(1).max(8000),
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const quoteAssistantRequestSchema = z.object({
  messages: z
    .array(assistantMessageSchema)
    .min(1, 'Say something first.')
    .max(24, 'This conversation is too long — start a fresh one.'),
  /**
   * A compact text summary of the quote the operator has open (ref, guest, lines, total), composed
   * by the editor. Free text rather than a structured object so the editor can evolve what it says
   * without a schema change; the model treats it as context, never as instructions.
   */
  quoteContext: z.string().max(4000).nullish(),
});
export type QuoteAssistantRequest = z.infer<typeof quoteAssistantRequestSchema>;

export const quoteAssistantResponseSchema = z.object({
  /** False when no Gemini model is configured — the panel says so instead of chatting. */
  available: z.boolean(),
  reply: z.string().nullable(),
});
export type QuoteAssistantResponse = z.infer<typeof quoteAssistantResponseSchema>;
