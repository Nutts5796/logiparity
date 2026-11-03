import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'vitest';
import { startServer } from '../helpers.js';
const exec = promisify(execFile),
  cli = resolve('packages/cli/dist/main.js');
it.each(['check', 'validate', 'init', 'scenario', 'ai', 'install-browser'])(
  'prints specific %s help without requiring configuration',
  async (command) => {
    const result = await exec(process.execPath, [cli, command, '--help']);
    expect(result.stdout).toContain(`Usage: logiparity ${command}`);
    expect(result.stderr).toBe('');
  },
);
it('validates a scenario without any HTTP request and prints its short-secret warning once on run', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-command-'));
  let requests = 0;
  const server = await startServer((_request, response) => {
    requests++;
    response.end('{}');
  });
  try {
    await writeFile(join(dir, 'orders.csv'), 'ID,Status\nS1,in_transit\n');
    await writeFile(join(dir, 'assignments.csv'), 'ID,Order,Driver\nA1,S1,D1\n');
    const target = {
      version: 1,
      name: 'staging',
      environment: 'staging',
      allowMutations: true,
      allowedHosts: ['127.0.0.1'],
      baseUrl: server.url + '/api/',
      headersEnv: { Authorization: { env: 'TOKEN', prefix: 'Bearer ' } },
      events: { http: { method: 'POST', path: '/event' } },
      state: {
        orders: { type: 'csv', file: './orders.csv', fields: { id: 'ID', status: 'Status' } },
        assignments: {
          type: 'csv',
          file: './assignments.csv',
          fields: { id: 'ID', order_id: 'Order', driver_id: 'Driver' },
        },
      },
    };
    await writeFile(join(dir, 'target.yaml'), JSON.stringify(target));
    await writeFile(
      join(dir, 'scenario.yaml'),
      JSON.stringify({
        version: 1,
        name: 'Safe preflight',
        target: 'staging',
        events: [{ step: 1, type: 'http', params: {} }],
        invariants: ['no_order_lost', 'single_assignment'],
      }),
    );
    const options = { cwd: dir, env: { ...process.env, TOKEN: 'config' } };
    const valid = await exec(
      process.execPath,
      [cli, 'scenario', 'validate', 'scenario.yaml', '--target', 'target.yaml'],
      options,
    );
    expect(valid.stdout).toContain('no mutations');
    expect(requests).toBe(0);
    const result = await exec(
      process.execPath,
      [cli, 'scenario', 'run', 'scenario.yaml', '--target', 'target.yaml'],
      options,
    );
    expect(requests).toBe(1);
    expect((result.stdout + result.stderr).match(/Environment variable TOKEN/g)).toHaveLength(1);
    expect(result.stdout).not.toContain('no_order_lost: no_order_lost:');
    await expect(exec(process.execPath, [cli, 'validate', '--config', 'target.yaml'], options)).rejects.toMatchObject({
      stderr: expect.stringContaining('scenario validate'),
    });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
