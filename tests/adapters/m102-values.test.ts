import { checkedReport } from '../../scripts/validate-report.mjs';
import { expect, it } from 'vitest';
import JSZip from 'jszip';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adapters } from '@logiparity/adapters';
import { compareEntities, entitySchema } from '@logiparity/core';
import { startServer } from '../helpers.js';
async function workbook(file: string, rows: string) {
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="urn:r"><sheets><sheet name="S" r:id="s"/></sheets></workbook>');
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="s" Target="worksheets/sheet1.xml"/></Relationships>',
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>id</t></is></c><c r="B1" t="inlineStr"><is><t>at</t></is></c></row>${rows}</sheetData></worksheet>`,
  );
  await writeFile(file, await zip.generateAsync({ type: 'nodebuffer' }));
}
it('honors explicit offsets in XLSX date cells and applies the source zone only to naive cells (raj n1)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-dates-'));
  try {
    await writeFile(
      join(dir, 'a.csv'),
      'id,at\nO1,2026-11-03T15:00:00Z\nO2,2026-11-03T15:00:00Z\nO3,2026-11-03T15:00:00Z\n',
    );
    await workbook(
      join(dir, 'b.xlsx'),
      ['2026-11-03T15:00:00Z', '2026-11-03T17:00:00+02:00', '2026-11-03T09:00:00']
        .map(
          (at, i) =>
            `<row r="${i + 2}"><c r="A${i + 2}" t="inlineStr"><is><t>O${i + 1}</t></is></c><c r="B${i + 2}" t="d"><v>${at}</v></c></row>`,
        )
        .join(''),
    );
    const entity = entitySchema.parse({
      name: 'order',
      key: 'id',
      sources: {
        a: { type: 'csv', file: 'a.csv', fields: { id: 'id', at: 'at' } },
        b: { type: 'xlsx', file: 'b.xlsx', sheet: 'S', fields: { id: 'id', at: 'at' } },
      },
      compare: { at: { type: 'datetime', sourceTimezones: { b: 'America/Chicago' } } },
    });
    const report = await checkedReport(
      compareEntities([entity], (_name, config) => adapters.read(config, { baseDir: dir, env: {} })),
    );
    expect(report.findings).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('compares an untyped column across CSV, XLSX and REST without false differences (raj k2)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m102-untyped-'));
  const server = await startServer((_req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ data: [{ id: 'O1', at: 5 }] }));
  });
  try {
    await writeFile(join(dir, 'a.csv'), 'id,at\nO1,5\n');
    await workbook(
      join(dir, 'b.xlsx'),
      '<row r="2"><c r="A2" t="inlineStr"><is><t>O1</t></is></c><c r="B2"><v>5</v></c></row>',
    );
    const entity = entitySchema.parse({
      name: 'order',
      key: 'id',
      sources: {
        csv: { type: 'csv', file: 'a.csv', fields: { id: 'id', at: 'at' } },
        xlsx: { type: 'xlsx', file: 'b.xlsx', sheet: 'S', fields: { id: 'id', at: 'at' } },
        api: { type: 'rest', baseUrl: server.url, path: '/', fields: { id: '$.id', at: '$.at' } },
      },
    });
    expect(
      (
        await checkedReport(
          compareEntities([entity], (_name, config) => adapters.read(config, { baseDir: dir, env: {} })),
        )
      ).findings,
    ).toEqual([]);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
