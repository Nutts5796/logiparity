import { runtimeGraph } from './dependency-graph.mjs';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const sources = JSON.parse(await readFile(new URL('../licenses/upstream/sources.json', import.meta.url), 'utf8'));
const root = new URL('../', import.meta.url);
const notices = [
  'LogiParity third-party license texts\n\nIncludes the normal runtime graph and optional adapters. Standard license texts are identified explicitly when upstream omitted a license file.\n',
];
const entries = [];
for (const entry of await runtimeGraph()) {
  const path = entry.location;
  const manifest = JSON.parse(await readFile(new URL(path + '/package.json', root), 'utf8'));
  const files = (await readdir(new URL(path + '/', root))).filter((file) =>
    /^(?:licen[sc]e|copying|unlicense)(?:\.|$)/i.test(file),
  );
  let text;
  const fallback = sources.find((source) => source.package === manifest.name && source.version === manifest.version);
  if (files.length)
    text = (await Promise.all(files.sort().map((file) => readFile(new URL(path + '/' + file, root), 'utf8')))).join(
      '\n\n',
    );
  else if (fallback) {
    const bytes = await readFile(new URL('licenses/upstream/' + fallback.file, root));
    if (createHash('sha256').update(bytes).digest('hex') !== fallback.sha256)
      throw new Error('License checksum mismatch: ' + manifest.name);
    text = (fallback.note ? fallback.note + '\n\n' : '') + bytes.toString();
  } else throw new Error('Missing full license text: ' + manifest.name + '@' + manifest.version);
  entries.push({ name: manifest.name, version: manifest.version, text });
}
const unique = [...new Map(entries.map((entry) => [entry.name + '@' + entry.version, entry])).values()].sort((a, b) =>
  a.name.localeCompare(b.name),
);
for (const entry of unique)
  notices.push(`\n${'='.repeat(72)}\n${entry.name}@${entry.version}\n${'='.repeat(72)}\n\n${entry.text}\n`);
for (const font of ['manrope', 'jetbrainsmono'])
  notices.push(
    `\n${font} font\n\n` + (await readFile(new URL(`packages/core/assets/fonts/${font}-OFL.txt`, root), 'utf8')),
  );
await writeFile(new URL('THIRD_PARTY_LICENSES.txt', root), notices.join(''));
console.log(`Generated full license texts for ${unique.length} external package versions and two fonts.`);
