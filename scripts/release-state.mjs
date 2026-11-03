import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const integrity = (bytes) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export function verifyChecksum(bytes, checksum, name) {
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (checksum.trim() !== `${digest}  ${name}`) throw new Error(`Checksum mismatch for ${name}`);
}
function sbomInventory(bytes) {
  const bom = JSON.parse(bytes.toString());
  const sorted = (items) =>
    (items ?? []).toSorted((a, b) => String(a['bom-ref'] ?? a.ref).localeCompare(String(b['bom-ref'] ?? b.ref)));
  return {
    format: bom.bomFormat,
    version: bom.specVersion,
    root: bom.metadata?.component,
    components: sorted(bom.components),
    dependencies: sorted(bom.dependencies),
  };
}
export function verifyExistingAssets(local, remote) {
  for (const name of Object.keys(local)) {
    if (!remote[name]) throw new Error(`Existing release is missing ${name}`);
    const same = name.endsWith('.cdx.json')
      ? isDeepStrictEqual(sbomInventory(local[name]), sbomInventory(remote[name]))
      : local[name].equals(remote[name]);
    if (!same) throw new Error(`Existing release asset differs: ${name}`);
  }
}
const absent = (error) => /release not found|HTTP 404|E404|404 Not Found/i.test(error.stderr ?? error.message ?? '');
export async function githubRelease({ tag, version, directory, run, requireExisting = false }) {
  const names = [`logiparity-${version}.tgz`, `logiparity-${version}.tgz.sha256`, `logiparity-${version}.cdx.json`];
  const local = Object.fromEntries(
    await Promise.all(names.map(async (name) => [name, await readFile(join(directory, name))])),
  );
  verifyChecksum(local[names[0]], local[names[1]].toString(), names[0]);
  let release;
  try {
    release = JSON.parse((await run('gh', ['release', 'view', tag, '--json', 'assets,body'])).stdout);
  } catch (error) {
    if (!absent(error)) throw error;
  }
  if (release) {
    const temporary = await mkdtemp(join(tmpdir(), 'logiparity-release-existing-'));
    try {
      for (const name of names) {
        if (!release.assets.some((asset) => asset.name === name))
          throw new Error(`Existing release is missing ${name}`);
        await run('gh', ['release', 'download', tag, '--pattern', name, '--dir', temporary]);
      }
      const remote = Object.fromEntries(
        await Promise.all(names.map(async (name) => [name, await readFile(join(temporary, name))])),
      );
      verifyExistingAssets(local, remote);
      // Preserve the existing SBOM bytes after comparing its stable dependency inventory.
      await writeFile(join(directory, names[2]), remote[names[2]]);
      await writeFile(join(directory, 'notes.md'), release.body ?? '');
      return 'existing';
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
  if (requireExisting) throw new Error('Image-only reruns require an existing GitHub release with matching assets.');
  await run('gh', [
    'release',
    'create',
    tag,
    ...names.map((name) => join(directory, name)),
    '--verify-tag',
    '--draft',
    '--title',
    tag,
    '--notes-file',
    join(directory, 'notes.md'),
  ]);
  return 'created';
}
export async function npmRelease({ version, archive, run, requireExisting = false }) {
  const expected = integrity(await readFile(archive));
  let published;
  try {
    published = JSON.parse((await run('npm', ['view', `logiparity@${version}`, 'dist.integrity', '--json'])).stdout);
  } catch (error) {
    if (!absent(error)) throw error;
  }
  if (published) {
    if (published !== expected) throw new Error(`Registry integrity differs for logiparity@${version}`);
    return 'existing';
  }
  if (requireExisting) throw new Error('Image-only reruns require a published npm version with matching integrity.');
  await run('npm', ['publish', archive, '--access', 'public', '--provenance']);
  return 'published';
}
