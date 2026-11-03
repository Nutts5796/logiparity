import { limitSourceRows } from './source-limits.js';
import { createReadStream } from 'node:fs';
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse } from 'csv-parse';
import {
  withSourceRow,
  sourceIssue,
  fieldPath,
  humanize,
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
        `Column "${column}" for field ${typeof mapping === 'object' && mapping.label ? mapping.label : humanize(field)} is missing. Available headers: ${names.map((name) => JSON.stringify(name)).join(', ') || '(none)'}. Correct fields or headerRow.`,
      );
    return [field, index];
  });
}

function excelValue(value: unknown): unknown {
  if (value instanceof Error) throw value;
  return value;
}

async function* fileRows(config: FileConfig, context: AdapterContext): AsyncIterable<DataRow> {
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
        relax_column_count: true,
        raw: true,
        info: true,
      });
      input.on('error', (error) => parser.destroy(error));
      input.pipe(parser);
      try {
        for await (const raw of parser as AsyncIterable<{
          record: unknown[];
          raw: string;
          info: { lines: number; error?: Error };
        }>) {
          const content = raw.raw.replace(/^(?:\r?\n)+/, '');
          const rowNumber = raw.info.lines - (content.match(/\n/g)?.length ?? 0) + (content.endsWith('\n') ? 1 : 0);
          location = `row ${rowNumber}`;
          if (rowNumber < config.headerRow) continue;
          if (!indexes) {
            indexes = headerIndexes(raw.record, config.fields);
            continue;
          }
          const row = withSourceRow(
            Object.fromEntries(indexes.map(([field, index]) => [field, raw.record[index]])),
            rowNumber,
          );
          if (raw.info.error)
            Object.defineProperty(row, sourceIssue, {
              value: new Error('CSV row has a different number of columns than its header; correct the row.'),
            });
          yield row;
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
        if (row.values.every((value) => value === null || value === undefined || value === '')) continue;
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
    if (error && typeof error === 'object' && Reflect.get(error, 'code') === 'ENOENT')
      throw new Error(`File not found: ${file}. Download the export first or fix path.`);
    const message = error instanceof Error ? error.message : String(error);
    if (config.type === 'xlsx' && /limit|quota|ratio/.test(message))
      throw new Error(`${file} (sheet ${config.sheet}): ${message}`);
    throw new Error(`${file} (${location}): ${message}`);
  }
}

export function readFileSource(config: FileConfig, context: AdapterContext): AsyncIterable<DataRow> {
  return limitSourceRows(fileRows(config, context), config, context);
}
