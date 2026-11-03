import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  githubRelease,
  integrity,
  npmRelease,
  verifyExistingAssets,
  type Runner,
} from '../../scripts/release-state.mjs';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-release-test-'));
  dirs.push(directory);
  const name = 'logiparity-1.0.1.tgz';
  const tar = Buffer.from('reviewed artifact');
  const assets: Record<string, Buffer> = {
    [name]: tar,
    [name + '.sha256']: Buffer.from(createHash('sha256').update(tar).digest('hex') + '  ' + name + '\n'),
    'logiparity-1.0.1.cdx.json': Buffer.from(
      JSON.stringify({
        bomFormat: 'CycloneDX',
        specVersion: '1.5',
        serialNumber: 'uuid:new',
        metadata: { timestamp: 'now', component: { name: 'logiparity', version: '1.0.1' } },
        components: [],
        dependencies: [],
      }),
    ),
  };
  for (const [name, bytes] of Object.entries(assets)) await writeFile(join(directory, name), bytes);
  await writeFile(join(directory, 'notes.md'), 'Original notes');
  return { directory, assets, tar, archive: join(directory, name) };
}
it('skips a matching GitHub release and preserves its existing SBOM bytes', async () => {
  const { directory, assets } = await fixture();
  const calls: string[][] = [];
  const remote: Record<string, Buffer> = {
    ...assets,
    'logiparity-1.0.1.cdx.json': Buffer.from(
      assets['logiparity-1.0.1.cdx.json']!.toString().replace('uuid:new', 'uuid:existing').replace('now', 'earlier'),
    ),
  };
  const run: Runner = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'view')
      return {
        stdout: JSON.stringify({ assets: Object.keys(assets).map((name) => ({ name })), body: 'Existing notes' }),
      };
    if (args[1] === 'download') {
      const name = args[args.indexOf('--pattern') + 1]!;
      await writeFile(join(args[args.indexOf('--dir') + 1]!, name), remote[name]!);
      return { stdout: '' };
    }
    throw new Error('Unexpected mutation');
  };
  expect(await githubRelease({ tag: 'v1.0.1', version: '1.0.1', directory, run })).toBe('existing');
  expect(calls.some((args) => args[1] === 'create')).toBe(false);
  expect(await readFile(join(directory, 'logiparity-1.0.1.cdx.json'))).toEqual(remote['logiparity-1.0.1.cdx.json']);
});
it('rejects mismatched release assets before any replacement', async () => {
  const { assets } = await fixture();
  expect(() => verifyExistingAssets(assets, { ...assets, 'logiparity-1.0.1.tgz': Buffer.from('different') })).toThrow(
    'asset differs',
  );
});
it('allows first creation and refuses image-only creation', async () => {
  const { directory } = await fixture();
  const calls: string[][] = [];
  const run: Runner = async (_command, args) => {
    calls.push(args);
    if (args[1] === 'view') throw Object.assign(new Error('release not found'), { stderr: 'release not found' });
    return { stdout: '' };
  };
  await expect(
    githubRelease({ tag: 'v1.0.1', version: '1.0.1', directory, run, requireExisting: true }),
  ).rejects.toThrow('Image-only');
  expect(calls.some((args) => args[1] === 'create')).toBe(false);
  expect(await githubRelease({ tag: 'v1.0.1', version: '1.0.1', directory, run })).toBe('created');
  expect(calls.find((args) => args[1] === 'create')).toContain('--draft');
});
it.each(['matching', 'different', 'absent'] as const)(
  'checks npm integrity before any publication: %s',
  async (state) => {
    const { archive, tar } = await fixture();
    const calls: string[][] = [];
    const run: Runner = async (_command, args) => {
      calls.push(args);
      if (args[0] === 'view') {
        if (state === 'absent') throw Object.assign(new Error('E404'), { stderr: 'E404' });
        return { stdout: JSON.stringify(state === 'matching' ? integrity(tar) : 'sha512-different') };
      }
      return { stdout: '' };
    };
    if (state === 'matching') expect(await npmRelease({ version: '1.0.1', archive, run })).toBe('existing');
    else if (state === 'different')
      await expect(npmRelease({ version: '1.0.1', archive, run })).rejects.toThrow('integrity differs');
    else {
      await expect(npmRelease({ version: '1.0.1', archive, run, requireExisting: true })).rejects.toThrow('Image-only');
      expect(calls.some((args) => args[0] === 'publish')).toBe(false);
      expect(await npmRelease({ version: '1.0.1', archive, run })).toBe('published');
      return;
    }
    expect(calls.some((args) => args[0] === 'publish')).toBe(false);
  },
);
it('does not treat network failures as absent releases', async () => {
  const { archive } = await fixture();
  const run: Runner = async () => {
    throw new Error('Network unavailable');
  };
  await expect(npmRelease({ version: '1.0.1', archive, run })).rejects.toThrow('Network unavailable');
});
