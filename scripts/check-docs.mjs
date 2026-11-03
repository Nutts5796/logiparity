import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument } from 'yaml';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })).stdout
  .split('\0')
  .filter(Boolean);
const failures = [];
let links = 0;
let yaml = 0;
for (const file of files) {
  if (file.endsWith('.md')) {
    const text = await readFile(resolve(root, file), 'utf8');
    for (const match of text.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '').split('#')[0];
      if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('/')) continue;
      try {
        await access(resolve(root, dirname(file), decodeURIComponent(target)));
        links++;
      } catch {
        failures.push(`${file}: missing local link ${target}`);
      }
    }
  }
  if (/\.ya?ml$/.test(file) && !file.startsWith('tests/fixtures/')) {
    const doc = parseDocument(await readFile(resolve(root, file), 'utf8'), { uniqueKeys: true });
    yaml++;
    if (doc.errors.length) failures.push(`${file}: invalid YAML: ${doc.errors.map((e) => e.code).join(', ')}`);
  }
}
const conduct = await readFile(resolve(root, 'CODE_OF_CONDUCT.md'), 'utf8');
if (conduct.includes('[INSERT CONTACT METHOD]') || !conduct.includes('version/2/1'))
  failures.push('CODE_OF_CONDUCT.md must contain completed Contributor Covenant 2.1');
if (failures.length) throw new Error(failures.join('\n'));
console.log(
  `Documentation passed: ${links} local links, ${yaml} YAML files, Contributor Covenant 2.1 contact/adaptation.`,
);
