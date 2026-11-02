import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const output = resolve(process.env.LOGIPARITY_RELEASE_DIR ?? join(root, 'output/release'));
const temporary = await mkdtemp(join(tmpdir(), 'logiparity-sbom-'));
const npmCli = process.env.npm_execpath;
const npm = (args, cwd = root) => run(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd, env: { ...process.env, npm_config_cache: join(temporary, 'cache') }, timeout: 120000, maxBuffer: 16 * 1024 * 1024 });
try {
  await mkdir(output, { recursive: true });
  const packed = JSON.parse((await npm(['pack', '--ignore-scripts', '--offline', '--json', '--pack-destination', output])).stdout)[0];
  const archive = join(output, packed.filename);
  const checksum = createHash('sha256').update(await readFile(archive)).digest('hex');
  await writeFile(`${archive}.sha256`, `${checksum}  ${packed.filename}\n`);
  const consumer = join(temporary, 'consumer'); await mkdir(consumer);
  await writeFile(join(consumer, 'package.json'), JSON.stringify({name:'logiparity-release-envelope',version:'0.0.0',private:true}));
  await npm(['install', archive, '--offline', '--ignore-scripts', '--no-audit', '--no-fund'], consumer);
  const sbom = JSON.parse((await npm(['sbom', '--omit=dev', '--sbom-format=cyclonedx'], consumer)).stdout);
  // Generate from the consumer so npm treats the packed manifest as a dependency
  // and excludes its development requirements. Promote the real artifact to BOM root.
  const envelope = sbom.metadata.component['bom-ref'];
  const artifact = sbom.components.find((component) => component.name === 'logiparity' && component.version === packed.version);
  assert(artifact, 'Missing installed LogiParity artifact');
  sbom.metadata.component = artifact;
  sbom.components = sbom.components.filter((component) => component !== artifact);
  sbom.dependencies = sbom.dependencies.filter((dependency) => dependency.ref !== envelope);
  const references = new Set([artifact, ...sbom.components].map((component) => component['bom-ref']));
  for (const dependency of sbom.dependencies) for (const ref of [dependency.ref, ...dependency.dependsOn]) assert(references.has(ref), `Dangling SBOM reference ${ref}`);
  assert.equal(sbom.metadata.component.name, 'logiparity');
  assert.equal(sbom.metadata.component.version, packed.version);
  assert(sbom.components.some((component) => component.name === '@logiparity/exceljs'));
  for (const name of ['luxon', 'playwright', 'unzipper', 'uuid']) assert(sbom.components.some((component) => component.name === name), `Missing bundled ${name}`);
  assert(!sbom.components.some((component) => ['vitest', 'eslint', 'typescript'].includes(component.name)));
  await writeFile(join(output, `logiparity-${packed.version}.cdx.json`), JSON.stringify(sbom, null, 2) + '\n');
  console.log(`Prepared ${packed.filename}, verified SHA-256 ${checksum}, and CycloneDX SBOM (${sbom.components.length} bundled components). Nothing published.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
