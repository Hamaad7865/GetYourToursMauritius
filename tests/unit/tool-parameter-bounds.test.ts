import { describe, expect, it } from 'vitest';
import { ESLint } from 'eslint';
import {
  clampTourContentPatch,
  tourContentPatchSchema,
  tourContentPatchInputSchema,
} from '@/lib/validation/admin-assistant';

/**
 * THE LINT RULE IS THE FIX; THIS FILE IS WHAT KEEPS IT ONE.
 *
 * A bound inside an AI tool's `parameters` is not a validation — the AI SDK checks model-supplied
 * arguments BEFORE `execute` runs, so the bound throws AI_InvalidToolArgumentsError out of
 * generateText as an unhandled 500. It has cost us four production failures across two files and two
 * authors in eight days, which is why the guard is a parser rule rather than a review habit.
 *
 * A rule nothing exercises is worse than no rule: an esquery selector that quietly stops matching
 * (an AST shape changes, someone edits the string) fails OPEN and reads as "clean" forever. So the
 * selector is asserted against source that must fail and source that must pass.
 */

/**
 * ONE instance for the whole file. Constructing an ESLint loads and resolves the entire flat config
 * (Next's plugin set included), which costs seconds — doing that per assertion made this file heavy
 * enough to slow the rest of the parallel run down with it.
 */
const eslint = new ESLint({ cwd: process.cwd() });

/** Lints a snippet through the project's real flat config, exactly as `npm run lint` would. */
async function lintSnippet(code: string): Promise<string[]> {
  // A path inside src/ so the same config blocks apply as to the real tool files.
  const [result] = await eslint.lintText(code, { filePath: 'src/lib/services/__lint-probe.ts' });
  return (result?.messages ?? [])
    .filter((m) => m.ruleId === 'no-restricted-syntax')
    .map((m) => m.message);
}

const withParameters = (schema: string) => `
import { tool } from 'ai';
import { z } from 'zod';
export const t = tool({
  description: 'probe',
  parameters: z.object({ ${schema} }),
  execute: async () => ({ ok: true }),
});
`;

describe('no bounds inside an AI tool’s parameters', () => {
  it('catches .optional(), which admits undefined but not the null a model sends', async () => {
    const messages = await lintSnippet(withParameters(`slug: z.string().optional()`));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain('nullish');
  });

  it.each(['min', 'max'])('catches .%s(), which ends the turn instead of clamping', async (m) => {
    const messages = await lintSnippet(withParameters(`ids: z.array(z.string()).${m}(6)`));
    expect(messages).toHaveLength(1);
  });

  it('catches a bound nested deep in the schema, not just at the top level', async () => {
    const messages = await lintSnippet(
      withParameters(`days: z.array(z.object({ note: z.string().max(140) }))`),
    );
    expect(messages).toHaveLength(1);
  });

  it('allows the shapes that are actually correct', async () => {
    const messages = await lintSnippet(
      withParameters(`slug: z.string().nullish().describe('a slug'), ids: z.array(z.string())`),
    );
    expect(messages).toEqual([]);
  });

  it('does not fire on .max() outside a tool call — this is not a blanket ban on zod', async () => {
    const messages = await lintSnippet(`
      import { z } from 'zod';
      export const wire = z.object({ title: z.string().max(200).optional() });
    `);
    expect(messages).toEqual([]);
  });

  it('leaves the real tool files clean', async () => {
    const results = await eslint.lintFiles([
      'src/lib/services/planner-agent.ts',
      'src/lib/services/admin-assistant.ts',
    ]);
    const offenders = results.flatMap((r) =>
      r.messages
        .filter((m) => m.ruleId === 'no-restricted-syntax')
        .map((m) => `${r.filePath}:${m.line}`),
    );
    expect(offenders).toEqual([]);
  });
});

/**
 * The rule cannot see a schema hoisted out of the tool call, so tourContentPatchSchema needed the
 * split by hand: a bound-free INPUT shape for the model, clamped down to the strict shape that still
 * guards the wire. These assertions are what keep the two in step — a limit tightened on the strict
 * side with no matching clamp fails here rather than in a 500 six weeks later.
 */
describe('clampTourContentPatch', () => {
  const OVERSIZED = {
    title: 'T'.repeat(500),
    summary: 'S'.repeat(4000),
    description: 'D'.repeat(50_000),
    location: 'L'.repeat(500),
    meetingPoint: 'M'.repeat(2000),
    cancellationPolicy: 'C'.repeat(9000),
    seoTitle: 'Q'.repeat(900),
    seoDescription: 'R'.repeat(2000),
    highlights: Array.from({ length: 40 }, () => 'H'.repeat(900)),
    inclusions: Array.from({ length: 40 }, () => 'I'.repeat(900)),
    exclusions: Array.from({ length: 40 }, () => 'E'.repeat(900)),
    whatToBring: Array.from({ length: 40 }, () => 'W'.repeat(900)),
    importantInfo: Array.from({ length: 40 }, () => 'N'.repeat(2000)),
  };

  it('accepts a wildly oversized patch and yields one the strict schema takes', () => {
    // The whole point: the model overrunning a length it was merely ASKED for must not 500.
    expect(tourContentPatchInputSchema.safeParse(OVERSIZED).success).toBe(true);
    const clamped = clampTourContentPatch(OVERSIZED);
    expect(tourContentPatchSchema.safeParse(clamped).success).toBe(true);
    expect(clamped.description).toHaveLength(8000);
    expect(clamped.highlights).toHaveLength(12);
    expect(clamped.importantInfo?.[0]).toHaveLength(500);
  });

  it('keeps an absent key absent — a patch must never blank a field nobody touched', () => {
    // applyPatch folds only the keys present, so an empty string here would erase a description.
    const clamped = clampTourContentPatch({ highlights: ['One', 'Two'] });
    expect(Object.keys(clamped)).toEqual(['highlights']);
    expect('description' in clamped).toBe(false);
  });

  it('treats an explicit null as untouched, not as a blanking instruction', () => {
    const clamped = clampTourContentPatch({ description: null, title: '  Sunset cruise  ' });
    expect(clamped).toEqual({ title: 'Sunset cruise' });
  });

  it('drops entries that are only whitespace', () => {
    const clamped = clampTourContentPatch({ summary: '   ', highlights: ['ok', '   ', ''] });
    expect(clamped).toEqual({ highlights: ['ok'] });
  });
});
