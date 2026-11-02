import type { Adapter, AdapterContext, DataRow, SourceConfig } from '@logiparity/core';
import { selectJson } from './jsonpath.js';
import { validateReadOnlySql } from './sql-guard.js';
import { readRest } from './rest.js';
import { readFileSource } from './file.js';
import { readUi } from './ui.js';
import { readSql } from './sql.js';

export const adapters: Adapter = {
  read(config: SourceConfig, context: AdapterContext): AsyncIterable<DataRow> {
    switch (config.type) {
      case 'rest': return readRest(config, context);
      case 'csv': case 'xlsx': return readFileSource(config, context);
      case 'ui': return readUi(config, context);
      case 'sql': return readSql(config, context);
    }
  },
};
export { readRest, readFileSource, readUi, readSql };
export { selectJson } from './jsonpath.js';

/** Validate extraction/query syntax without opening a source. */
export function validateSource(config: SourceConfig): void {
  if (config.type === 'sql') validateReadOnlySql(config.query);
  if (config.type !== 'rest') return;
  const p = config.pagination;
  const paths = [config.items, ...Object.values(config.fields), ...(p?.type === 'cursor' ? [p.next] : p?.type === 'page' || p?.type === 'offset' ? [p.totalPath, p.totalPagesPath, p.hasMorePath].filter((v): v is string => !!v) : [])];
  for (const path of paths) try { selectJson({}, path); } catch (error) { if (!(error instanceof Error) || !/property .* is missing|requires an array/.test(error.message)) throw error; }
}
