import type { Readable } from 'node:stream';
import ExcelJS from '@logiparity/exceljs';
import unzipper from 'unzipper';

// Narrow bridge to ExcelJS 4.4.0 internals. Its stock ZIP iterator can lose
// workbook metadata (upstream #3064). Parse metadata first, then stream rows
// from central-directory entries. No workbook-sized buffer or node_modules patch.
interface ExcelReaderParts {
  _parseRels(stream: Readable): Promise<void>;
  _parseWorkbook(stream: Readable): Promise<void>;
  _parseStyles(stream: Readable): Promise<void>;
  _parseSharedStrings(stream: Readable): AsyncIterable<unknown>;
  _parseWorksheet(stream: AsyncIterable<Buffer>, id: string): Iterable<{ value: ExcelJS.stream.xlsx.WorksheetReader }>;
}

export async function* xlsxRows(file: string, sheetName: string): AsyncIterable<ExcelJS.Row> {
  const archive = await unzipper.Open.file(file);
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(file, { sharedStrings: 'cache', styles: 'cache', worksheets: 'emit' }) as unknown as ExcelReaderParts;
  const entry = (path: string) => archive.files.find((part) => part.path === path);
  const workbook = entry('xl/workbook.xml');
  const relationships = entry('xl/_rels/workbook.xml.rels');
  if (!workbook || !relationships) throw new Error('XLSX workbook metadata is missing; save a valid unencrypted .xlsx file.');
  const consume = async (part: unzipper.File, parse: (stream: Readable) => Promise<void>) => {
    const stream = part.stream();
    try { await parse(stream); } finally { stream.destroy(); }
  };
  await consume(workbook, (stream) => reader._parseWorkbook(stream));
  await consume(relationships, (stream) => reader._parseRels(stream));
  const styles = entry('xl/styles.xml');
  if (styles) await consume(styles, (stream) => reader._parseStyles(stream));
  const shared = entry('xl/sharedStrings.xml');
  if (shared) await consume(shared, async (stream) => { for await (const item of reader._parseSharedStrings(stream)) void item; });
  for (const part of archive.files) {
    const id = part.path.match(/^xl\/worksheets\/sheet(\d+)\.xml$/)?.[1];
    if (!id) continue;
    const stream = part.stream();
    try {
      for (const { value: sheet } of reader._parseWorksheet(stream, id)) {
        // ExcelJS's runtime name is omitted from its WorksheetReader declaration.
        if ((sheet as typeof sheet & { name?: string }).name === sheetName) {
          yield* sheet;
          return;
        }
      }
    } finally { stream.destroy(); }
  }
}
