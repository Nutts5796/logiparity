import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
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
      if (entry.path.endsWith('.map') || entry.path.startsWith('node_modules/')) continue;
      const target = join(temporary, entry.path);
      await mkdir(dirname(target), { recursive: true });
      await cp(join(root, entry.path), target, { dereference: true });
    }
    const manifest = JSON.parse(await readFile(join(temporary, 'package.json'), 'utf8'));
    for (const field of ['scripts', 'devDependencies', 'workspaces', 'bundleDependencies', 'bundledDependencies'])
      delete manifest[field];
    manifest.dependencies = Object.fromEntries(
      Object.entries(manifest.dependencies).filter(([name]) => !name.startsWith('@logiparity/')),
    );
    manifest.files = [...manifest.files, 'lib/'];
    manifest.imports = {};
    for (const [name, directory, entry] of [
      ['core', 'packages/core', 'index'],
      ['adapters', 'packages/adapters', 'index'],
      ['scenarios', 'packages/scenarios', 'index'],
      ['ai', 'packages/ai', 'index'],
      ['cli', 'packages/cli', 'main'],
      ['demo-delivery', 'apps/demo-delivery', 'start'],
    ]) {
      await cp(join(root, directory, 'dist'), join(temporary, 'lib', name, 'dist'), { recursive: true });
      if (name === 'core')
        await cp(join(root, directory, 'assets'), join(temporary, 'lib', name, 'assets'), { recursive: true });
      manifest.imports['#logiparity/' + name] = {
        types: `./lib/${name}/dist/${entry}.d.ts`,
        default: `./lib/${name}/dist/${entry}.js`,
      };
    }
    const rewrite = async (directory) => {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) await rewrite(path);
        else if (entry.name.endsWith('.map')) await rm(path);
        else if (entry.name.endsWith('.js') || entry.name.endsWith('.d.ts'))
          await writeFile(path, (await readFile(path, 'utf8')).replaceAll('@logiparity/', '#logiparity/'));
      }
    };
    await rewrite(join(temporary, 'lib'));
    await rewrite(join(temporary, 'api'));
    await rewrite(join(temporary, 'bin'));
    await writeFile(join(temporary, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
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
