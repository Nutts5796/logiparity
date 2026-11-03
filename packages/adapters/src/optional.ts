import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const optionalAdapters = {
  ui: { packages: ['playwright'], command: 'npm install --save-dev playwright@1.64.1' },
  sql: {
    packages: ['pg', 'pg-query-stream', 'pgsql-ast-parser'],
    command: 'npm install --save-dev pg@8.23.1 pg-query-stream@4.17.1 pgsql-ast-parser@12.0.2',
  },
} as const;
export function requireOptionalAdapter(kind: keyof typeof optionalAdapters): void {
  const adapter = optionalAdapters[kind];
  for (const name of adapter.packages) {
    try {
      require.resolve(name);
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND')) throw error;
      throw new Error(
        `${kind === 'ui' ? 'UI' : 'SQL'} sources require optional packages. Run ${adapter.command}${kind === 'ui' ? ', then npx logiparity install-browser' : ''}.`,
      );
    }
  }
}
