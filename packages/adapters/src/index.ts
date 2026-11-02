import type { Adapter, AdapterContext, DataRow, SourceConfig } from '@logiparity/core';
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
