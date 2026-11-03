import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyChecksum } from './release-state.mjs';
const execute = promisify(execFile);
const run = (command, args) => execute(command, args, { maxBuffer: 16 * 1024 * 1024, timeout: 300000 });
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const tag = process.env.TAG;
if (tag !== `v${version}`) throw new Error('Release tag must match package.json');
const directory = 'output/release';
await mkdir(directory, { recursive: true });
let release;
try {
  release = JSON.parse((await run('gh', ['release', 'view', tag, '--json', 'assets,body'])).stdout);
} catch (error) {
  if (!/release not found|HTTP 404/i.test(error.stderr ?? error.message)) throw error;
}
if (release) {
  for (const name of [
    `logiparity-${version}.tgz`,
    `logiparity-${version}.tgz.sha256`,
    `logiparity-${version}.cdx.json`,
    `logiparity-offline-${version}.tgz`,
    `logiparity-offline-${version}.tgz.sha256`,
  ]) {
    if (!release.assets.some((asset) => asset.name === name))
      throw new Error(`Existing release is missing ${name}; repair assets explicitly, never rebuild silently.`);
    await run('gh', ['release', 'download', tag, '--pattern', name, '--dir', directory]);
  }
  const archive = join(directory, `logiparity-${version}.tgz`);
  verifyChecksum(await readFile(archive), await readFile(archive + '.sha256', 'utf8'), `logiparity-${version}.tgz`);
  const offline = join(directory, `logiparity-offline-${version}.tgz`);
  verifyChecksum(
    await readFile(offline),
    await readFile(offline + '.sha256', 'utf8'),
    `logiparity-offline-${version}.tgz`,
  );
  const packed = JSON.parse((await run('tar', ['-xOf', archive, 'package/package.json'])).stdout);
  if (packed.name !== 'logiparity' || packed.version !== version)
    throw new Error('Existing tarball identity differs from the tag');
  await writeFile(join(directory, 'notes.md'), release.body ?? '');
  console.log('Reused the existing release tarball, checksum and SBOM without rebuilding.');
} else {
  if (process.env.IMAGE_ONLY === 'true') throw new Error('Image-only retries require existing release assets');
  await run('npm', ['ci', '--ignore-scripts']);
  await run('npm', ['run', 'release:prepare']);
  await writeFile(
    join(directory, 'notes.md'),
    `LogiParity ${version}\n\nThe attached checksum-verified tarball is published to npm and installed in both images. CycloneDX describes the runtime dependency inventory.\n`,
  );
}
