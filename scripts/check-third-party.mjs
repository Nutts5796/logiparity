import { Buffer } from 'node:buffer';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const commit = 'cfa434d4b8e102a8f55b8727b552a0063ee9044e';
const execute = promisify(execFile);
const directory = await mkdtemp(join(tmpdir(), 'logiparity-third-party-'));
try {
  let vendored = [];
  try {
    vendored = await readdir(join(root, 'vendor'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assert.equal(vendored.length, 0, 'New vendored runtime code requires an explicit upstream verification entry');
  const response = await fetch(`https://codeload.github.com/windyroad/JUnit-Schema/tar.gz/${commit}`, {
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Upstream tarball HTTP ${response.status}`);
  const archive = join(directory, 'upstream.tgz');
  await writeFile(archive, new Uint8Array(await response.arrayBuffer()));
  for (const name of ['JUnit.xsd', 'LICENSE']) {
    const { stdout } = await execute('tar', ['-xzOf', archive, `JUnit-Schema-${commit}/${name}`], {
      encoding: 'buffer',
      maxBuffer: 1024 * 1024,
    });
    const local = await readFile(join(root, 'tests/fixtures/junit', name));
    assert(local.equals(stdout), `Third-party fixture differs from upstream: ${name}`);
    console.log(`${name}: ${createHash('sha256').update(local).digest('hex')} matches ${commit}`);
  }
} finally {
  await rm(directory, { recursive: true, force: true });
}

// Font subsets are immutable Google Fonts artifacts. License texts are pinned to a git revision.
const fontRoot = new URL('../packages/core/assets/fonts/', import.meta.url);
const fonts = JSON.parse(await readFile(new URL('upstream.json', fontRoot), 'utf8'));
for (const entry of fonts.files) {
  const local = await readFile(new URL(entry.file, fontRoot));
  assert.equal(createHash('sha256').update(local).digest('hex'), entry.sha256, `Font asset hash: ${entry.file}`);
  const response = await fetch(entry.url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  assert(response.ok, `Font upstream HTTP ${response.status}: ${entry.file}`);
  assert(local.equals(Buffer.from(await response.arrayBuffer())), `Font asset differs from upstream: ${entry.file}`);
  console.log(`${entry.file}: ${entry.sha256} matches upstream`);
}
