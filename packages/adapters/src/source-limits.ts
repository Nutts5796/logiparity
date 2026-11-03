import {
  resourceLimitMessage,
  SourceError,
  type SourceConfig,
  type AdapterContext,
  type DataRow,
} from '@logiparity/core';
export async function* limitSourceRows(
  rows: AsyncIterable<DataRow>,
  config: SourceConfig,
  context: AdapterContext,
): AsyncIterable<DataRow> {
  const limit = config.maxRows ?? 100000;
  let count = 0;
  for await (const row of rows) {
    if (++count > limit)
      throw new SourceError(
        resourceLimitMessage(
          `${context.sourcePath ?? 'sources.' + (context.sourceName ?? config.type)}.maxRows`,
          limit,
        ),
      );
    yield row;
  }
}
