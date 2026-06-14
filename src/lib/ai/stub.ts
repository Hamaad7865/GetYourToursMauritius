import type { AiProvider } from './types';

/** No-network AI provider for local dev and tests. */
export function createStubAiProvider(): AiProvider {
  return { name: 'stub', model: 'stub-echo' };
}
