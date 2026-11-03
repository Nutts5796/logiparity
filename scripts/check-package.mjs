import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), 'logiparity-package-'));
const npmCli = process.env.npm_execpath;
const npm = (args, cwd = root) => run(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd, env: { ...process.env, npm_config_audit: 'true', npm_config_cache: join(temporary, 'cache') }, maxBuffer: 16 * 1024 * 1024, timeout: 120000 });
try {
  const args = ['--ignore-scripts', '--json', '--offline', '--no-fund'];
  const dry = JSON.parse((await npm(['pack', '--dry-run', ...args])).stdout)[0];
  assert.equal(dry.name, 'logiparity'); assert.equal(dry.version, '1.0.1');
  const files = new Set(dry.files.map((file) => file.path));
  for (const file of ['bin/logiparity.js', 'README.md', 'LICENSE', 'CODE_OF_CONDUCT.md', 'docs/ci.md', 'docs/faq.md', 'docs/development/milestones.md', 'examples/staging/driver-no-show-target.yaml', 'examples/staging/driver-no-show.yaml', 'examples/freight/parity.yaml', 'examples/freight/tms-loads.csv', 'examples/freight/carrier-settlement-lines.csv', 'templates/github-actions.yml', 'templates/github-actions-container.yml', 'templates/gitlab-ci.yml']) assert(files.has(file), `Missing packaged ${file}`);
  assert(!files.has('MILESTONE_REPORT.md'));
  for (const name of ['cli', 'core', 'adapters', 'scenarios', 'ai']) {
    for (const file of ['package.json', 'LICENSE', `dist/${name === 'cli' ? 'main' : 'index'}.js`]) assert(files.has(`node_modules/@logiparity/${name}/${file}`), `Missing bundled ${name}/${file}`);
  }
  for (const file of files) {
    assert(!/^(?:tests|scripts|output|coverage|logiparity-report|logiparity-scenario-report|logiparity-ai-drafts|\.git)\//.test(file), `Unexpected first-party artifact ${file}`);
    assert(!/^examples\/demo\/(?:auth|out)\//.test(file), `Private/generated demo artifact ${file}`);
    assert(!/^node_modules\/@logiparity\/[^/]+\/(?:src|tests)\//.test(file), `Uncompiled private workspace ${file}`);
    assert(!/^node_modules\/(?:typescript|vitest|eslint|@vitest|@eslint)\//.test(file), `Development dependency ${file}`);
    assert(!/(?:^|\/)\.env(?:\.|$)/.test(file), `Environment file ${file}`);
  }
  const packed = JSON.parse((await npm(['pack', '--pack-destination', temporary, ...args])).stdout)[0];
  const offline = join(temporary, 'offline-consumer'); await mkdir(offline);
  await npm(['install', join(temporary, packed.filename), ...args], offline);
  const install = join(temporary, 'consumer'); await mkdir(install);
  await npm(['init', '-y'], install);
  await npm(['install', join(temporary, packed.filename)], install);
  const consumerLock = await readFile(join(install, 'package-lock.json'), 'utf8');
  await rm(join(install, 'node_modules'), {recursive:true,force:true});
  await npm(['ci'], install);
  assert.equal(await readFile(join(install, 'package-lock.json'), 'utf8'), consumerLock);
  const audit = await npm(['audit'], install);
  assert.match(audit.stdout, /found 0 vulnerabilities/);
  const npmVersion = (await npm(['--version'])).stdout.trim();
  const publicProbe = `for (const [name,symbol] of [['core','compareEntities'],['adapters','adapters'],['scenarios','runScenario'],['ai','prepareDraft']]) { const m = await import('logiparity/'+name); if (!m[symbol]) throw new Error('Missing public API '+name); }`;
  await run(process.execPath, ['--input-type=module', '-e', publicProbe], { cwd: install });
  await writeFile(join(install, 'types.mts'), `import type {EntityConfig} from 'logiparity/core';
import type {adapters} from 'logiparity/adapters';
import type {InvariantResult} from 'logiparity/scenarios';
import type {AiProvider} from 'logiparity/ai';
export type PublicContracts = [EntityConfig, typeof adapters, InvariantResult, AiProvider];
const provider: AiProvider = {async complete() {return 'synthetic';}};
export {provider};
`);
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--skipLibCheck', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--target', 'ES2022', 'types.mts'], { cwd: install });
  const bin = join(install, 'node_modules/logiparity/bin/logiparity.js');
  const work = join(temporary, 'work'); await mkdir(work);
  const cli = (args) => run(process.execPath, [bin, ...args], { cwd: work, env: { ...process.env, LOGIPARITY_AI_BASE_URL: '', LOGIPARITY_AI_MODEL: '', LOGIPARITY_AI_API_KEY: '' }, timeout: 30000 });
  assert.match((await cli(['--help'])).stdout, /LogiParity 1\.0\.1/);
  assert.equal((await cli(['--version'])).stdout.trim(), '1.0.1');
  await cli(['init', '--config', 'starter.yaml']);
  await writeFile(join(work, 'a.csv'), 'ID,Payout,At\nS1,6.25,2026-11-02T13:01:00Z\n');
  await writeFile(join(work, 'b.csv'), 'ID,Payout,At\nS1,6.24,2026-11-02T13:00:00Z\n');
  const source = (file) => ({ type: 'csv', file, fields: { id: 'ID', payout: 'Payout', at: 'At' } });
  await writeFile(join(work, 'parity.yaml'), JSON.stringify({ version: 1, entities: [{ name: 'shipment', key: 'id', sources: { api: source('a.csv'), csv: source('b.csv') }, compare: { payout: { type: 'money', currency: 'USD' }, at: { type: 'datetime' } } }], report: { outputs: ['html', 'json', 'markdown', 'junit'], dir: './report' } }));
  assert.match((await cli(['validate', '--config', 'parity.yaml'])).stdout, /The configuration is valid/);
  let exit; try { await cli(['check', '--config', 'parity.yaml']); } catch (error) { exit = error.code; } assert.equal(exit, 1);
  const report = JSON.parse(await readFile(join(work, 'report/report.json'), 'utf8'));
  assert.equal(report.findings.length, 2);
  assert.deepEqual(report.groups.map((group) => group.kind), ['datetime_offset', 'money_delta']);
  const html = await readFile(join(work, 'report/report.html'), 'utf8');
  assert(html.includes('625 ($6.25)')); assert(html.includes('1793624460000 (2026-11-02T13:01:00Z)'));
  await cp(join(install,'node_modules/logiparity/examples/freight'),join(work,'freight-example'),{recursive:true});
  await cli(['validate','--config','freight-example/parity.yaml']);
  await cli(['check','--config','freight-example/parity.yaml']);
  const freight=JSON.parse(await readFile(join(work,'freight-example/logiparity-report/report.json'),'utf8'));
  assert.deepEqual(freight.findings,[]);
  assert.deepEqual(freight.entities[0].counts,{tms:3,settlement:9});
  for(const name of ['github-actions.yml','github-actions-container.yml','gitlab-ci.yml'])assert(!/REPLACE_WITH|<release digest>/.test(await readFile(join(install,'node_modules/logiparity/templates',name),'utf8')));
  const preview = await cli(['ai', 'scenario', '--from', 'Synthetic van breakdown']); assert.match(preview.stdout, /nothing sent/);
  const recordGroups = ['missing_stride', 'extra_stride'].map((kind) => ({ entity: 'shipment', source: 'csv', field: '', count: 3, kind, stride: '200', summary: 'Synthetic record stride.' }));
  const recordFindings = recordGroups.flatMap((group, index) => [200, 400, 600].map((number) => ({ type: index === 0 ? 'missing_in_source' : 'extra_in_source', entity: 'shipment', source: 'csv', key: `${index === 0 ? 'S' : 'X'}${number}`, field: '', message: 'Synthetic record difference' })));
  await writeFile(join(work, 'record-groups.json'), JSON.stringify({ schemaVersion: 1, entities: [{ entity: 'shipment', reference: 'api', counts: { api: 3, csv: 3 } }], findings: recordFindings, groups: recordGroups }));
  const explanation = await cli(['ai', 'explain', 'record-groups.json']); assert.match(explanation.stdout, /missing_stride/); assert.match(explanation.stdout, /extra_stride/); assert.match(explanation.stdout, /nothing sent/);
  // Exercise the separately bundled scenario DSL without importing the checkout.
  await writeFile(join(work, 'scenario.yaml'), 'version: 1\nname: invalid target reference\ntarget: demo\nevents: [{step: 1, type: vehicle_breakdown, params: {driver: D17}}]\nwait: {until: {replan_status: completed}}\ninvariants: [no_order_lost]\n');
  let errorCode; try { await cli(['scenario', 'run', 'scenario.yaml', '--target', 'missing-target.yaml']); } catch (error) { errorCode = error.code; } assert.equal(errorCode, 2);
  if (process.env.LOGIPARITY_PACK_OUTPUT) {
    const output = resolve(process.env.LOGIPARITY_PACK_OUTPUT); await mkdir(dirname(output), { recursive: true });
    await writeFile(output, JSON.stringify({ name: dry.name, version: dry.version, compressedBytes: packed.size, entries: dry.entryCount, bundledPackages: dry.bundled.length, offlineInstall: true, consumerCi: true, consumerAudit: true, npm: npmVersion, cliSmoke: true, files: [...files] }, null, 2) + '\n');
  }
  console.log(`Package verified: ${dry.name}@${dry.version}, ${dry.entryCount} entries, ${dry.bundled.length} bundled packages, ${packed.size} bytes; empty-cache offline install, plain consumer install/npm ci/npm audit (zero vulnerabilities) on npm ${npmVersion}, and CLI checks passed.`);
} finally { await rm(temporary, { recursive: true, force: true }); }
