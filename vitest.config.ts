import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@logiparity/ai': fileURLToPath(new URL('./packages/ai/src/index.ts', import.meta.url)),
      '@logiparity/scenarios': fileURLToPath(new URL('./packages/scenarios/src/index.ts', import.meta.url)),
      '@logiparity/core': fileURLToPath(new URL('./packages/core/src/index.ts', import.meta.url)),
      '@logiparity/adapters': fileURLToPath(new URL('./packages/adapters/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['tests/unit/**/*.test.ts', 'tests/adapters/**/*.test.ts'],
    testTimeout: 30000,
    coverage: {
      provider: 'v8',
      include: ['packages/core/src/**/*.ts'],
      exclude: ['packages/core/src/index.ts', 'packages/core/src/types.ts'],
      reporter: ['text', 'json-summary'],
      thresholds: { lines: 85 },
    },
  },
});
