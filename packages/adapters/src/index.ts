import type { Adapter, AdapterContext, DataRow, SourceConfig } from '@logiparity/core';
import { readRest } from './rest.js';
import { readFileSource } from './file.js';

export const adapters: Adapter = {
  read(config: SourceConfig, context: AdapterContext): AsyncIterable<DataRow> {
    return config.type === 'rest' ? readRest(config, context) : readFileSource(config, context);
  },
};
export { readRest, readFileSource };
