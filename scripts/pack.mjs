import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
const run = (args, cwd) =>
  execute(
    process.env.npm_execpath ? process.execPath : 'npm',
    process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args,
    { cwd, maxBuffer: 32 * 1024 * 1024 },
  );
export async function packArtifact(destination) {
  const temporary = await mkdtemp(join(tmpdir(), 'logiparity-pack-'));
  try {
    const dry = JSON.parse(
      (await run(['pack', '--dry-run', '--ignore-scripts', '--offline', '--json'], root)).stdout,
    )[0];
    for (const entry of dry.files) {
      if (entry.path.endsWith('.map')) continue;
      const target = join(temporary, entry.path);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(root, entry.path), target, { dereference: true });
      if (entry.path === 'package.json' || /^node_modules\/@logiparity\/[^/]+\/package.json$/.test(entry.path)) {
        const manifest = JSON.parse(await readFile(target, 'utf8'));
        delete manifest.scripts;
        delete manifest.devDependencies;
        delete manifest.workspaces;
        await writeFile(target, JSON.stringify(manifest, null, 2) + '\n');
      }
    }
    await mkdir(destination, { recursive: true });
    return JSON.parse(
      (
        await run(
          ['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', resolve(destination)],
          temporary,
        )
      ).stdout,
    )[0];
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await packArtifact(process.argv[2] ?? 'output/release'), null, 2));
