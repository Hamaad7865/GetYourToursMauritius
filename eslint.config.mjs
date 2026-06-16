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
  // Test files may use a relaxed ruleset.
  {
    files: ['tests/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  prettier,
);
