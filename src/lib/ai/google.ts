import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { AiProvider } from './types';
import { getServerEnv } from '@/lib/config/env';

/**
 * Google Gemini provider (the default). Names the model every AI feature runs on; the model itself
 * is built per call by `plannerModel()` in services/planner-agent.ts.
 */
export function createGoogleProvider(): AiProvider {
  const env = getServerEnv();
  const client = createGoogleGenerativeAI({
    apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY ?? '',
  });
  // Constructed here only so a malformed key fails at provider selection, not mid-conversation.
  void client;
  return { name: 'google', model: env.GOOGLE_GENERATIVE_AI_MODEL ?? 'gemini-3.1-pro-preview' };
}
