import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';
import {
  withSourceRow,
  fieldPath,
  type FieldMapping,
  type AdapterContext,
  type DataRow,
  type FileConfig,
} from '@logiparity/core';
import { xlsxRows } from './xlsx.js';

function headerIndexes(headers: unknown[], fields: Record<string, FieldMapping>): [string, number][] {
  const names = headers.map((v) => String(v ?? '').trim());
  const nonempty = names.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length)
    throw new Error('Duplicate column headers; give each column a unique name.');
  return Object.entries(fields).map(([field, mapping]) => {
    const column = fieldPath(mapping);
    const index = names.indexOf(column);
    if (index < 0)
      throw new Error(
        `Column "${column}" for field ${field} is missing. Available headers: ${names.map((name) => JSON.stringify(name)).join(', ') || '(none)'}. Correct fields or headerRow.`,
      );
    return [field, index];
  });
}

function excelValue(value: unknown): unknown {
  if (value instanceof Error) throw value;
  return value;
}

export async function* readFileSource(config: FileConfig, context: AdapterContext): AsyncIterable<DataRow> {
  const file = resolve(context.baseDir, config.file);
  let location = `header row ${config.headerRow}`;
  try {
    await access(file);
    let indexes: [string, number][] | undefined;
    if (config.type === 'csv') {
      const input = createReadStream(file, { encoding: config.encoding });
      const parser = parse({
        delimiter: config.delimiter,
        quote: config.quote,
        bom: true,
        skip_empty_lines: true,
        relax_column_count: false,
        info: true,
      });
      input.on('error', (error) => parser.destroy(error));
      input.pipe(parser);
      let recordNumber = 0;
      try {
        for await (const raw of parser as AsyncIterable<{ record: unknown[]; info: { lines: number } }>) {
          recordNumber++;
          location = `line ${raw.info.lines}`;
          if (recordNumber < config.headerRow) continue;
          if (!indexes) {
            indexes = headerIndexes(raw.record, config.fields);
            continue;
          }
          yield withSourceRow(
            Object.fromEntries(indexes.map(([field, index]) => [field, raw.record[index]])),
            recordNumber,
          );
        }
      } finally {
        input.destroy();
        parser.destroy();
      }
    } else {
      for await (const row of xlsxRows(file, config.sheet)) {
        location = `sheet ${config.sheet}, row ${row.number}`;
        if (row.number < config.headerRow) continue;
        if (!indexes) {
          indexes = headerIndexes(
            Array.from({ length: row.values.length }, (_, i) => excelValue(row.values[i])),
            config.fields,
          );
          continue;
        }
        yield withSourceRow(
          Object.fromEntries(indexes.map(([field, index]) => [field, row.values[index] ?? null])),
          row.number,
        );
      }
    }
    if (!indexes)
      throw new Error(
        `Header was not found${config.type === 'xlsx' ? ` in sheet "${config.sheet}"` : ''}; check sheet, headerRow and file contents.`,
      );
  } catch (error) {
    throw new Error(`${file} (${location}): ${error instanceof Error ? error.message : String(error)}`);
  }
}
