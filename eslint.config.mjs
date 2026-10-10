import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FlatCompat } from '@eslint/eslintrc';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

export default tseslint.config(
  {
    ignores: [
      '.next/**',
      '.vercel/**',
      '.design-tmp/**',
      '.claude/**',
      'node_modules/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'next-env.d.ts',
      'src/lib/supabase/types.ts',
    ],
  },
  // Next.js React + Core Web Vitals rules (eslintrc-style config bridged to flat).
  ...compat.extends('next/core-web-vitals'),
  // TypeScript recommended rules, correctly scoped to TS files.
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // Architectural boundary: the service layer must stay framework-agnostic so the
  // same backend can be lifted into a mobile/Node context unchanged.
  {
    files: ['src/lib/services/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['next', 'next/*'],
              message: 'Service layer must stay framework-agnostic — no Next.js imports.',
            },
            {
              group: ['react', 'react-dom', 'react/*'],
              message: 'Service layer must not import React.',
            },
            {
              group: ['@/lib/http', '@/lib/http/*', '**/http/*'],
              message:
                'Service layer must not import the HTTP bridge; routes call services, not the reverse.',
            },
            {
              group: ['@/lib/supabase/admin', '**/supabase/admin'],
              message:
                'Service layer must receive its db client via ServiceContext, never import the service-role admin client directly.',
            },
          ],
        },
      ],
    },
  },
  // A bound inside an AI tool's `inputSchema` is a lost step, not a validation.
  //
  // The Vercel AI SDK validates model-supplied tool arguments BEFORE `execute` runs. Under v4 a
  // failure there threw out of generateText as an unhandled 500; under v5 (2026-10) the SDK hands the
  // model a generic schema error and carries on — better, but the call still never runs, the model
  // burns one of the turn's few steps guessing what was wrong, and a turn at its step cap ends with
  // nothing on the visitor's map. The same constraint written INSIDE `execute` becomes a specific
  // fact handed back to the model ("six stops max — I dropped X"), which it acts on at once.
  //
  // This has bitten four times: an empty placeIds array (2026-08-01), seven ids against a six-stop
  // cap and `"activitySlug": null` against `.optional()` (both 2026-08-08), then the SAME null slip
  // reintroduced on a brand-new tool the very next day by a different author who had already worked
  // out half the rule. Reviews clearly do not catch it; the parser does.
  //
  // `.optional()` earns its place on the list for a subtler reason than the bounds: it admits
  // `undefined` but NOT `null`, and models write an explicit null for "no value" as readily as they
  // omit the key. Use `.nullish()`.
  //
  // Scope + limits, both deliberate:
  //  - Only `.optional`/`.min`/`.max` are matched, because those are the ones observed in production.
  //    Any refinement that can REJECT a value belongs in `execute` for the same reason — `.regex`,
  //    `.uuid`, `.email`, `.int`, `.length` — they are simply not common enough here to be worth the
  //    false-positive surface. Move them anyway when you touch one.
  //  - Only INLINE schemas are seen. A schema hoisted to a const outside the `tool({ … })` call is
  //    invisible to this selector, so keep a tool's input schema inline.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            // `parameters` was the key before AI SDK v5 renamed it; matching both means a tool written
            // from an old example is still caught rather than silently unguarded.
            'CallExpression[callee.name="tool"] > ObjectExpression > Property[key.name=/^(inputSchema|parameters)$/] CallExpression[callee.property.name=/^(optional|min|max)$/]',
          message:
            "No bounds inside an AI tool's `inputSchema`: the SDK validates model arguments before `execute` runs, so the call is refused and never executes — the model loses a step to a generic schema error. Clamp/slice inside `execute` and hand the model a fact it can act on. For an optional field use `.nullish()`, never `.optional()` — models send an explicit null.",
        },
      ],
    },
  },
  // Test files may use a relaxed ruleset.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
