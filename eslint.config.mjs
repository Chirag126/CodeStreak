// Root ESLint config: TypeScript packages (packages/*, apps/worker).
// apps/web has its own config (Next.js rules) and is linted by `pnpm --filter @codestreak/web lint`.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  globalIgnores([
    '**/node_modules/**',
    '**/dist/**',
    '**/.next/**',
    'target/**',
    'apps/web/**',
    'spikes/**',
    'scripts/**',
    'programs/**',
  ]),
  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-console': 'off',
    },
  },
]);
