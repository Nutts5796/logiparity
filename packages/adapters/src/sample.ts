import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { extname, resolve } from 'node:path';
import { parse } from 'csv-parse';
import { xlsxRows } from './xlsx.js';
import { selectJson } from './jsonpath.js';

export interface SourceSample {
  file: string;
  kind: 'csv' | 'xlsx' | 'json';
  headers: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  sheet?: string;
  items?: string;
  delimiter?: string;
}
export interface SampleOptions {
  limit?: number;
  sheet?: string;
  items?: string;
}
const maxBytes = 8 * 1024 * 1024;
function headersFor(values: unknown[]): string[] {
  const headers = values.map((value) => String(value ?? '').trim());
  if (!headers.length || headers.some((h) => !h) || new Set(headers).size !== headers.length)
    throw new Error('Sample headers must be nonempty and unique; resolve blank or duplicated headers explicitly.');
  if (headers.length > 200) throw new Error('A setup sample supports at most 200 columns.');
  return headers;
}
function jsonKey(key: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/.test(key)) return '.' + key;
  if (!key.includes('"')) return '["' + key + '"]';
  if (!key.includes("'")) return "['" + key + "']";
  throw new Error(
    'A JSON property contains both quote styles; rename it in the saved sample before mapping this JSONPath.',
  );
}
function flatten(value: Record<string, unknown>, prefix = '$', depth = 0): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const path = prefix + jsonKey(key);
    if (item && typeof item === 'object' && !Array.isArray(item) && depth < 8 && Object.keys(item).length)
      Object.assign(row, flatten(item as Record<string, unknown>, path, depth + 1));
    else row[path] = item;
  }
  return row;
}
export async function readSample(file: string, options: SampleOptions = {}): Promise<SourceSample> {
  file = resolve(file);
  const limit = options.limit ?? 200;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
    throw new Error('sample-rows must be an integer from 1 to 1,000.');
  if ((await stat(file)).size > maxBytes)
    throw new Error('Setup samples must be at most 8 MiB; save a smaller local sample.');
  const extension = extname(file).toLowerCase(),
    rows: Record<string, unknown>[] = [];
  let headers: string[] | undefined,
    truncated = false;
  if (extension === '.json') {
    const chunks: Buffer[] = [];
    let bytes = 0;
    for await (const chunk of createReadStream(file)) {
      bytes += chunk.length;
      if (bytes > maxBytes) throw new Error('Setup sample exceeds 8 MiB.');
      chunks.push(chunk);
    }
    const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const items =
      options.items ??
      (Array.isArray(body)
        ? '$[*]'
        : body && typeof body === 'object' && Array.isArray(Reflect.get(body, 'data'))
          ? '$.data[*]'
          : undefined);
    if (!items)
      throw new Error(
        'JSON sample is not an array or {data: [...]} response; specify --items source=$.records[*] (or $ for one record).',
      );
    const selected = selectJson(body, items),
      records = selected.length === 1 && Array.isArray(selected[0]) ? (selected[0] as unknown[]) : selected;
    truncated = records.length > limit;
    for (const record of records.slice(0, limit)) {
      if (!record || typeof record !== 'object' || Array.isArray(record))
        throw new Error('Each selected JSON sample record must be an object; correct --items.');
      rows.push(flatten(record as Record<string, unknown>));
    }
    headers = headersFor([...new Set(rows.flatMap((row) => Object.keys(row)))]);
    return { file, kind: 'json', items, headers, rows, truncated };
  }
  if (extension !== '.csv' && extension !== '.tsv' && extension !== '.xlsx')
    throw new Error('Setup samples support CSV, TSV, XLSX and saved JSON files; no URL is fetched.');
  if (extension === '.xlsx' && !options.sheet)
    throw new Error('An XLSX sample needs --sheet source=SheetName; the sheet is never guessed.');
  const delimiter = extension === '.tsv' ? '\t' : ',';
  const csvInput = extension === '.xlsx' ? undefined : createReadStream(file);
  const parser = csvInput ? parse({ bom: true, delimiter, skip_empty_lines: true }) : undefined;
  if (csvInput && parser) csvInput.on('error', (error) => parser.destroy(error));
  const input = csvInput && parser ? csvInput.pipe(parser) : xlsxRows(file, options.sheet!);
  try {
    for await (const record of input) {
      const values: unknown[] =
        extension === '.xlsx' ? (record as { values: unknown[] }).values : (record as unknown[]);
      if (!headers) {
        headers = headersFor(values);
        continue;
      }
      if (rows.length === limit) {
        truncated = true;
        break;
      }
      if (extension !== '.xlsx' && values.length !== headers.length)
        throw new Error('Sample row has a different number of columns from its header.');
      rows.push(Object.fromEntries(headers.map((h, index) => [h, values[index] ?? null])));
    }
  } finally {
    parser?.destroy();
    csvInput?.destroy();
  }
  if (!headers) throw new Error('Sample has no header row.');
  return {
    file,
    kind: extension === '.xlsx' ? 'xlsx' : 'csv',
    headers,
    rows,
    truncated,
    ...(extension === '.xlsx' ? { sheet: options.sheet! } : { delimiter }),
  };
}
