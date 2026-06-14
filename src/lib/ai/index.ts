import { getServerEnv } from '@/lib/config/env';
import type { AiProvider } from './types';
import { createGoogleProvider } from './google';
import { createStubAiProvider } from './stub';

export * from './types';

/**
 * Selects the AI provider from `AI_PROVIDER`. Defaults to Google Gemini Flash
 * (free tier). Other providers are wired in Phase 5; until then they fall back to
 * the stub so the app builds without their SDKs/keys.
 */
export function getAiProvider(): AiProvider {
  const env = getServerEnv();
  switch (env.AI_PROVIDER) {
    case 'google':
      return env.GOOGLE_GENERATIVE_AI_API_KEY ? createGoogleProvider() : createStubAiProvider();
    case 'workersai':
    case 'anthropic':
    case 'openai':
      // TODO(Phase 5): wire real Workers AI / Anthropic / OpenAI providers.
      return createStubAiProvider();
    default:
      return createStubAiProvider();
  }
}
