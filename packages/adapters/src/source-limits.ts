import { SourceError, type SourceConfig, type AdapterContext, type DataRow } from '@logiparity/core';
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
        `${config.label ?? context.sourceName ?? config.type}: source exceeds maxRows (${limit}). Reduce the export or increase the reviewed limit.`,
      );
    yield row;
  }
}
