import { generateObject } from 'ai';
import { z } from 'zod';
import type { ServiceContext } from './context';
import { plannerModel } from './planner-agent';

/**
 * AI Insights for the planner — a Gemini-generated local take on the day's places: one punchy insight
 * per place plus an overall tip for doing them together. Original content (we generate it), grounded
 * in the real places the visitor picked. Returns null when no model is configured (stub / no key) so
 * the UI can hide gracefully.
 */
export interface PlaceInsightInput {
  name: string;
  category: string;
  region: string;
}
export interface PlaceInsights {
  overall: string;
  items: Array<{ name: string; insight: string }>;
}

const SCHEMA = z.object({
  overall: z.string().describe('One short tip for doing these places in a day (order, timing, what to bring).'),
  items: z.array(
    z.object({
      name: z.string().describe('Exactly the place name given.'),
      insight: z.string().describe('One sentence: best time to visit, a local tip, or what makes it special.'),
    }),
  ),
});

export async function generatePlaceInsights(
  ctx: ServiceContext,
  places: PlaceInsightInput[],
): Promise<PlaceInsights | null> {
  const model = plannerModel(ctx);
  if (!model || places.length === 0) return null;
  try {
    const { object } = await generateObject({
      model,
      schema: SCHEMA,
      prompt:
        'You are a friendly Mauritius local guide. For each place below, give ONE punchy, genuinely useful insight ' +
        '(best time to visit, a local tip, or what makes it special — one sentence, no fluff). Then write a short ' +
        '"overall" tip for doing them together in one day (sensible order, timing, what to bring). Use the exact ' +
        'place names.\n\nPlaces:\n' +
        places.map((p) => `- ${p.name} (${p.category}, ${p.region})`).join('\n'),
    });
    return object;
  } catch {
    return null;
  }
}
