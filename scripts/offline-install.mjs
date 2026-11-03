import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const [profile = 'default', destination] = process.argv.slice(2);
if (!['default', 'full'].includes(profile) || !destination)
  throw new Error('Usage: node install.mjs <default|full> <empty destination>');
const root = fileURLToPath(new URL('./', import.meta.url)),
  directory = resolve(destination);
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
for (const [path, hash] of Object.entries(manifest.checksums))
  if (
    createHash('sha256')
      .update(await readFile(join(root, path)))
      .digest('hex') !== hash
  )
    throw new Error('Offline kit checksum mismatch: ' + path);
await mkdir(directory, { recursive: true });
if ((await readdir(directory)).length) throw new Error('Offline destination must be empty; no files were changed.');
for (const file of ['package.json', 'package-lock.json']) await cp(join(root, profile, file), join(directory, file));
await cp(join(root, manifest.filename), join(directory, manifest.filename));
const cache = await mkdtemp(join(tmpdir(), 'logiparity-empty-cache-'));
const execute = promisify(execFile);
const cli = process.env.LOGIPARITY_NPM_CLI ?? process.env.npm_execpath;
const npm = (args) =>
  execute(cli ? process.execPath : 'npm', cli ? [cli, ...args] : args, {
    cwd: directory,
    env: { ...process.env, npm_config_cache: cache },
    maxBuffer: 8 * 1024 * 1024,
    timeout: 180000,
  });
try {
  const tarballs = Object.keys(manifest.checksums)
    .filter((path) => path.startsWith('tarballs/') && path.endsWith('.tgz'))
    .map((path) => join(root, path));
  await npm(['cache', 'add', '--offline', ...tarballs]);
  const result = await npm(['ci', '--offline', '--ignore-scripts', '--no-fund']);
  process.stdout.write(
    result.stdout
      .replace(/^found \d+ vulnerabilities.*$/gm, '')
      .replace(/^\d+ packages are looking for funding.*$/gm, ''),
  );
  console.log('Offline installation verified archive integrity; no online vulnerability audit was performed.');
  console.log(
    `Installed ${manifest.version} (${profile}) using only verified local tarballs and an initially empty npm cache.`,
  );
} finally {
  await rm(cache, { recursive: true, force: true });
}
