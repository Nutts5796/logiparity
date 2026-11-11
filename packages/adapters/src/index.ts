import { requireOptionalAdapter } from './optional.js';
import {
  assertAllowedHost,
  fieldPath,
  type Adapter,
  type AdapterContext,
  type DataRow,
  type SourceConfig,
  type Config,
} from '@logiparity/core';
import { jsonPathTokens } from './jsonpath.js';
import { validateReadOnlySql, sqlConnectionUrl } from './sql-guard.js';
import { readRest } from './rest.js';
import { readFileSource } from './file.js';
import { readUi } from './ui.js';
import { readSql } from './sql.js';

export const adapters: Adapter = {
  read(config: SourceConfig, context: AdapterContext): AsyncIterable<DataRow> {
    if (config.type === 'rest')
      assertAllowedHost(config.baseUrl, context.allowedHosts, config.label ?? context.sourceName ?? 'REST');
    if (config.type === 'ui')
      assertAllowedHost(config.url, context.allowedHosts, config.label ?? context.sourceName ?? 'UI');
    if (config.type === 'sql' && context.env[config.connectionEnv])
      assertAllowedHost(
        sqlConnectionUrl(context.env[config.connectionEnv] as string, context.env),
        context.allowedHosts,
        'SQL',
      );
    switch (config.type) {
      case 'rest':
        return readRest(config, context);
      case 'csv':
      case 'xlsx':
        return readFileSource(config, context);
      case 'ui':
        return readUi(config, context);
      case 'sql':
        return readSql(config, context);
    }
  },
};
export { readRest, readFileSource, readUi, readSql };
export { selectJson } from './jsonpath.js';

/** Validate extraction/query syntax without opening a source. */
export function validateSource(config: SourceConfig, location = 'source.'): void {
  if (config.type === 'ui' || config.type === 'sql') requireOptionalAdapter(config.type);
  if (config.type === 'sql') validateReadOnlySql(config.query);
  if (config.type !== 'rest') return;
  const pagination = config.pagination;
  const paths: [string, string][] = [
    ['items', config.items],
    ...Object.entries(config.fields).map(([field, mapping]): [string, string] => [
      `fields.${field}`,
      fieldPath(mapping),
    ]),
  ];
  if (pagination?.type === 'cursor') paths.push(['pagination.next', pagination.next]);
  if (pagination?.type === 'page' || pagination?.type === 'offset') {
    for (const field of ['totalPath', 'totalPagesPath', 'hasMorePath'] as const)
      if (pagination[field]) paths.push([`pagination.${field}`, pagination[field]]);
  }
  for (const [field, path] of paths)
    try {
      jsonPathTokens(path);
    } catch (error) {
      throw new Error(`${location}${field}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/** Shared semantic checks for validate and check, with no source I/O. */
export function validateConfig(config: Config, env: NodeJS.ProcessEnv = process.env): void {
  for (const [index, entity] of config.entities.entries()) {
    const reference = Object.values(entity.sources)[0]!;
    for (const [field, rule] of Object.entries(entity.compare)) {
      if (!Object.hasOwn(reference.fields, field))
        throw new Error(`entities[${index}].compare.${field}: comparison field is not mapped in the reference source`);
      if (rule.format && typeof rule.format === 'object')
        for (const name of Object.keys(rule.format))
          if (!Object.hasOwn(entity.sources, name))
            throw new Error(`entities[${index}].compare.${field}.format.${name}: unknown source`);
      for (const name of Object.keys(rule.sourceTimezones))
        if (!Object.hasOwn(entity.sources, name))
          throw new Error(`entities[${index}].compare.${field}.sourceTimezones.${name}: unknown source`);
    }
    for (const [sourceName, source] of Object.entries(entity.sources)) {
      try {
        if (source.type === 'rest') assertAllowedHost(source.baseUrl, config.allowedHosts, 'REST');
        if (source.type === 'ui') assertAllowedHost(source.url, config.allowedHosts, 'UI');
        if (source.type === 'sql' && env[source.connectionEnv])
          assertAllowedHost(sqlConnectionUrl(env[source.connectionEnv] as string, env), config.allowedHosts, 'SQL');
        validateSource(source, `entities[${index}].sources.${sourceName}.`);
      } catch (error) {
        if (error instanceof Error && error.message.startsWith(`entities[${index}].sources.`)) throw error;
        throw new Error(
          `entities[${index}].sources.${sourceName}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}

// Internal CLI access; excluded from the public adapters wrapper.
export { requireOptionalAdapter } from './optional.js';

export { readSample } from './sample.js';
export type { SourceSample, SampleOptions } from './sample.js';
