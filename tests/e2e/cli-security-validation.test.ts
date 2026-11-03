import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../helpers.js';
const cli = resolve('packages/cli/dist/main.js');
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
async function dir() {
  const d = await mkdtemp(join(tmpdir(), 'logiparity-cli-security-'));
  dirs.push(d);
  return d;
}
async function run(args: string[], cwd: string, env: NodeJS.ProcessEnv = {}) {
  const child = spawn(process.execPath, [cli, ...args], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (v: Buffer) => {
    stdout += v.toString();
  });
  child.stderr.on('data', (v: Buffer) => {
    stderr += v.toString();
  });
  const [code] = await once(child, 'exit');
  return { code, stdout, stderr };
}
it('prints the installed version without configuration', async () => {
  const result = await run(['--version'], await dir());
  expect(result).toEqual({ code: 0, stdout: '1.0.1\n', stderr: '' });
});
it('validates schema, field references and extraction syntax without reading files or contacting servers', async () => {
  const d = await dir();
  let hits = 0;
  const server = await startServer((_, res) => {
    hits++;
    res.end('{}');
  });
  const config = {
    version: 1,
    entities: [
      {
        name: 'load',
        key: 'id',
        sources: {
          api: { type: 'rest', baseUrl: server.url, path: '/', fields: { id: '$.id' } },
          file: { type: 'csv', file: 'missing.csv', fields: { id: 'ID' } },
        },
      },
    ],
  };
  try {
    await writeFile(join(d, 'config.yaml'), JSON.stringify(config));
    expect((await run(['validate', '--config', 'config.yaml'], d)).code).toBe(0);
    expect(hits).toBe(0);
    config.entities[0]!.sources.api.fields.id = '$..id';
    await writeFile(join(d, 'config.yaml'), JSON.stringify(config));
    expect((await run(['validate', '--config', 'config.yaml'], d)).code).toBe(2);
    expect(hits).toBe(0);
    await writeFile(
      join(d, 'config.yaml'),
      JSON.stringify({ ...config, entities: [{ ...config.entities[0], compare: { missing: { type: 'string' } } }] }),
    );
    expect((await run(['validate', '--config', 'config.yaml'], d)).stderr).toContain('not mapped');
  } finally {
    await server.close();
  }
});
it.each(['omitted', 'fixed', 'module denied', 'module allowed', 'module outside'] as const)(
  'runs scenario preflight and optional wait: %s',
  async (mode) => {
    const d = await dir();
    let events = 0;
    const server = await startServer((req, res) => {
      if (req.method === 'POST') events++;
      res.end(JSON.stringify({ data: [{ id: 'L1' }] }));
    });
    try {
      await writeFile(
        join(d, 'check.ts'),
        'export default ()=>({name:"custom",passed:true,affectedKeys:[],explanation:"checked"})',
      );
      await writeFile(
        join(d, 'target.yaml'),
        JSON.stringify({
          version: 1,
          name: 'test',
          environment: 'test',
          allowMutations: true,
          baseUrl: server.url,
          events: { driver_no_show: { method: 'POST', path: '/event' } },
          state: { orders: { type: 'rest', baseUrl: server.url, path: '/', fields: { id: '$.id' } } },
        }),
      );
      const moduleMode = mode.startsWith('module');
      await writeFile(
        join(d, 'scenario.yaml'),
        JSON.stringify({
          version: 1,
          name: 'absence',
          target: 'test',
          events: [{ step: 1, type: 'driver_no_show', params: { driver: 'D1' } }],
          ...(mode === 'fixed' ? { wait: { seconds: 0.01 } } : {}),
          invariants: moduleMode
            ? [{ name: 'custom', module: mode === 'module outside' ? join(d, 'check.ts') : './check.ts' }]
            : ['no_order_lost'],
        }),
      );
      const allowed = mode === 'module allowed' || mode === 'module outside';
      const result = await run(
        [
          'scenario',
          'run',
          'scenario.yaml',
          '--target',
          'target.yaml',
          '--report-dir',
          'report',
          ...(allowed ? ['--allow-modules'] : []),
        ],
        d,
      );
      expect(result.code, result.stdout + result.stderr).toBe(
        mode === 'module denied' || mode === 'module outside' ? 2 : 0,
      );
      expect(events).toBe(mode === 'module denied' || mode === 'module outside' ? 0 : 1);
      if (mode === 'module denied') expect(result.stderr).toContain('--allow-modules');
    } finally {
      await server.close();
    }
  },
);
it('redacts a configured arbitrary-name credential in console errors and every report format', async () => {
  const d = await dir();
  const token = 'test-path-credential';
  await mkdir(join(d, token));
  const config = {
    version: 1,
    entities: [
      {
        name: 'load',
        key: 'id',
        sources: {
          file: { type: 'csv', file: `./${token}/missing.csv`, fields: { id: 'ID' } },
          api: {
            type: 'rest',
            baseUrl: 'http://127.0.0.1:1',
            path: '/',
            auth: { type: 'bearer', tokenEnv: 'CREDENTIAL_VALUE' },
            fields: { id: '$.id' },
          },
        },
      },
    ],
    report: { outputs: ['console', 'html', 'json', 'markdown', 'junit'], dir: 'report' },
  };
  await writeFile(join(d, 'config.yaml'), JSON.stringify(config));
  const result = await run(['check', '--config', 'config.yaml'], d, { CREDENTIAL_VALUE: token });
  expect(result.code).toBe(2);
  expect(result.stdout + result.stderr).not.toContain(token);
  for (const file of ['report.html', 'report.json', 'report.md', 'junit.xml']) {
    const text = await readFile(join(d, 'report', file), 'utf8');
    expect(text).not.toContain(token);
    expect(text).toContain('REDACTED');
  }
  await writeFile(join(d, token, 'invalid.yaml'), JSON.stringify({ ...config, typo: true }));
  const invalid = await run(['validate', '--config', `${token}/invalid.yaml`], d, { CREDENTIAL_VALUE: token });
  expect(invalid.code).toBe(2);
  expect(invalid.stderr).not.toContain(token);
});
it('runs the documented freight example', async () => {
  const result = await run(['check', '--config', resolve('examples/freight/parity.yaml')], await dir());
  expect(result.code, result.stdout + result.stderr).toBe(0);
  expect(result.stdout).toContain('0 findings');
});

it('retains secret interpolation metadata through engine and all reports', async () => {
  const d = await dir();
  const secret = 'interpolated-secret-fixture';
  await writeFile(
    join(d, 'config.yaml'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'load',
          key: 'id',
          sources: {
            file: { type: 'csv', file: './missing-${STAGING_API_SECRET}.csv', fields: { id: 'ID' } },
            other: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } },
          },
        },
      ],
      report: { dir: 'report', outputs: ['console', 'json', 'html', 'markdown', 'junit'] },
    }),
  );
  const result = await run(['check', '--config', 'config.yaml'], d, { STAGING_API_SECRET: secret });
  expect(result.code).toBe(2);
  expect(result.stdout + result.stderr).not.toContain(secret);
  expect(result.stdout).toContain('REDACTED');
  for (const file of ['report.json', 'report.html', 'report.md', 'junit.xml']) {
    const text = await readFile(join(d, 'report', file), 'utf8');
    expect(text).not.toContain(secret);
    expect(text).toContain('REDACTED');
  }
});
it('check and validate reject identical semantic errors before contacting sources', async () => {
  const d = await dir();
  let hits = 0;
  const server = await startServer((_, res) => {
    hits++;
    res.end('{}');
  });
  try {
    const config = {
      version: 1,
      entities: [
        {
          name: 'load',
          key: 'id',
          sources: {
            api: { type: 'rest', baseUrl: server.url, path: '/', fields: { id: '$.id' } },
            file: { type: 'csv', file: 'missing.csv', fields: { id: 'ID', status: 'Status' } },
          },
          compare: { status: { type: 'string' } },
        },
      ],
    };
    await writeFile(join(d, 'config.yaml'), JSON.stringify(config));
    const check = await run(['check', '--config', 'config.yaml'], d);
    const validate = await run(['validate', '--config', 'config.yaml'], d);
    expect(check.code).toBe(2);
    expect(check.stderr).toBe(validate.stderr);
    expect(check.stderr).toContain('not mapped');
    expect(check.stderr).toContain('entities[0].compare.status');
    expect(hits).toBe(0);
  } finally {
    await server.close();
  }
});
it('validates token and substitution env references consistently and supports secret-free linting', async () => {
  const d = await dir();
  await writeFile(
    join(d, 'config.yaml'),
    JSON.stringify({
      version: 1,
      entities: [
        {
          name: 'load',
          key: 'id',
          sources: {
            api: {
              type: 'rest',
              baseUrl: '${STAGING_API_URL}',
              path: '/',
              auth: { type: 'bearer', tokenEnv: 'STAGING_API_TOKEN' },
              headersEnv: { Authorization: { env: 'STAGING_API_TOKEN', prefix: 'Bearer ' }, 'X-Trace': 'TRACE_VALUE' },
              fields: { id: '$.id' },
            },
            file: { type: 'csv', file: 'missing.csv', fields: { id: 'ID' } },
          },
        },
      ],
    }),
  );
  const env = { STAGING_API_URL: '', STAGING_API_TOKEN: '', TRACE_VALUE: '' };
  expect((await run(['validate', '--config', 'config.yaml'], d, env)).stderr).toContain('STAGING_API_URL');
  expect(
    (await run(['validate', '--config', 'config.yaml'], d, { ...env, STAGING_API_URL: 'http://127.0.0.1:1' })).stderr,
  ).toContain('STAGING_API_TOKEN');
  const lint = await run(['validate', '--allow-missing-env', '--config', 'config.yaml'], d, env);
  expect(lint.code, lint.stderr).toBe(0);
  for (const name of Object.keys(env)) expect(lint.stdout).toContain(name);
  expect((await run(['check', '--allow-missing-env', '--config', 'config.yaml'], d, env)).code).toBe(2);
});
it('reuses one raw token for target event headers and state-source authentication', async () => {
  const d = await dir();
  const seen: string[] = [];
  const token = 'shared-staging-token';
  const server = await startServer((req, res) => {
    seen.push(req.headers.authorization ?? '');
    if (req.headers.authorization !== `Bearer ${token}`) res.statusCode = 401;
    res.end(JSON.stringify({ data: [{ id: 'L1' }] }));
  });
  try {
    await writeFile(
      join(d, 'target.yaml'),
      JSON.stringify({
        version: 1,
        name: 'test',
        environment: 'test',
        allowMutations: true,
        baseUrl: server.url,
        headersEnv: { Authorization: { env: 'STAGING_API_TOKEN', prefix: 'Bearer ' } },
        events: { http: { method: 'POST', path: '/event' } },
        state: {
          orders: {
            type: 'rest',
            baseUrl: server.url,
            path: '/',
            auth: { type: 'bearer', tokenEnv: 'STAGING_API_TOKEN' },
            fields: { id: '$.id' },
          },
        },
      }),
    );
    await writeFile(
      join(d, 'scenario.yaml'),
      JSON.stringify({
        version: 1,
        name: 'shared token',
        target: 'test',
        events: [{ step: 1, type: 'http' }],
        invariants: ['no_order_lost'],
      }),
    );
    const result = await run(
      ['scenario', 'run', 'scenario.yaml', '--target', 'target.yaml', '--report-dir', 'report'],
      d,
      { STAGING_API_TOKEN: token },
    );
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(seen).toEqual([`Bearer ${token}`, `Bearer ${token}`, `Bearer ${token}`]);
    expect(result.stdout + result.stderr).not.toContain(token);
  } finally {
    await server.close();
  }
});
it('redacts scenario secret interpolations during fixture preflight', async () => {
  const d = await dir();
  const secret = 'scenario-fixture-credential';
  await writeFile(
    join(d, 'scenario.yaml'),
    JSON.stringify({
      version: 1,
      name: 'fixture',
      target: 'test',
      setup: { fixture: './missing-${SCENARIO_PRIVATE_KEY}.json' },
      events: [{ step: 1, type: 'http' }],
      invariants: ['no_order_lost'],
    }),
  );
  await writeFile(
    join(d, 'target.yaml'),
    JSON.stringify({
      version: 1,
      name: 'test',
      environment: 'test',
      allowMutations: true,
      baseUrl: 'http://127.0.0.1:1',
      setup: { method: 'POST', path: '/setup' },
      events: { http: { method: 'POST', path: '/event' } },
      state: { orders: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } } },
    }),
  );
  const result = await run(['scenario', 'run', 'scenario.yaml', '--target', 'target.yaml'], d, {
    SCENARIO_PRIVATE_KEY: secret,
  });
  expect(result.code).toBe(2);
  expect(result.stdout + result.stderr).not.toContain(secret);
  expect(result.stderr).toContain('REDACTED');
});
it.each(['config', 'y', '1'])(
  'warns on short referenced secrets in validate and check without corrupting words: %s',
  async (secret) => {
    const d = await dir();
    await writeFile(join(d, 'a.csv'), 'ID\nL1001\n');
    await writeFile(join(d, 'b.csv'), 'ID\nL1001\n');
    const config = {
      version: 1,
      entities: [
        {
          name: 'load',
          key: 'id',
          sources: {
            a: { type: 'csv', file: 'a.csv', fields: { id: 'ID' } },
            b: { type: 'csv', file: 'b.csv', fields: { id: 'ID' } },
          },
        },
      ],
      variables: { credential: '${RAJ_API_TOKEN}' },
      report: { dir: 'report', outputs: ['console', 'json', 'html', 'markdown', 'junit'] },
    };
    await writeFile(join(d, 'target.yaml'), JSON.stringify(config));
    for (const command of ['validate', 'check']) {
      const result = await run([command, '--config', 'target.yaml'], d, { RAJ_API_TOKEN: secret });
      expect(result.code, result.stderr).toBe(0);
      expect(result.stderr).toContain('RAJ_API_TOKEN contains a secret shorter than 8');
      expect(result.stdout + result.stderr).not.toContain('invalid [REDACTED]uration');
    }
    for (const file of ['report.json', 'report.html', 'report.md', 'junit.xml'])
      expect(await readFile(join(d, 'report', file), 'utf8')).toContain('shorter than 8');
  },
);
it.each(['check', 'validate'])(
  'reports all missing URL and credential names with a command-specific hint: %s',
  async (command) => {
    const d = await dir();
    await writeFile(
      join(d, 'config.yaml'),
      JSON.stringify({
        version: 1,
        entities: [
          {
            name: 'load',
            key: 'id',
            sources: {
              a: {
                type: 'rest',
                baseUrl: '${M91_MISSING_URL}',
                path: '/',
                auth: { type: 'bearer', tokenEnv: 'M91_MISSING_TOKEN' },
                fields: { id: '$.id' },
              },
              b: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } },
            },
          },
        ],
      }),
    );
    const result = await run([command, '--config', 'config.yaml'], d, { M91_MISSING_URL: '', M91_MISSING_TOKEN: '' });
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('M91_MISSING_TOKEN');
    expect(result.stderr).toContain('M91_MISSING_URL');
    if (command === 'validate') expect(result.stderr).toContain('validate --allow-missing-env');
    else expect(result.stderr).not.toContain('--allow-missing-env');
  },
);
it('records an opted-in short-first-page warning in reports and preserves unexplained missing rows', async () => {
  const d = await dir();
  const server = await startServer((_, res) =>
    res.end(JSON.stringify({ data: Array.from({ length: 25 }, (_, i) => ({ id: `L${i}` })) })),
  );
  try {
    await writeFile(join(d, 'all.csv'), 'ID\n' + Array.from({ length: 60 }, (_, i) => `L${i}`).join('\n'));
    await writeFile(
      join(d, 'config.yaml'),
      JSON.stringify({
        version: 1,
        entities: [
          {
            name: 'load',
            key: 'id',
            sources: {
              file: { type: 'csv', file: 'all.csv', fields: { id: 'ID' } },
              api: {
                type: 'rest',
                baseUrl: server.url,
                path: '/',
                pagination: { type: 'page', size: 100, allowShortFirstPage: true },
                fields: { id: '$.id' },
              },
            },
          },
        ],
        report: { dir: 'report', outputs: ['console', 'json', 'html', 'markdown', 'junit'] },
      }),
    );
    const result = await run(['check', '--config', 'config.yaml'], d);
    expect(result.code).toBe(1);
    expect(result.stdout).toContain('1 warning');
    for (const file of ['report.json', 'report.html', 'report.md', 'junit.xml'])
      expect(await readFile(join(d, 'report', file), 'utf8')).toContain('unverified short first page');
  } finally {
    await server.close();
  }
});
it('retains the startup failure detail when the CLI module cannot load', async () => {
  const d = await dir();
  await writeFile(join(d, 'package.json'), '{"type":"module"}');
  await writeFile(join(d, 'broken.mjs'), await readFile(resolve('bin/logiparity.js'), 'utf8'));
  const child = spawn(process.execPath, [join(d, 'broken.mjs')], { cwd: d, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (value: Buffer) => {
    stderr += value.toString();
  });
  const [code] = await once(child, 'exit');
  expect(code).toBe(2);
  expect(stderr).toContain('LogiParity startup error:');
  expect(stderr).toContain('@logiparity/cli');
});
it.each(['ab:cd{ef', 'x;y`z^'])('redacts percent-serialized REST secrets in every report: %s', async (secret) => {
  const d = await dir();
  const server = await startServer((_, res) => {
    res.statusCode = 404;
    res.end('{}');
  });
  try {
    await writeFile(
      join(d, 'config.yaml'),
      JSON.stringify({
        version: 1,
        entities: [
          {
            name: 'load',
            key: 'id',
            sources: {
              api: {
                type: 'rest',
                baseUrl: server.url,
                path: '/nope/${STAGING_API_SECRET}/orders',
                fields: { id: '$.id' },
                retries: 0,
              },
              file: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } },
            },
          },
        ],
        report: { dir: 'report', outputs: ['console', 'json', 'html', 'markdown', 'junit'] },
      }),
    );
    const result = await run(['check', '--config', 'config.yaml'], d, { STAGING_API_SECRET: secret });
    expect(result.code).toBe(2);
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(result.stdout).toContain('REDACTED');
    const path = new URL(server.url);
    path.pathname = '/nope/' + secret + '/orders';
    const encoded = path.pathname.slice(6, -7);
    for (const file of ['report.json', 'report.html', 'report.md', 'junit.xml']) {
      const text = await readFile(join(d, 'report', file), 'utf8');
      expect(text).not.toContain(secret);
      expect(text).not.toContain(encoded);
    }
  } finally {
    await server.close();
  }
});
it('warns about minimal scenario invariants in every scenario report and omits parity lint hints', async () => {
  const d = await dir();
  const server = await startServer((_, res) => res.end('{"data":[{"id":"L1"}]}'));
  try {
    await writeFile(
      join(d, 'scenario.yaml'),
      JSON.stringify({
        version: 1,
        name: 'minimal',
        target: 'test',
        events: [{ step: 1, type: 'http' }],
        invariants: ['no_order_lost'],
      }),
    );
    const target = {
      version: 1,
      name: 'test',
      environment: 'test',
      allowMutations: true,
      baseUrl: server.url,
      events: { http: { method: 'POST', path: '/event' } },
      state: { orders: { type: 'rest', baseUrl: server.url, path: '/', fields: { id: '$.id' } } },
    };
    await writeFile(join(d, 'target.yaml'), JSON.stringify(target));
    const result = await run(
      ['scenario', 'run', 'scenario.yaml', '--target', 'target.yaml', '--report-dir', 'report'],
      d,
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toContain('cannot detect a replan that never ran');
    for (const file of ['scenario.json', 'scenario.html', 'scenario.md', 'junit.xml'])
      expect(await readFile(join(d, 'report', file), 'utf8')).toContain('cannot detect a replan that never ran');
    await writeFile(
      join(d, 'target.yaml'),
      JSON.stringify({
        ...target,
        baseUrl: '${M91_MISSING_URL}',
        headersEnv: { Authorization: { env: 'M91_MISSING_TOKEN', prefix: 'Bearer ' } },
      }),
    );
    const missing = await run(['scenario', 'run', 'scenario.yaml', '--target', 'target.yaml'], d, {
      M91_MISSING_URL: '',
      M91_MISSING_TOKEN: '',
    });
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain('M91_MISSING_URL');
    expect(missing.stderr).toContain('M91_MISSING_TOKEN');
    expect(missing.stderr).not.toContain('--allow-missing-env');
  } finally {
    await server.close();
  }
});
