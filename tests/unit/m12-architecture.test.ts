import { expect, it } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile),
  script = resolve('scripts/check-architecture.mjs');
it('allows lower/runtime and cross-concern type dependencies, rejects reversals and indirect entry imports', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-architecture-'));
  try {
    for (const name of ['foundation', 'values', 'reporters']) await mkdir(join(dir, name));
    await writeFile(
      join(dir, 'foundation/types.ts'),
      "import type { V } from '../values/value.js';\nexport type T = V;\n",
    );
    await writeFile(
      join(dir, 'values/value.ts'),
      "import type { T } from '../foundation/types.js';\nexport type V = T;\n",
    );
    await writeFile(join(dir, 'reporters/view.ts'), "export * from '../values/value.js';\n");
    await expect(run(process.execPath, [script, dir])).resolves.toBeDefined();
    for (const text of [
      "export * from '../reporters/view.js';",
      "const x = import('../reporters/view.js');",
      "import { x } from '../index.js';",
      "import '@logiparity/adapters';",
      "import x from '../../../cli/src/main.js';",
      'const x = import(name);',
    ]) {
      await writeFile(join(dir, 'values/value.ts'), text);
      await expect(run(process.execPath, [script, dir])).rejects.toMatchObject({ code: 1 });
    }
    await writeFile(join(dir, 'values/value.ts'), 'export type V = string;');
    await writeFile(join(dir, 'index.ts'), 'export const hidden = 1;');
    await expect(run(process.execPath, [script, dir])).rejects.toMatchObject({ code: 1 });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
