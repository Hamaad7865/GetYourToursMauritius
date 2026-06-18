import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AiProvider } from './types';
import { getServerEnv } from '@/lib/config/env';

/**
 * Google Gemini provider (default, free tier). Constructed eagerly to validate
 * the wiring; the model is actually invoked by the agent loop in Phase 5.
 */
export function createGoogleProvider(): AiProvider {
  const env = getServerEnv();
  const client = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
  });
  // Reserved for the Phase 5 agent loop (kept referenced so wiring is verified).
  void client;
  return { name: 'google', model: env.GOOGLE_GENERATIVE_AI_MODEL ?? 'gemini-2.5-flash' };
}
