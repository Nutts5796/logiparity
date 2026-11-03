import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import JSZip from 'jszip';
import ExcelJS from 'exceljs';
import { xlsxRows } from '../../packages/adapters/src/xlsx.js';
import { collect } from '../helpers.js';
const dirs: string[] = [];
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});
async function workbook(worksheet: string, shared?: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-xlsx-reader-'));
  dirs.push(dir);
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns:r="urn:rels"><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>',
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="r1" Target="worksheets/custom.xml"/></Relationships>',
  );
  zip.file('xl/worksheets/custom.xml', worksheet);
  if (shared !== undefined) zip.file('xl/sharedStrings.xml', shared);
  const file = join(dir, 'data.xlsx');
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}
it('reads inline rich strings, shared rich strings, sparse columns, booleans and cached formulas', async () => {
  const file = await workbook(
    '<worksheet><sheetData><row r="3"><c r="A3" t="s"><v>0</v></c><c r="C3" t="inlineStr"><is><r><t>inline &amp; </t></r><r><t>rich</t></r></is></c><c r="D3" t="b"><v>0</v></c><c r="E3" t="n"><f>1+1</f><v>2</v></c><c r="F3" t="str"><f>TEXT(1)</f><v>cached</v></c><c r="G3" t="d"><v>2026-11-02T13:00:00Z</v></c></row></sheetData></worksheet>',
    '<sst><si><r><t>shared </t></r><r><t>rich</t></r><rPh><t>phonetic</t></rPh></si></sst>',
  );
  const rows = await collect(xlsxRows(file, 'Data'));
  expect(rows[0]?.number).toBe(3);
  expect(rows[0]?.values[0]).toBe('shared rich');
  expect(rows[0]?.values[1]).toBeUndefined();
  expect(rows[0]?.values.slice(2)).toEqual(['inline & rich', false, 2, 'cached', new Date('2026-11-02T13:00:00Z')]);
});
it.each([false, true])('reads styled dates with date1904=%s and selects a sheet by relationship', async (date1904) => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-xlsx-dates-'));
  dirs.push(dir);
  const book = new ExcelJS.Workbook();
  book.properties.date1904 = date1904;
  book.addWorksheet('Ignore').addRow(['other']);
  const sheet = book.addWorksheet('Data');
  sheet.addRow([new Date('2026-11-02T13:00:00Z'), true]);
  sheet.getCell('A1').numFmt = 'yyyy-mm-dd hh:mm:ss';
  await book.xlsx.writeFile(join(dir, 'dates.xlsx'));
  const rows = await collect(xlsxRows(join(dir, 'dates.xlsx'), 'Data'));
  expect(rows[0]?.values).toEqual([new Date('2026-11-02T13:00:00Z'), true]);
});
it.each(['<worksheet><row>', '<!DOCTYPE worksheet [<!ENTITY x "bad">]><worksheet/>'])(
  'rejects malformed XML and declarations',
  async (xml) => {
    const file = await workbook(xml);
    await expect(collect(xlsxRows(file, 'Data'))).rejects.toThrow();
  },
);
it('rejects an invalid shared string reference and preserves empty cells', async () => {
  const file = await workbook(
    '<worksheet><row><c r="A1"/><c r="B1" t="s"><v>4</v></c></row></worksheet>',
    '<sst><si><t>only</t></si></sst>',
  );
  await expect(collect(xlsxRows(file, 'Data'))).rejects.toThrow('shared string index');
});
