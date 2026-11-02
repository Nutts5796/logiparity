import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', '**/out/**', 'logiparity-report/**', 'logiparity-scenario-report/**', 'logiparity-ai-drafts/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.mjs', '**/*.js'], languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly', fetch: 'readonly', AbortSignal: 'readonly' } } },
  { rules: { '@typescript-eslint/no-explicit-any': 'error' } },
);
