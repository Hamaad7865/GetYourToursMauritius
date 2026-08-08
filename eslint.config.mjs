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
  // A bound inside an AI tool's `parameters` is a 500, not a validation.
  //
  // The Vercel AI SDK validates model-supplied tool arguments BEFORE `execute` runs, and a failure
  // there throws AI_InvalidToolArgumentsError out of generateText — an unhandled 500 for a mistake
  // the MODEL made, not the user. So a constraint written here does not reject a bad argument, it
  // ends the whole turn. The same constraint written INSIDE `execute` becomes a fact handed back to
  // the model, which then corrects itself on its next step.
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
  //    invisible to this selector, so keep tool parameters inline.
  {
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.name="tool"] > ObjectExpression > Property[key.name="parameters"] CallExpression[callee.property.name=/^(optional|min|max)$/]',
          message:
            "No bounds inside an AI tool's `parameters`: the SDK validates model arguments before `execute` runs, so this throws AI_InvalidToolArgumentsError as an unhandled 500 instead of rejecting the value. Clamp/slice inside `execute` and hand the model a fact it can act on. For an optional field use `.nullish()`, never `.optional()` — models send an explicit null.",
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
