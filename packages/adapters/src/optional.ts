import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
const peers: Record<string, string> = manifest.peerDependencies;
const installCommand = (packages: readonly string[]) =>
  `npm install --save-dev --save-exact ${packages.map((name) => `${name}@${manifest.logiparityTestedPeers[name]}`).join(' ')}`;
export const optionalAdapters = {
  ui: { packages: ['playwright'], command: installCommand(['playwright']) },
  sql: {
    packages: ['pg', 'pg-query-stream', 'pgsql-ast-parser'],
    command: installCommand(['pg', 'pg-query-stream', 'pgsql-ast-parser']),
  },
} as const;
function compatible(version: unknown, range: string): boolean {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) return false;
  const compare = (other: string) => {
    const left = version.split('.').map(Number),
      right = other.split('.').map(Number);
    for (let index = 0; index < 3; index++)
      if (left[index] !== right[index]) return (left[index] ?? 0) - (right[index] ?? 0);
    return 0;
  };
  return range.split(' ').every((token) => {
    const match = token.match(/^(>=|<)(\d+\.\d+\.\d+)$/);
    return !!match && (match[1] === '>=' ? compare(match[2] ?? '') >= 0 : compare(match[2] ?? '') < 0);
  });
}
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
      const supported = compatible(version, peers[name] ?? '');
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
