/**
 * What a finished tool loop has to be asked now that the AI SDK (v5) no longer throws from one.
 *
 * Under v4 both kinds of failure escaped `generateText` as exceptions. Under v5 they are folded into
 * the conversation as `tool-error` parts and the loop carries on:
 *
 *  - a MALFORMED CALL (unknown tool, arguments that fail the schema) is marked `dynamic`/`invalid` and
 *    handed back to the model, which usually corrects itself on the next step. That is a model slip —
 *    a conversational problem, and v5 now handles it better than our old catch did;
 *  - a tool whose `execute` THREW (Google Places down, a database RPC failing) is also handed back to
 *    the model, which then writes a polite reply over the top of a real outage.
 *
 * The second kind must not stay quiet: it belongs in `error_logs`, and it only gets there by leaving
 * the service as an exception for `apiHandler` to record. These helpers tell the two apart.
 */

interface ToolLoopStep {
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly dynamic?: boolean;
    readonly error?: unknown;
  }>;
  readonly toolCalls: ReadonlyArray<{ readonly toolName: string; readonly invalid?: boolean }>;
}

/** The first error thrown by a tool's own `execute` during the loop, or `undefined` if none did. */
export function toolExecutionFault(steps: ReadonlyArray<ToolLoopStep>): unknown {
  for (const step of steps) {
    for (const part of step.content) {
      // `dynamic` marks the SDK's own stand-in for a call it could not parse; every tool we define is
      // static, so a non-dynamic tool-error is one of ours failing while it ran.
      if (part.type === 'tool-error' && !part.dynamic) {
        return part.error ?? new Error('A tool failed without reporting an error');
      }
    }
  }
  return undefined;
}

/** Every tool the model called successfully enough to RUN, in order. A call the SDK rejected as
 *  malformed never executed, so it must not count as "the model did this". */
export function executedToolNames(steps: ReadonlyArray<ToolLoopStep>): string[] {
  return steps.flatMap((s) => s.toolCalls.filter((c) => !c.invalid).map((c) => c.toolName));
}
