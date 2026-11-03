import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const defaultRoot = fileURLToPath(new URL('../', import.meta.url));
export async function checkReleaseText(root = defaultRoot) {
  const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  const files = new Set(['package.json']);
  const walk = async (directory) => {
    const results = [];
    for (const item of await readdir(resolve(root, directory), { withFileTypes: true })) {
      const name = directory + '/' + item.name;
      if (item.isDirectory()) results.push(...(await walk(name)));
      else results.push(name);
    }
    return results;
  };
  for (const pattern of manifest.files ?? []) {
    if (pattern.includes('*')) {
      const base = dirname(pattern.slice(0, pattern.indexOf('*')) + 'x');
      const expression = new RegExp(
        '^' +
          pattern
            .split('*')
            .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('[^/]*') +
          '$',
      );
      for (const file of await walk(base)) if (expression.test(file)) files.add(file);
    } else {
      const clean = pattern.replace(/\/$/, '');
      const info = await stat(resolve(root, clean));
      if (info.isDirectory()) for (const file of await walk(clean)) files.add(file);
      else files.add(clean);
    }
  }
  const failures = [];
  for (const file of files) {
    if (!/\.(?:md|txt|json|ya?ml|html|js|ts)$/.test(file)) continue;
    const text = await readFile(resolve(root, file), 'utf8');
    for (const [index, line] of text.split('\n').entries())
      if (
        /\bunreleased\b|\bunder review\b|\bnot published\b|https?:\/\/[^\s)"']*\/compare\/[^\s)"']*HEAD\b/i.test(line)
      )
        failures.push(`${file}:${index + 1}: ${line.trim()}`);
  }
  if (failures.length) throw new Error('Release text contains pre-publication wording:\n' + failures.join('\n'));
  console.log(`Release text passed for ${files.size} shipped files at version ${manifest.version}.`);
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await checkReleaseText(process.argv[2] ? resolve(process.argv[2]) : defaultRoot);
