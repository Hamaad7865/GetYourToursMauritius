import { MockLanguageModelV2 } from 'ai/test';

/**
 * A stand-in for Gemini that replays a fixed script, so the agent loops can be proved without a
 * network or a bill. One place owns the provider-result shape: it changed wholesale between AI SDK
 * v4 and v5, and five test files each carrying their own copy is how a migration gets missed.
 */

const USAGE = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

/** What one model step answers with: a final text, or one or more tool calls. */
export type ScriptedStep =
  | { text: string }
  | { calls: Array<{ toolName: string; input: unknown }> };

function stepResult(step: ScriptedStep, id: string) {
  if ('text' in step) {
    return {
      content: [{ type: 'text' as const, text: step.text }],
      finishReason: 'stop' as const,
      usage: USAGE,
      warnings: [],
    };
  }
  return {
    content: step.calls.map((c, i) => ({
      type: 'tool-call' as const,
      toolCallId: `${id}-${i}`,
      toolName: c.toolName,
      // The provider contract carries tool input as a JSON string; the SDK parses and validates it.
      input: JSON.stringify(c.input),
    })),
    finishReason: 'tool-calls' as const,
    usage: USAGE,
    warnings: [],
  };
}

/**
 * A model that replays `steps` in order (the last one repeats) and records every prompt it saw, plus
 * the names of the tools it was OFFERED on each call (`seenTools`) — the only honest way to assert a
 * tool is withheld from the model rather than refused after the fact.
 */
export function scriptedModel(steps: ScriptedStep[]) {
  const seenPrompts: string[] = [];
  const seenTools: string[][] = [];
  let i = 0;
  const model = new MockLanguageModelV2({
    doGenerate: async (options) => {
      seenPrompts.push(JSON.stringify(options.prompt));
      seenTools.push((options.tools ?? []).map((t) => t.name));
      const step = steps[Math.min(i, steps.length - 1)]!;
      i += 1;
      return stepResult(step, `call-${i}`);
    },
  });
  return { model, seenPrompts, seenTools };
}

/** A model that answers `generateObject` with a fixed JSON object. */
export function scriptedObjectModel(object: unknown) {
  return scriptedModel([{ text: JSON.stringify(object) }]).model;
}
