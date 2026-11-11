import { expect, it } from 'vitest';
import { readSample } from '@logiparity/adapters';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
it('reads bounded CSV, Excel and saved JSON, retaining sparse properties and blank columns', async () => {
  const root = resolve('tests/fixtures/suggest');
  const csv = await readSample(join(root, 'reference.csv'), { limit: 2 });
  expect(csv.rows).toHaveLength(2);
  expect(csv.truncated).toBe(true);
  expect(csv.rows[0]?.['Record ID']).toBe('001');
  expect(csv.rows[0]?.['Total Amount']).toBe('1,234.50');
  const json = await readSample(join(root, 'candidate.json'));
  expect(json.headers).toContain('$.Empty');
  expect(Object.hasOwn(json.rows[1]!, '$.Empty')).toBe(false);
  const excel = await readSample(join(root, 'candidate.xlsx'), { sheet: 'Records' });
  expect(excel.rows).toHaveLength(4);
  expect(excel.rows[0]?.record_id).toBe('001');
  expect(excel.headers).toContain('Empty');
  await expect(readSample(join(root, 'candidate.xlsx'))).rejects.toThrow('--sheet');
});
it('rejects malformed, duplicate-header and oversized samples and never fetches a URL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-sample-'));
  try {
    await writeFile(join(dir, 'x.csv'), 'a,a\n1,2\n');
    await expect(readSample(join(dir, 'x.csv'))).rejects.toThrow('unique');
    await writeFile(join(dir, 'x.json'), '[{"x":');
    await expect(readSample(join(dir, 'x.json'))).rejects.toThrow();
    await writeFile(join(dir, 'large.json'), ' '.repeat(8 * 1024 * 1024 + 1));
    await expect(readSample(join(dir, 'large.json'))).rejects.toThrow('8 MiB');
    await expect(readSample('https://example.invalid/sample.json')).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('selects nested JSON explicitly and retains complex leaves as unresolved mappings', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m12-json-'));
  try {
    const file = join(dir, 'x.json');
    await writeFile(file, JSON.stringify({ records: [{ id: 'x', nested: { n: 1 }, array: [1, 2] }] }));
    await expect(readSample(file)).rejects.toThrow('--items');
    const sample = await readSample(file, { items: '$.records[*]' });
    expect(sample.headers).toEqual(['$.id', '$.nested.n', '$.array']);
    expect(sample.rows[0]?.['$.array']).toEqual([1, 2]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
