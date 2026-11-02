import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = new URL('../', import.meta.url);
const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
const entries = [];
for (const [location, entry] of Object.entries(lock.packages)) {
  if (!location.includes('node_modules/') || entry.dev || entry.link) continue;
  const manifest = JSON.parse(await readFile(new URL(`${location}/package.json`, root), 'utf8'));
  const license = manifest.license ?? entry.license;
  if (!license) throw new Error(`Missing license for runtime dependency ${manifest.name}; inspect before adding it.`);
  entries.push({ name: manifest.name, version: manifest.version, license });
}
entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : a.version < b.version ? -1 : 1);
const unique = [...new Map(entries.map((e) => [`${e.name}@${e.version}`, e])).values()];
const preamble = `# Runtime dependencies and licenses

Generated from the committed lockfile by \`node scripts/dependencies.mjs\`.
Direct external runtime dependencies are pinned exactly:

| Package | Version | License | Purpose |
| --- | --- | --- | --- |
| csv-parse | 7.0.3 | MIT | Streaming CSV parsing |
| exceljs | 4.4.0 | MIT | XLSX cells, metadata and streaming rows/exports |
| jiti | 2.7.0 | MIT | Load explicitly configured TypeScript invariants on Node 20/22 |
| luxon | 3.7.2 | MIT | Explicit IANA timezone conversion and DST validation |
| pg | 8.23.1 | MIT | PostgreSQL client and read-only transaction lifecycle |
| pg-query-stream | 4.17.1 | MIT | Bounded PostgreSQL row batches |
| pgsql-ast-parser | 12.0.2 | MIT | Reject non-read-only SQL before connecting |
| playwright | 1.64.1 | Apache-2.0 | Isolated Chromium table extraction and failure screenshots |
| unzipper | 0.12.5 | MIT | Lazy central-directory XLSX entry streams |
| yaml | 2.9.1 | ISC | YAML parsing with duplicate-key checks |
| zod | 4.6.7 | MIT | Strict configuration validation |

Internal workspace packages use this repository's MIT license. Development tools are pinned in package.json and package-lock.json.

ExcelJS overrides pin unzipper 0.12.5 (removes an obsolete dependency chain with missing license metadata) and uuid 11.1.1 (compatible v4 API, fixes the older UUID advisory). XLSX regression tests exercise these overrides. Our XLSX reader uses a narrow typed bridge to ExcelJS 4.4.0 metadata and row parsers to avoid [upstream streaming race #3064](https://github.com/exceljs/exceljs/issues/3064). Recheck this bridge before updating ExcelJS.

The full transitive runtime inventory follows. jszip is consumed under its MIT alternative. pako includes MIT and Zlib notices; preserve both when redistributing. The SQL parser transitively includes railroad-diagrams under CC0-1.0; its declared license is recorded below and the package retains its notice. No runtime dependency has unknown license metadata.

## Locked transitive runtime inventory

| Package | Locked version | Declared license |
| --- | --- | --- |
`;
const output = preamble + unique.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`).join('\n') + '\n';
await writeFile(new URL('docs/dependencies.md', root), output);
console.log(`Recorded ${unique.length} runtime package versions in ${resolve('docs/dependencies.md')}`);
