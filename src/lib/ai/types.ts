/**
 * AI provider interface. The provider is selected by the `AI_PROVIDER` env var so
 * it is swappable (default: Google Gemini Flash). The agent loop and tool calling
 * land in Phase 5; Phase 0 only fixes the seam so the rest of the app can depend
 * on a stable shape.
 */
export type AiRole = 'system' | 'user' | 'assistant' | 'tool';

export interface AiMessage {
  role: AiRole;
  content: string;
}

export interface AiProvider {
  /** Provider key: 'google' | 'workersai' | 'anthropic' | 'openai' | 'stub'. */
  readonly name: string;
  /** Model identifier used for the agent loop. */
  readonly model: string;
}
