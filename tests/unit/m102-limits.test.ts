import { expect, it } from 'vitest';
import { compareEntities, entitySchema, reportExitCode, atomicReportFile } from '@logiparity/core';
import { mkdtemp, readFile, rm, stat, writeFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
function entity() {
  const source = { type: 'csv', file: 'unused', fields: { id: 'id' } };
  return entitySchema.parse({ name: 'order', key: 'id', sources: { a: source, b: source } });
}
it('returns a report for 200,000 duplicate rows without spreading them as function arguments (sam)', async () => {
  const config = entity();
  for (const source of Object.values(config.sources)) Object.assign(source, { maxRows: 250001 });
  const report = await compareEntities(
    [config],
    async function* (name) {
      yield { id: 'O1' };
      if (name === 'b') for (let i = 0; i < 200000; i++) yield { id: 'O1' };
    },
    {},
    { maxFindings: 250001 },
  );
  expect(report.findings).toHaveLength(200000);
  expect(report.findings.every((f) => f.type === 'duplicate_key')).toBe(true);
});
it('stops a source at its row limit and truncates excessive findings with a runtime notice (sam)', async () => {
  const config = entity();
  for (const source of Object.values(config.sources)) Object.assign(source, { maxRows: 3 });
  const rows = async function* () {
    for (let i = 0; i < 10; i++) yield { id: String(i) };
  };
  const rowReport = await compareEntities([config], rows);
  expect(reportExitCode(rowReport)).toBe(2);
  expect(rowReport.findings[0]?.message).toContain('maxRows');
  for (const source of Object.values(config.sources)) Object.assign(source, { maxRows: 100 });
  const report = await compareEntities(
    [config],
    async function* (name) {
      yield { id: 'O1' };
      if (name === 'b') for (let i = 0; i < 30; i++) yield { id: 'O1' };
    },
    {},
    { maxFindings: 5 },
  );
  expect(report.truncated).toBe(true);
  expect(report.findings).toHaveLength(6);
  expect(reportExitCode(report)).toBe(2);
  expect(report.findings.find((f) => f.type === 'source_error')?.message).toContain('maxFindings');
});
it('caps a many-row JSON response before parsing in a 192 MiB heap subprocess (sam /uobjs)', async () => {
  const script = `import {createJiti} from 'jiti';
 const jiti=createJiti(import.meta.url,{alias:{'@logiparity/core':${JSON.stringify(resolve('packages/core/src/index.ts'))}}});
 const {sourceSchema}=await jiti.import(${JSON.stringify(resolve('packages/core/src/index.ts'))});
 const {readRest}=await jiti.import(${JSON.stringify(resolve('packages/adapters/src/rest.ts'))});
 let sent=0;
 globalThis.fetch=async()=>new Response(new ReadableStream({start(c){c.enqueue(Buffer.from('{"data":['));},pull(c){if(sent>=3000000){c.enqueue(Buffer.from('{"id":"last"}]}'));c.close();return;}let chunk='';for(let n=0;n<5000;n++,sent++)chunk+='{"id":"S'+sent+'"},';c.enqueue(Buffer.from(chunk));}}));
 const config=sourceSchema.parse({type:'rest',baseUrl:'http://fixture.test',path:'/',fields:{id:'$.id'}});
 try{for await(const row of readRest(config,{baseDir:'.',env:{}})){void row;}throw Error('Missing row limit');}
 catch(error){if(!error.message.includes('maxRows'))throw error;console.log(JSON.stringify({sent,rss:process.memoryUsage().rss,message:error.message}));}`;
  const result = await promisify(execFile)(
    process.execPath,
    ['--max-old-space-size=192', '--input-type=module', '-e', script],
    { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
  );
  const evidence = JSON.parse(result.stdout);
  expect(evidence.sent).toBeLessThan(150000);
  expect(evidence.rss).toBeLessThan(384 * 1024 * 1024);
});
it('writes requested file permissions and removes incomplete streamed files on quota failure (sam)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-atomic-'));
  try {
    const file = join(dir, 'report.md');
    await atomicReportFile(file, 'safe', { mode: 0o640 });
    expect((await stat(file)).mode & 0o777).toBe(0o640);
    await writeFile(join(dir, 'artifact.csv'), 'original');
    await expect(
      atomicReportFile(
        join(dir, 'artifact.csv'),
        (async function* () {
          yield Buffer.alloc(500);
          yield Buffer.alloc(600);
        })(),
        { maxBytes: 1024 },
      ),
    ).rejects.toThrow('maxBytes');
    expect(await readFile(join(dir, 'artifact.csv'), 'utf8')).toBe('original');
    expect((await readdir(dir)).some((name) => name.endsWith('.tmp'))).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
