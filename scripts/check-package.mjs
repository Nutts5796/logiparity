import { buildOfflineKit } from './offline-kit.mjs';
import { checkInstalledDemo } from './check-installed-demo.mjs';
import { packArtifact } from './pack.mjs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const run = promisify(execFile);
const version = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).version;
const temporary = await mkdtemp(join(tmpdir(), 'logiparity-package-'));
const npmCli = process.env.npm_execpath;
const npm = (args, cwd = root) =>
  run(npmCli ? process.execPath : 'npm', npmCli ? [npmCli, ...args] : args, {
    cwd,
    env: { ...process.env, npm_config_audit: 'true', npm_config_cache: join(temporary, 'cache') },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120000,
  });
try {
  await assert.rejects(npm(['pack', '--dry-run']), /pack:artifact/);
  const suppliedArchive = process.env.LOGIPARITY_TARBALL ? resolve(process.env.LOGIPARITY_TARBALL) : undefined;
  const dry = suppliedArchive
    ? JSON.parse(
        (await npm(['pack', suppliedArchive, '--dry-run', '--ignore-scripts', '--offline', '--json'])).stdout,
      )[0]
    : await packArtifact(temporary);
  if (suppliedArchive) await cp(suppliedArchive, join(temporary, dry.filename));
  assert.equal(dry.name, 'logiparity');
  assert.equal(dry.version, version);
  const files = new Set(dry.files.map((file) => file.path));
  for (const file of [
    'bin/logiparity.js',
    'node_modules/@logiparity/core/assets/fonts/manrope-latin.woff2',
    'node_modules/@logiparity/core/assets/fonts/jetbrainsmono-latin.woff2',
    'node_modules/@logiparity/core/assets/fonts/manrope-OFL.txt',
    'node_modules/@logiparity/core/assets/fonts/jetbrainsmono-OFL.txt',
    'README.md',
    'LICENSE',
    'CODE_OF_CONDUCT.md',
    'docs/ci.md',
    'docs/faq.md',
    'examples/staging/driver-no-show-target.yaml',
    'examples/staging/driver-no-show.yaml',
    'examples/freight/parity.yaml',
    'examples/freight/tms-loads.csv',
    'examples/freight/carrier-settlement-lines.csv',
    'templates/github-actions.yml',
    'templates/github-actions-container.yml',
    'templates/gitlab-ci.yml',
  ])
    assert(files.has(file), `Missing packaged ${file}`);
  assert(!files.has('MILESTONE_REPORT.md'));
  for (const path of files)
    assert(
      !/^(?:docs\/(?:images|design|development)|examples\/freight\/logiparity-report)\//.test(path) &&
        !path.endsWith('.map'),
      'Unwanted package content ' + path,
    );
  for (const name of ['cli', 'core', 'adapters', 'scenarios', 'ai']) {
    for (const file of ['package.json', 'LICENSE', `dist/${name === 'cli' ? 'main' : 'index'}.js`])
      assert(files.has(`node_modules/@logiparity/${name}/${file}`), `Missing bundled ${name}/${file}`);
  }
  for (const file of files) {
    assert(
      !/^(?:tests|scripts|output|coverage|logiparity-report|logiparity-scenario-report|logiparity-ai-drafts|\.git)\//.test(
        file,
      ),
      `Unexpected first-party artifact ${file}`,
    );
    assert(!/^examples\/demo\/(?:auth|out)\//.test(file), `Private/generated demo artifact ${file}`);
    assert(!/^node_modules\/@logiparity\/[^/]+\/(?:src|tests)\//.test(file), `Uncompiled private workspace ${file}`);
    assert(
      !/^node_modules\/(?:typescript|vitest|eslint|@vitest|@eslint)\//.test(file),
      `Development dependency ${file}`,
    );
    assert(!/(?:^|\/)\.env(?:\.|$)/.test(file), `Environment file ${file}`);
  }
  const packed = dry;
  const archive = join(temporary, packed.filename);
  const kit = process.env.LOGIPARITY_OFFLINE_KIT
    ? { archive: resolve(process.env.LOGIPARITY_OFFLINE_KIT) }
    : await buildOfflineKit(archive, temporary);
  await run('tar', ['-xzf', kit.archive, '-C', temporary]);
  assert(
    (await readFile(archive)).equals(await readFile(join(temporary, `logiparity-offline-${version}`, packed.filename))),
  );
  await writeFile(
    join(temporary, `logiparity-offline-${version}`, 'tarballs', '._not-an-archive.tgz'),
    'macOS metadata sidecar',
  );
  const offlineResults = [];
  for (const profile of ['default', 'full']) {
    const destination = join(temporary, 'offline-' + profile);
    await run(
      process.execPath,
      [join(temporary, `logiparity-offline-${version}`, 'install.mjs'), profile, destination],
      {
        env: { ...process.env, LOGIPARITY_NPM_CLI: npmCli },
        timeout: 180000,
        maxBuffer: 8 * 1024 * 1024,
      },
    );
    offlineResults.push(profile);
  }
  const install = join(temporary, 'consumer');
  await mkdir(install);
  await npm(['init', '-y'], install);
  await npm(['install', join(temporary, packed.filename)], install);
  const consumerLock = await readFile(join(install, 'package-lock.json'), 'utf8');
  await rm(join(install, 'node_modules'), { recursive: true, force: true });
  await npm(['ci'], install);
  assert.equal(await readFile(join(install, 'package-lock.json'), 'utf8'), consumerLock);
  const audit = await npm(['audit'], install);
  assert.match(audit.stdout, /found 0 vulnerabilities/);
  const full = join(temporary, 'consumer-full');
  await mkdir(full);
  await npm(['init', '-y'], full);
  const optional = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')).peerDependencies;
  await npm(['install', archive, ...Object.entries(optional).map(([name, value]) => `${name}@${value}`)], full);
  const fullLock = await readFile(join(full, 'package-lock.json'), 'utf8');
  await npm(['ci'], full);
  assert.equal(await readFile(join(full, 'package-lock.json'), 'utf8'), fullLock);
  assert.match((await npm(['audit'], full)).stdout, /found 0 vulnerabilities/);
  const manifest = JSON.parse((await run('tar', ['-xOf', archive, 'package/package.json'])).stdout);
  for (const field of ['scripts', 'devDependencies', 'workspaces']) assert(!Object.hasOwn(manifest, field));
  assert.deepEqual(
    dry.bundled.toSorted(),
    Object.keys(manifest.dependencies)
      .filter((name) => name.startsWith('@logiparity/'))
      .toSorted(),
  );
  assert(
    [...files]
      .filter((path) => path.startsWith('node_modules/'))
      .every((path) => path.startsWith('node_modules/@logiparity/')),
  );
  for (const [profile, directory] of [
    ['default', install],
    ['full', full],
  ]) {
    const bin = join(directory, 'node_modules/logiparity/bin/logiparity.js');
    for (const kind of ['ui', 'sql']) {
      const candidate =
        kind === 'ui'
          ? { type: 'ui', url: 'http://127.0.0.1:9', table: '#rows', fields: { id: 'td' } }
          : { type: 'sql', connectionEnv: 'TEST_DB', query: 'SELECT 1 AS id', fields: { id: 'id' } };
      const config = {
        version: 1,
        entities: [
          {
            name: 'row',
            key: 'id',
            sources: { reference: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } }, candidate },
          },
        ],
      };
      await writeFile(join(directory, 'optional.yaml'), JSON.stringify(config));
      const result = await run(process.execPath, [bin, 'validate', '--config', 'optional.yaml'], {
        cwd: directory,
        env: { ...process.env, TEST_DB: 'postgres://test@127.0.0.1:9/test' },
      }).then(
        (value) => ({ code: 0, ...value }),
        (error) => error,
      );
      assert.equal(result.code, profile === 'default' ? 2 : 0);
      if (profile === 'default')
        assert(
          result.stderr.includes(
            kind === 'ui'
              ? 'npm install --save-dev playwright@1.64.1'
              : 'npm install --save-dev pg@8.23.1 pg-query-stream@4.17.1 pgsql-ast-parser@12.0.2',
          ),
        );
    }
  }
  const overridden = join(temporary, 'consumer-overrides');
  await mkdir(overridden);
  await writeFile(
    join(overridden, 'package.json'),
    JSON.stringify({ name: 'override-probe', private: true, overrides: { luxon: '3.7.1' } }),
  );
  await npm(['install', archive], overridden);
  assert.equal(
    JSON.parse(await readFile(join(overridden, 'node_modules/luxon/package.json'), 'utf8')).version,
    '3.7.1',
  );
  await run(process.execPath, [join(overridden, 'node_modules/logiparity/bin/logiparity.js'), '--help'], {
    cwd: overridden,
  });
  await writeFile(join(overridden, 'reference.csv'), 'ID,At\nS1,2026-11-02T13:01:00Z\n');
  await writeFile(join(overridden, 'source.csv'), 'ID,At\nS1,11/02/2026 08:01\n');
  await writeFile(
    join(overridden, 'parity.json'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'order',
          key: 'id',
          sources: {
            reference: { type: 'csv', file: 'reference.csv', fields: { id: 'ID', at: 'At' } },
            csv: { type: 'csv', file: 'source.csv', fields: { id: 'ID', at: 'At' } },
          },
          compare: {
            at: { type: 'datetime', format: { csv: 'MM/dd/yyyy HH:mm' }, sourceTimezones: { csv: 'America/New_York' } },
          },
        },
      ],
    }),
  );
  await run(
    process.execPath,
    [join(overridden, 'node_modules/logiparity/bin/logiparity.js'), 'check', '--config', 'parity.json'],
    { cwd: overridden },
  );
  const npmVersion = (await npm(['--version'])).stdout.trim();
  const publicProbe = `import {createRequire} from 'node:module'; const require=createRequire(import.meta.url); for (const [name,symbol] of [['core','compareEntities'],['adapters','adapters'],['scenarios','runScenario'],['ai','prepareDraft']]) { const m = await import('logiparity/'+name); if (!m[symbol]) throw new Error('Missing public API '+name); } if(Object.keys(require.cache).some(path=>['pg','pg-query-stream','pgsql-ast-parser','playwright'].some(name=>path.includes('/node_modules/'+name+'/'))))throw new Error('An unused optional adapter was loaded');`;
  await run(process.execPath, ['--input-type=module', '-e', publicProbe], { cwd: install });
  await run(process.execPath, ['--input-type=module', '-e', publicProbe], { cwd: full });
  await writeFile(
    join(install, 'types.mts'),
    `import type {EntityConfig} from 'logiparity/core';
import type {adapters} from 'logiparity/adapters';
import type {InvariantResult} from 'logiparity/scenarios';
import type {AiProvider} from 'logiparity/ai';
export type PublicContracts = [EntityConfig, typeof adapters, InvariantResult, AiProvider];
const provider: AiProvider = {async complete() {return 'synthetic';}};
export {provider};
`,
  );
  await run(
    process.execPath,
    [
      join(root, 'node_modules/typescript/bin/tsc'),
      '--noEmit',
      '--strict',
      '--skipLibCheck',
      '--module',
      'NodeNext',
      '--moduleResolution',
      'NodeNext',
      '--target',
      'ES2022',
      'types.mts',
    ],
    { cwd: install },
  );
  const bin = join(install, 'node_modules/logiparity/bin/logiparity.js');
  await checkInstalledDemo(bin, join(temporary, 'installed-demo'));
  const work = join(temporary, 'work');
  await mkdir(work);
  const cli = (args) =>
    run(process.execPath, [bin, ...args], {
      cwd: work,
      env: { ...process.env, LOGIPARITY_AI_BASE_URL: '', LOGIPARITY_AI_MODEL: '', LOGIPARITY_AI_API_KEY: '' },
      timeout: 30000,
    });
  assert((await cli(['--help'])).stdout.includes('LogiParity ' + version));
  assert.equal((await cli(['--version'])).stdout.trim(), version);
  await cli(['init', '--config', 'starter.yaml']);
  await writeFile(join(work, 'a.csv'), 'ID,Payout,At\nS1,6.25,2026-11-02T13:01:00Z\n');
  await writeFile(join(work, 'b.csv'), 'ID,Payout,At\nS1,6.24,2026-11-02T13:00:00Z\n');
  const source = (file) => ({ type: 'csv', file, fields: { id: 'ID', payout: 'Payout', at: 'At' } });
  await writeFile(
    join(work, 'parity.yaml'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'shipment',
          key: 'id',
          sources: { api: source('a.csv'), csv: source('b.csv') },
          compare: { payout: { type: 'money', currency: 'USD' }, at: { type: 'datetime' } },
        },
      ],
      report: { outputs: ['html', 'json', 'markdown', 'junit'], dir: './report' },
    }),
  );
  assert.match((await cli(['validate', '--config', 'parity.yaml'])).stdout, /The configuration is valid/);
  let exit;
  try {
    await cli(['check', '--config', 'parity.yaml']);
  } catch (error) {
    exit = error.code;
  }
  assert.equal(exit, 1);
  const report = JSON.parse(await readFile(join(work, 'report/report.json'), 'utf8'));
  assert.equal(report.findings.length, 2);
  assert.deepEqual(
    report.groups.map((group) => group.kind),
    [],
  );
  const html = await readFile(join(work, 'report/report.html'), 'utf8');
  assert(html.includes('$6.25'));
  assert(html.includes('data:font/woff2;base64,'));
  assert(html.includes('font-src data:'));
  assert(!html.includes('fonts.googleapis.com'));
  assert.equal(report.coverage.explained, 0);
  assert(html.includes('Nov 2, 2026, 1:01 PM UTC'));
  assert(!html.includes('1793624460000'));
  await cp(join(install, 'node_modules/logiparity/examples/freight'), join(work, 'freight-example'), {
    recursive: true,
  });
  await cli(['validate', '--config', 'freight-example/parity.yaml']);
  await cli(['check', '--config', 'freight-example/parity.yaml']).then(
    () => {
      throw new Error('Intentional freight defects should fail');
    },
    (error) => assert.equal(error.code, 1),
  );
  const freight = JSON.parse(await readFile(join(work, 'freight-example/logiparity-report/report.json'), 'utf8'));
  assert.equal(freight.findings.length, 12);
  assert.deepEqual(freight.entities.find((entity) => entity.entity === 'load').counts, { rate: 40, settlement: 151 });
  for (const name of ['github-actions.yml', 'github-actions-container.yml', 'gitlab-ci.yml'])
    assert(
      !/REPLACE_WITH|<release digest>/.test(
        await readFile(join(install, 'node_modules/logiparity/templates', name), 'utf8'),
      ),
    );
  const preview = await cli(['ai', 'scenario', '--from', 'Synthetic van breakdown']);
  assert.match(preview.stdout, /nothing sent/);
  const recordGroups = ['missing_stride', 'extra_stride'].map((kind) => ({
    entity: 'shipment',
    source: 'csv',
    field: '',
    count: 3,
    kind,
    stride: '200',
    summary: 'Synthetic record stride.',
  }));
  const recordFindings = recordGroups.flatMap((group, index) =>
    [200, 400, 600].map((number) => ({
      type: index === 0 ? 'missing_in_source' : 'extra_in_source',
      entity: 'shipment',
      source: 'csv',
      key: `${index === 0 ? 'S' : 'X'}${number}`,
      field: '',
      message: 'Synthetic record difference',
    })),
  );
  await writeFile(
    join(work, 'record-groups.json'),
    JSON.stringify({
      schemaVersion: 1,
      entities: [{ entity: 'shipment', reference: 'api', counts: { api: 3, csv: 3 } }],
      findings: recordFindings,
      groups: recordGroups,
    }),
  );
  const explanation = await cli(['ai', 'explain', 'record-groups.json']);
  assert.match(explanation.stdout, /missing_stride/);
  assert.match(explanation.stdout, /extra_stride/);
  assert.match(explanation.stdout, /nothing sent/);
  // Exercise the separately bundled scenario DSL without importing the checkout.
  await writeFile(
    join(work, 'scenario.yaml'),
    'version: 1\nname: invalid target reference\ntarget: demo\nevents: [{step: 1, type: vehicle_breakdown, params: {driver: D17}}]\nwait: {until: {replan_status: completed}}\ninvariants: [no_order_lost]\n',
  );
  let errorCode;
  try {
    await cli(['scenario', 'run', 'scenario.yaml', '--target', 'missing-target.yaml']);
  } catch (error) {
    errorCode = error.code;
  }
  assert.equal(errorCode, 2);
  if (process.env.LOGIPARITY_PACK_OUTPUT) {
    const output = resolve(process.env.LOGIPARITY_PACK_OUTPUT);
    await mkdir(dirname(output), { recursive: true });
    await writeFile(
      output,
      JSON.stringify(
        {
          name: dry.name,
          version: dry.version,
          compressedBytes: packed.size,
          unpackedBytes: packed.unpackedSize,
          entries: dry.entryCount,
          bundledPackages: dry.bundled.length,
          offlineInstall: offlineResults,
          optionalPeerProfiles: ['default', 'full'],
          consumerOverrides: true,
          consumerCi: true,
          consumerAudit: true,
          npm: npmVersion,
          cliSmoke: true,
          files: [...files],
        },
        null,
        2,
      ) + '\n',
    );
  }
  console.log(
    `Package verified: ${dry.name}@${dry.version}, ${dry.entryCount} entries, ${dry.bundled.length} bundled packages, ${packed.size} bytes; empty-cache offline install, plain consumer install/npm ci/npm audit (zero vulnerabilities) on npm ${npmVersion}, and CLI checks passed.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
