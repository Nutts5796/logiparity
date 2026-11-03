import { readFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
export async function runtimeGraph() {
  const root = new URL('../', import.meta.url);
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'));
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  const found = new Map();
  const visit = (name, parent = '') => {
    if (name.startsWith('@logiparity/')) return;
    let location = parent;
    let entry;
    while (true) {
      const candidate = posix.join(location, 'node_modules', name);
      if (lock.packages[candidate]) {
        location = candidate;
        entry = lock.packages[candidate];
        break;
      }
      if (!location) throw new Error(`Missing locked runtime ${name}`);
      location = dirname(location);
      if (location === '.') location = '';
    }
    if (found.has(location)) return;
    found.set(location, entry);
    for (const child of Object.keys({ ...entry.dependencies, ...entry.optionalDependencies })) visit(child, location);
  };
  for (const name of Object.keys({ ...manifest.dependencies, ...manifest.peerDependencies })) visit(name);
  return [...found].map(([location, entry]) => ({ location, ...entry }));
}
