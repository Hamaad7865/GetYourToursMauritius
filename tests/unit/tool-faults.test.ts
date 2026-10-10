import { describe, expect, it } from 'vitest';
import { executedToolNames, toolExecutionFault } from '@/lib/ai/tool-faults';

/* AI SDK v5 folds both kinds of tool failure into the conversation instead of throwing. These pin
 * the two questions the services ask of a finished loop, on the exact part shapes v5 produces. */

const call = (toolName: string, invalid = false) => ({ toolName, invalid });

describe('toolExecutionFault', () => {
  it('finds nothing in a clean loop', () => {
    const steps = [{ content: [{ type: 'tool-result' }, { type: 'text' }], toolCalls: [] }];
    expect(toolExecutionFault(steps)).toBeUndefined();
  });

  it('returns the error a tool threw while running', () => {
    const boom = new Error('Places is down');
    const steps = [
      { content: [{ type: 'tool-error', dynamic: false, error: boom }], toolCalls: [] },
    ];
    expect(toolExecutionFault(steps)).toBe(boom);
  });

  it('ignores a call the SDK rejected as malformed — that is a model slip, not an outage', () => {
    const steps = [
      {
        content: [{ type: 'tool-error', dynamic: true, error: 'Invalid input for tool' }],
        toolCalls: [],
      },
    ];
    expect(toolExecutionFault(steps)).toBeUndefined();
  });

  it('still reports a fault when the tool threw nothing useful', () => {
    const steps = [{ content: [{ type: 'tool-error', error: undefined }], toolCalls: [] }];
    expect(toolExecutionFault(steps)).toBeInstanceOf(Error);
  });
});

describe('executedToolNames', () => {
  it('lists the tools that ran, in order, across steps', () => {
    const steps = [
      { content: [], toolCalls: [call('search_places')] },
      { content: [], toolCalls: [call('set_itinerary')] },
    ];
    expect(executedToolNames(steps)).toEqual(['search_places', 'set_itinerary']);
  });

  it('leaves out a malformed call: a commit that never ran put nothing on the map', () => {
    const steps = [
      { content: [], toolCalls: [call('search_places'), call('set_itinerary', true)] },
    ];
    expect(executedToolNames(steps)).toEqual(['search_places']);
  });
});
