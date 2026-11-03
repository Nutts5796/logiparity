import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { expect, it } from 'vitest';
import type { File } from 'unzipper';
import { xmlEvents } from '../../packages/adapters/src/xlsx-xml.js';
import { SharedStrings } from '../../packages/adapters/src/xlsx-strings.js';
import { xlsxLimits } from '../../packages/adapters/src/xlsx-limits.js';
import { collect } from '../helpers.js';
function entry(prefix: string, count: number, chunkSize = 8192) {
  let read = 0;
  const stream = Readable.from(
    (async function* () {
      yield Buffer.from(prefix);
      for (let i = 0; i < count; i++) {
        read++;
        yield Buffer.alloc(chunkSize, 65);
      }
      yield Buffer.from('</t></c></row></worksheet>');
    })(),
  );
  return {
    file: { compressedSize: 64 * 1024 * 1024, uncompressedSize: 0, stream: () => stream } as unknown as File,
    read: () => read,
  };
}
it('stops oversized cell text before SAX constructs a large string', async () => {
  const input = entry('<worksheet><row><c><t>', 40000);
  await expect(collect(xmlEvents(input.file))).rejects.toThrow('token limit');
  expect(input.read()).toBeLessThan(40);
});
it('caps attributes while they are still arriving', async () => {
  const input = entry('<worksheet value="', 40000);
  await expect(collect(xmlEvents(input.file))).rejects.toThrow('attribute');
  expect(input.read()).toBeLessThan(10);
});
it('rejects zip bomb declarations without opening their streams', async () => {
  let opened = false;
  const file = {
    uncompressedSize: 1800 * 1024 * 1024,
    compressedSize: 1800 * 1024,
    stream: () => {
      opened = true;
      return Readable.from([]);
    },
  } as unknown as File;
  await expect(collect(xmlEvents(file))).rejects.toThrow('quota');
  expect(opened).toBe(false);
});
it('caps shared-string disk use including the offset index', async () => {
  const original = xlsxLimits.sharedBytes;
  const strings = await SharedStrings.create();
  try {
    xlsxLimits.sharedBytes = 1024;
    await strings.add('a'.repeat(900));
    await expect(strings.add('b'.repeat(200))).rejects.toThrow('disk quota');
  } finally {
    xlsxLimits.sharedBytes = original;
    await strings.close();
  }
});

it.each(['SIGINT', 'SIGTERM', 'SIGHUP'] as const)('removes owned temporary strings on %s', async (signal) => {
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-signal-'));
  const module = pathToFileURL(resolve('packages/adapters/src/xlsx-strings.ts')).href;
  const child = spawn(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import {createJiti} from "jiti"; const {SharedStrings}=await createJiti(import.meta.url).import(${JSON.stringify(module)}); const strings=await SharedStrings.create(); await strings.add('private synthetic fixture'); console.log('READY'); setInterval(()=>{},1000);`,
    ],
    { env: { ...process.env, TMPDIR: directory }, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  try {
    await new Promise<void>((accept, reject) => {
      const timer = setTimeout(() => reject(new Error('Child did not create XLSX strings')), 5000);
      child.stdout.on('data', (data) => {
        if (String(data).includes('READY')) {
          clearTimeout(timer);
          accept();
        }
      });
      let stderr = '';
      child.stderr.on('data', (data) => {
        stderr += String(data);
      });
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(new Error(`XLSX child exited ${code}: ${stderr}`));
      });
      child.once('error', reject);
    });
    expect((await readdir(directory)).length).toBeGreaterThan(0);
    const stopped = once(child, 'exit');
    child.kill(signal);
    await stopped;
    expect(await readdir(directory)).toEqual([]);
  } finally {
    if (child.exitCode === null) child.kill('SIGKILL');
    await rm(directory, { recursive: true, force: true });
  }
});
it('preserves the physical worksheet row when quota checks precede SAX parsing', async () => {
  const input = entry('<worksheet><row r="1"></row><row r="2"><c value="', 40000);
  await expect(collect(xmlEvents(input.file))).rejects.toMatchObject({ row: 2 });
});
