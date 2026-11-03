import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { sourceSchema, type FileConfig } from '@logiparity/core';
import { readFileSource } from '@logiparity/adapters';
import { collect } from '../helpers.js';

const temporary: string[] = [];
async function directory() {
  const d = await mkdtemp(join(tmpdir(), 'logiparity-file-'));
  temporary.push(d);
  return d;
}
afterEach(async () => {
  await Promise.all(temporary.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
function config(extra: Record<string, unknown>): FileConfig {
  const result = sourceSchema.parse({
    type: 'csv',
    file: 'records.csv',
    fields: { id: 'ID', value: 'Value' },
    ...extra,
  });
  if (result.type !== 'csv' && result.type !== 'xlsx') throw new Error('Invalid file fixture.');
  return result;
}

describe('streaming file adapters', () => {
  it('reads custom CSV delimiters, quoted multiline fields and decimal text', async () => {
    const rows = await collect(
      readFileSource(
        config({
          file: 'tests/fixtures/shipments.csv',
          delimiter: ';',
          fields: { id: 'Shipment ID', value: { path: 'Driver payout', label: 'Driver payout' }, note: 'Note' },
        }),
        { baseDir: resolve('.'), env: {} },
      ),
    );
    expect(rows).toEqual([
      { id: 'S000001', value: '1,01', note: 'quoted; delimiter' },
      { id: 'S000002', value: '2,05', note: 'line one\nline two' },
    ]);
  });
  it('handles UTF-16 BOM, header rows and configured quotes', async () => {
    const baseDir = await directory();
    await writeFile(join(baseDir, 'records.csv'), "\ufeffnote;note\nID;Value\nA;'two; parts'\n", 'utf16le');
    expect(
      await collect(
        readFileSource(config({ encoding: 'utf16le', delimiter: ';', quote: "'", headerRow: 2 }), { baseDir, env: {} }),
      ),
    ).toEqual([{ id: 'A', value: 'two; parts' }]);
  });
  it.each([
    ['', 'Header was not found'],
    ['ID,ID\na,b', 'Duplicate'],
    ['ID,Other\na,b', 'Column "Value"'],
    ['ID,Value\na,"unfinished', 'Quote Not Closed'],
  ])('reports malformed CSV with file context: %s', async (content, error) => {
    const baseDir = await directory();
    await writeFile(join(baseDir, 'records.csv'), content);
    await expect(collect(readFileSource(config({}), { baseDir, env: {} }))).rejects.toThrow(error);
  });
  it('reports missing files with the absolute path', async () => {
    const baseDir = await directory();
    await expect(collect(readFileSource(config({}), { baseDir, env: {} }))).rejects.toThrow(
      join(baseDir, 'records.csv'),
    );
  });
  it('reads a named XLSX sheet and scalar cell types after a header row', async () => {
    const baseDir = await directory();
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet('Ignore').addRow(['Other']);
    const sheet = workbook.addWorksheet('Shipments');
    sheet.addRow(['note']);
    sheet.addRow(['ID', 'Value', 'Date', 'Rich', 'Formula']);
    sheet.addRow([
      'S1',
      '1.01',
      new Date('2026-11-02T13:00:00Z'),
      { richText: [{ text: 'rich' }, { text: ' text' }] },
      { formula: '1+1', result: 2 },
    ]);
    await workbook.xlsx.writeFile(join(baseDir, 'test.xlsx'));
    const rows = await collect(
      readFileSource(
        config({
          type: 'xlsx',
          file: 'test.xlsx',
          sheet: 'Shipments',
          headerRow: 2,
          fields: {
            id: 'ID',
            value: { path: 'Value', label: 'Driver payout' },
            date: 'Date',
            rich: 'Rich',
            formula: 'Formula',
          },
        }),
        { baseDir, env: {} },
      ),
    );
    expect(rows).toEqual([
      { id: 'S1', value: '1.01', date: new Date('2026-11-02T13:00:00Z'), rich: 'rich text', formula: 2 },
    ]);
    await expect(
      collect(readFileSource(config({ type: 'xlsx', file: 'test.xlsx', sheet: 'Missing' }), { baseDir, env: {} })),
    ).rejects.toThrow('sheet "Missing"');
  });
  it('rejects XLSX formulas without cached results and invalid workbooks', async () => {
    const baseDir = await directory();
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Data');
    sheet.addRow(['ID', 'Value']);
    sheet.addRow(['A', { formula: '1+1' }]);
    await workbook.xlsx.writeFile(join(baseDir, 'test.xlsx'));
    const badCells = await collect(
      readFileSource(config({ type: 'xlsx', file: 'test.xlsx', sheet: 'Data' }), { baseDir, env: {} }),
    );
    expect(badCells[0]?.value).toBeInstanceOf(Error);
    expect(String(badCells[0]?.value)).toContain('cached result');
    await writeFile(join(baseDir, 'bad.xlsx'), 'bad zip');
    await expect(
      collect(readFileSource(config({ type: 'xlsx', file: 'bad.xlsx', sheet: 'Data' }), { baseDir, env: {} })),
    ).rejects.toThrow('bad.xlsx');
  });
  it('repeatedly reads workbooks with several sheets preceding their metadata (ExcelJS #3064)', async () => {
    const baseDir = await directory();
    const workbook = new ExcelJS.Workbook();
    for (let i = 0; i < 5; i++) {
      const sheet = workbook.addWorksheet(`Sheet${i}`);
      sheet.addRow(['ID', 'Value']);
      sheet.addRow([`A${i}`, '1.01']);
    }
    await workbook.xlsx.writeFile(join(baseDir, 'test.xlsx'));
    for (let pass = 0; pass < 10; pass++)
      for (let i = 0; i < 5; i++) {
        expect(
          await collect(
            readFileSource(config({ type: 'xlsx', file: 'test.xlsx', sheet: `Sheet${i}` }), { baseDir, env: {} }),
          ),
        ).toEqual([{ id: `A${i}`, value: '1.01' }]);
      }
  });
  it('streams 100,000 CSV and XLSX rows', async () => {
    const baseDir = await directory();
    await writeFile(
      join(baseDir, 'records.csv'),
      'ID,Value\n' + Array.from({ length: 100000 }, (_, i) => `${i},1.01`).join('\n'),
    );
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: join(baseDir, 'test.xlsx'),
      useSharedStrings: false,
    });
    const sheet = workbook.addWorksheet('Data');
    sheet.addRow(['ID', 'Value']).commit();
    for (let i = 0; i < 100000; i++) sheet.addRow([String(i), '1.01']).commit();
    sheet.commit();
    await workbook.commit();
    for (const source of [config({}), config({ type: 'xlsx', file: 'test.xlsx', sheet: 'Data' })]) {
      let count = 0;
      for await (const row of readFileSource(source, { baseDir, env: {} })) {
        if (count === 0 || count === 99999) expect(row).toEqual({ id: String(count), value: '1.01' });
        count++;
      }
      expect(count).toBe(100000);
    }
  });
});
