import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  if (process.env.LOGIPARITY_PROFILE === 'slim')
    throw new Error(
      `${kind.toUpperCase()} sources require the full ghcr.io/nutts5796/logiparity image; select the same version without the -slim suffix`,
    );
  for (const name of adapter.packages) {
    try {
      require.resolve(name);
      let directory = dirname(require.resolve(name)),
        version: unknown;
      for (let depth = 0; depth < 8; depth++) {
        try {
          const manifest: unknown = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
          if (manifest && typeof manifest === 'object' && Reflect.get(manifest, 'name') === name) {
            version = Reflect.get(manifest, 'version');
            break;
          }
        } catch {
          /* Check the parent package directory. */
        }
        const parent = dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      const parts = typeof version === 'string' ? version.split('.').map(Number) : [];
      const [major = 0, minor = 0, patch = 0] = parts;
      const supported =
        name === 'playwright'
          ? major === 1 && minor >= 63 && minor < 65
          : name === 'pg'
            ? major === 8 && minor >= 16
            : name === 'pg-query-stream'
              ? major === 4 && (minor > 17 || (minor === 17 && patch >= 1))
              : major === 12 && (minor > 0 || patch >= 2);
      if (!supported)
        throw new Error(
          `Unsupported ${name} version ${String(version)}. Install a supported optional adapter: ${adapter.command}`,
        );
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'MODULE_NOT_FOUND')) throw error;
      throw new Error(
        `${kind === 'ui' ? 'UI' : 'SQL'} sources require optional packages. Run ${adapter.command}${kind === 'ui' ? ', then npx logiparity install-browser' : ''}`,
      );
    }
  }
}
