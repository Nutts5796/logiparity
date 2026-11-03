import { readFile, writeFile } from 'node:fs/promises';
const [version, image, full, slim] = process.argv.slice(2);
if (!/^\d+\.\d+\.\d+$/.test(version) || ![full, slim].every((digest) => /^sha256:[a-f0-9]{64}$/.test(digest)))
  throw new Error('Invalid version or image digest');
const file = 'output/release/notes.md';
const existing = (await readFile(file, 'utf8'))
  .replace(/\n?<!-- logiparity-images -->[\s\S]*?<!-- \/logiparity-images -->\n?/g, '')
  .trimEnd();
const section = `\n\n<!-- logiparity-images -->\nBoth images support linux/amd64 and linux/arm64 and include Buildx provenance and SBOM attestations.\n\nContainer: \`${image}:${version}@${full}\`\n\nSlim container: \`${image}:${version}-slim@${slim}\`\n<!-- /logiparity-images -->\n`;
await writeFile(file, existing + section);
