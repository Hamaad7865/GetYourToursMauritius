import type { ServiceContext } from './context';
import type { AiMessage } from '@/lib/ai/types';
import { NotImplementedError } from './errors';

export interface RunAgentTurnInput {
  /** Existing chat session to continue, or null to start a new one. */
  sessionId?: string | null;
  messages: AiMessage[];
}

export interface AgentTurnResult {
  sessionId: string;
  reply: string;
}

export async function runAgentTurn(
  _ctx: ServiceContext,
  _input: RunAgentTurnInput,
): Promise<AgentTurnResult> {
  // Phase 5: the streaming agent loop with DB-backed tools (search_tours, etc.).
  // Prices, availability and payment URLs come only from the DB/Peach — never the model.
  throw new NotImplementedError('runAgentTurn');
}
