import { deterministicArchive } from './deterministic-tar.mjs';
import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const execute = promisify(execFile);
const npm = (args, cwd, env) =>
  execute(
    process.env.npm_execpath ? process.execPath : 'npm',
    process.env.npm_execpath ? [process.env.npm_execpath, ...args] : args,
    { cwd, env, maxBuffer: 8 * 1024 * 1024, timeout: 180000 },
  );
export async function buildOfflineKit(archive, destination) {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  const temporary = await mkdtemp(join(tmpdir(), 'logiparity-offline-build-'));
  const version = manifest.version,
    name = `logiparity-offline-${version}`,
    root = join(temporary, name),
    filename = basename(archive);
  const env = { ...process.env, npm_config_cache: process.env.npm_config_cache ?? join(temporary, 'cache') };
  try {
    await mkdir(join(root, 'tarballs'), { recursive: true });
    await cp(archive, join(root, filename));
    const downloads = new Map();
    for (const profile of ['default', 'full']) {
      const directory = join(root, profile);
      await mkdir(directory);
      const dependencies = {
        logiparity: `file:../${filename}`,
        ...(profile === 'full'
          ? Object.fromEntries(
              Object.keys(manifest.peerDependencies).map((name) => [name, manifest.devDependencies[name]]),
            )
          : {}),
      };
      await writeFile(
        join(directory, 'package.json'),
        JSON.stringify(
          { name: 'logiparity-offline-consumer', version: '0.0.0', private: true, dependencies },
          null,
          2,
        ) + '\n',
      );
      await npm(['install', '--package-lock-only', '--ignore-scripts', '--no-fund'], directory, env);
      const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
      // The installer puts the CLI beside the manifests in the chosen destination.
      lock.packages[''].dependencies.logiparity = `file:./${filename}`;
      lock.packages['node_modules/logiparity'].resolved = `file:${filename}`;
      const packageJson = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
      packageJson.dependencies.logiparity = `file:./${filename}`;
      await writeFile(join(directory, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
      await writeFile(join(directory, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
      for (const [path, entry] of Object.entries(lock.packages))
        if (entry.resolved?.startsWith('https:') && !entry.inBundle) {
          const key = `${path.split('node_modules/').at(-1).replaceAll('/', '-')}-${entry.version}.tgz`;
          if (downloads.has(key) && downloads.get(key).integrity !== entry.integrity)
            throw new Error('Conflicting archive ' + key);
          downloads.set(key, { url: entry.resolved, integrity: entry.integrity });
        }
    }
    for (const [file, entry] of downloads) {
      const response = await fetch(entry.url, { redirect: 'error', signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Tarball HTTP ${response.status}: ${file}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      const [algorithm, digest] = entry.integrity.split('-', 2);
      if (createHash(algorithm).update(bytes).digest('base64') !== digest)
        throw new Error('Dependency integrity mismatch: ' + file);
      await writeFile(join(root, 'tarballs', file), bytes);
    }
    await cp(new URL('./offline-install.mjs', import.meta.url), join(root, 'install.mjs'));
    const paths = [
      filename,
      'install.mjs',
      ...['default', 'full'].flatMap((profile) => [profile + '/package.json', profile + '/package-lock.json']),
      ...[...downloads.keys()].map((file) => 'tarballs/' + file),
    ];
    const checksums = Object.fromEntries(
      await Promise.all(
        paths.map(async (path) => [
          path,
          createHash('sha256')
            .update(await readFile(join(root, path)))
            .digest('hex'),
        ]),
      ),
    );
    await writeFile(join(root, 'manifest.json'), JSON.stringify({ version, filename, checksums }, null, 2) + '\n');
    await writeFile(
      join(root, 'README.txt'),
      'LogiParity verified offline kit. Run node install.mjs default /absolute/empty/project or full for optional UI/SQL packages. Each run creates an empty temporary npm cache and seeds it only from verified local archives, then runs npm ci --offline. Chromium binaries are separate: run npx logiparity install-browser with network access after a full install.\n',
    );
    await mkdir(destination, { recursive: true });
    const kit = resolve(destination, name + '.tgz');
    await deterministicArchive(root, name, kit);
    const digest = createHash('sha256')
      .update(await readFile(kit))
      .digest('hex');
    await writeFile(kit + '.sha256', digest + '  ' + basename(kit) + '\n');
    return { archive: kit, dependencies: downloads.size };
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
