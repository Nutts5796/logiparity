import { parseCheckedJson } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { sourceSchema, sourceRow, sourceIssue, normalize, ruleSchema } from '@logiparity/core';
import { readFileSource } from '@logiparity/adapters';
import { collect } from '../helpers.js';
it.each(['d', 's'])(
  'interprets XLSX %s dates as wall clocks in the configured source zone (raj/t5,tom/t2)',
  async (kind) => {
    const source = sourceSchema.parse({
      type: 'xlsx',
      file: `tests/fixtures/m101/${kind}.xlsx`,
      sheet: 'S',
      fields: { id: 'id', at: 'at' },
    });
    if (source.type !== 'xlsx') throw new Error('fixture');
    const rows = await collect(readFileSource(source, { baseDir: resolve('.'), env: {} }));
    const rule = ruleSchema.parse({ type: 'datetime', sourceTimezones: { x: 'America/Chicago' } });
    expect(normalize(rows[0]?.at, rule, 'x')).toBe(Date.parse('2026-11-03T15:00:00Z'));
  },
);
it('skips formatted empty XLSX rows (raj/t5)', async () => {
  const source = sourceSchema.parse({
    type: 'xlsx',
    file: 'tests/fixtures/m101/x.xlsx',
    sheet: 'S',
    fields: { id: 'id', at: 'at' },
  });
  if (source.type !== 'xlsx') throw new Error('fixture');
  expect((await collect(readFileSource(source, { baseDir: resolve('.'), env: {} }))).length).toBe(2);
});
it('preserves physical CSV row numbers and isolates ragged rows (raj/t9)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m101-csv-'));
  try {
    await writeFile(join(dir, 'in.csv'), 'id,amount\nO1,1.00\n\nO2,2.00,extra\nO3,"multi\nline"\nO4,4.00\n');
    const source = sourceSchema.parse({ type: 'csv', file: 'in.csv', fields: { id: 'id', amount: 'amount' } });
    if (source.type !== 'csv') throw new Error('fixture');
    const rows = await collect(readFileSource(source, { baseDir: dir, env: {} }));
    expect(rows.map((row) => row[sourceRow])).toEqual([2, 4, 5, 7]);
    expect(rows[1]?.[sourceIssue]).toBeInstanceOf(Error);
    expect(rows[3]?.amount).toBe('4.00');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('bounds repeated shared strings before consumers retain an unsafe materialized sheet and cleans temporary storage (sam/amp)', async () => {
  const JSZip = (await import('jszip')).default;
  const { randomBytes } = await import('node:crypto');
  const { readdir } = await import('node:fs/promises');
  const { xlsxLimits } = await import('../../packages/adapters/src/xlsx-limits.js');
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m101-amplification-'));
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = dir;
  const limit = xlsxLimits.materializedBytes;
  try {
    const zip = new JSZip();
    zip.file('xl/workbook.xml', '<workbook xmlns:r="urn:r"><sheets><sheet name="S" r:id="s"/></sheets></workbook>');
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="s" Target="worksheets/sheet1.xml"/></Relationships>',
    );
    zip.file(
      'xl/sharedStrings.xml',
      '<sst>' +
        Array.from(
          { length: 3 },
          () =>
            '<si>' +
            Array.from({ length: 4 }, () => '<r><t>' + randomBytes(168750).toString('base64') + '</t></r>').join('') +
            '</si>',
        ).join('') +
        '</sst>',
    );
    zip.file(
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData>' +
        Array.from({ length: 90 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="s"><v>${i % 3}</v></c></row>`).join(
          '',
        ) +
        '</sheetData></worksheet>',
    );
    const file = join(dir, 'amp.xlsx');
    await writeFile(file, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
    xlsxLimits.materializedBytes = 4 * 1024 * 1024;
    const { xlsxRows } = await import('../../packages/adapters/src/xlsx.js');
    let materialized = 0;
    await expect(
      (async () => {
        for await (const row of xlsxRows(file, 'S')) materialized += String(row.values[0]).length;
      })(),
    ).rejects.toThrow(/materialized text.*row 5/);
    expect(materialized).toBeLessThan(4 * 1024 * 1024);
    expect((await readdir(dir)).filter((name) => name.startsWith('logiparity-xlsx-'))).toEqual([]);
  } finally {
    xlsxLimits.materializedBytes = limit;
    if (previousTmp === undefined) delete process.env.TMPDIR;
    else process.env.TMPDIR = previousTmp;
    await rm(dir, { recursive: true, force: true });
  }
});
it.each(['UTC', 'Asia/Tokyo'])('keeps XLSX wall-clock results independent of runner TZ=%s', async (TZ) => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const script = `import {createJiti} from 'jiti'; const jiti=createJiti(import.meta.url,{alias:{'@logiparity/core':${JSON.stringify(resolve('packages/core/src/index.ts'))}}}); const {xlsxRows}=await jiti.import(${JSON.stringify(resolve('packages/adapters/src/xlsx.ts'))}); const {normalize,ruleSchema}=await jiti.import(${JSON.stringify(resolve('packages/core/src/index.ts'))}); const rule=ruleSchema.parse({type:'datetime',sourceTimezones:{x:'America/Chicago'}}); let values=[]; for (const kind of ['d','s']) { for await(const row of xlsxRows(${JSON.stringify(resolve('tests/fixtures/m101'))}+'/'+kind+'.xlsx','S')) if(row.number===2) values.push(normalize(row.values[1],rule,'x')); } console.log(JSON.stringify(values));`;
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    env: { ...process.env, TZ },
  });
  expect(parseCheckedJson(stdout)).toEqual([Date.parse('2026-11-03T15:00:00Z'), Date.parse('2026-11-03T15:00:00Z')]);
});
