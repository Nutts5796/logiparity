import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout, clearTimeout } from 'node:timers';
const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const temporary = await mkdtemp(join(tmpdir(), 'logiparity-quickstart-'));
const started = performance.now(); let demo;
const npmCli = process.env.npm_execpath;
const env = { ...process.env, DEMO_PORT: '0', DEMO_DATE: '2026-11-02', BUG_EXPORT_DROPS_LAST_ROW: '0', BUG_ROUNDING_PAYOUT: '0', BUG_STATUS_STALE_UI: '0', BUG_TZ_SHIFT_EXPORT: '0', BUG_REPLAN_LOSES_ORDER: '0', BUG_DOUBLE_ASSIGN: '0' };
const npm = (args) => run(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, { cwd: temporary, env, timeout: 300000, maxBuffer: 2 * 1024 * 1024 });
try {
  // Copy the clean source file set, including the current review changes; never copy ignored auth/reports/node_modules.
  const files = (await run('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], { cwd: root })).stdout.split('\0').filter(Boolean);
  for (const file of files) { const destination = join(temporary, file); await mkdir(dirname(destination), { recursive: true }); await cp(join(root, file), destination); }
  await npm(['ci', '--ignore-scripts', '--no-audit', '--no-fund']);
  await npm(['run', 'build']);
  demo = spawn(process.execPath, ['apps/demo-delivery/dist/main.js'], { cwd: temporary, env, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = await new Promise((accept, reject) => {
    const timeout = setTimeout(() => reject(new Error('Quickstart demo did not start in 10s')), 10000); let text = '';
    demo.once('error', (error) => { clearTimeout(timeout); reject(error); });
    demo.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`Quickstart demo exited ${code}`)); });
    demo.stdout.on('data', (chunk) => { text += chunk.toString(); const match = text.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) { clearTimeout(timeout); accept(match[0]); } });
  });
  env.DEMO_API_URL = url;
  await npm(['run', 'demo:export']);
  const checked = await run(process.execPath, ['node_modules/.bin/logiparity', 'check', '--config', 'examples/demo/parity.yaml'], { cwd: temporary, env, timeout: 30000 });
  assert.match(checked.stdout, /0 findings \(0 blocking\)/);
  const report = JSON.parse(await readFile(join(temporary, 'logiparity-report/report.json'), 'utf8'));
  assert.deepEqual(report.findings, []); assert.deepEqual(report.entities[0].counts, { api: 2750, export: 2750, csv: 2750 });
  for (const file of ['report.html', 'report.md', 'junit.xml']) assert((await readFile(join(temporary, 'logiparity-report', file), 'utf8')).length > 100);
  await run(process.execPath, ['node_modules/.bin/logiparity', 'validate', '--config', 'examples/freight/parity.yaml'], { cwd: temporary, env });
  const freight = await run(process.execPath, ['node_modules/.bin/logiparity', 'check', '--config', 'examples/freight/parity.yaml'], { cwd: temporary, env });
  assert.match(freight.stdout, /0 findings \(0 blocking\)/);
  const readme = await readFile(join(temporary, 'README.md'), 'utf8');
  const staging = readme.split('## Try it on your staging')[1].split('## Disruption scenarios')[0];
  const yaml = staging.match(/```yaml\n([\s\S]*?)```/)[1];
  const commands = staging.match(/```sh\n([\s\S]*?)```/)[1];
  await run(process.execPath, ['node_modules/.bin/logiparity', 'init', '--config', 'starter.yaml'], {cwd: temporary, env});
  assert.equal(yaml, await readFile(join(temporary, 'starter.yaml'), 'utf8'), 'README staging YAML must match init verbatim');
  await writeFile(join(temporary, 'parity.yaml'), yaml);
  const staged = await run('sh', ['-eu', '-c', commands.replace('http://127.0.0.1:3010', url)], {cwd: temporary, env, timeout: 30000});
  assert.match(staged.stdout, /Configuration valid/); assert.match(staged.stdout, /0 findings \(0 blocking\)/);
  const stagingReport = JSON.parse(await readFile(join(temporary, 'logiparity-report/report.json'), 'utf8'));
  assert.deepEqual(stagingReport.findings, []); assert.deepEqual(stagingReport.entities[0].counts, {api:2750, export:2750});
  const seconds = Number(((performance.now() - started) / 1000).toFixed(2)); assert(seconds < 600, `Quickstart exceeded 10 minutes: ${seconds}s`);
  if (process.env.LOGIPARITY_QUICKSTART_OUTPUT) { const file = resolve(process.env.LOGIPARITY_QUICKSTART_OUTPUT); await mkdir(dirname(file), { recursive: true }); await writeFile(file, JSON.stringify({ node: process.version, seconds, cleanSourceCopy: true, install: 'npm ci --ignore-scripts', rowsPerSource: 2750, findings: 0, freightExample: true, readmeStaging: true, initMatchesReadme: true, reportFormats: 4 }, null, 2) + '\n'); }
  console.log(`Clean-source quickstart passed in ${seconds}s: npm ci, build, demo, export and 2,750-row API/XLSX/CSV check; all report files created; freight example validated and checked; README staging commands passed with only the API URL changed and YAML identical to init.`);
} finally {
  if (demo && demo.exitCode === null) { const exited = once(demo, 'exit'); demo.kill('SIGTERM'); await exited; }
  await rm(temporary, { recursive: true, force: true });
}
