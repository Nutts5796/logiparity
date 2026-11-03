import { expect, it } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { compareEntities, entitySchema, jsonReport, loadConfig } from '@logiparity/core';
import { adapters } from '@logiparity/adapters';
import { prepareDraft, aiSettingsSchema } from '@logiparity/ai';
import { checkedReport } from '../../scripts/validate-report.mjs';
it('accepts actual engine evidence and composite uncertainty through the shipped schema (Crowd9 Sam aiE)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-ai-'));
  try {
    const fields = { id: 'id', code: 'code', pay: 'pay' };
    const source = { type: 'csv', file: 'unused', fields };
    const entity = entitySchema.parse({
      name: 'charge',
      key: ['id', 'code'],
      sources: { a: source, b: source },
      compare: { pay: { type: 'money', currency: 'USD' } },
      aggregates: [{ name: 'total', type: 'sum', field: 'pay' }],
    });
    const report = await checkedReport(
      compareEntities([entity], async function* (name) {
        yield { id: 'L1', code: 'Fuel', pay: name === 'a' ? '10.00' : 'bad' };
        yield { id: 'L2', code: 'TONU', pay: name === 'a' ? '10.00' : '11.00' };
      }),
    );
    const file = join(dir, 'report.json');
    await writeFile(file, jsonReport(report));
    expect(
      (await prepareDraft({ kind: 'explain', report: file }, aiSettingsSchema.parse({ version: 1 }))).messages[1]
        ?.content,
    ).toContain('evidence');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
it('accepts the real shipped freight report including uncertain key arrays (Crowd9 Sam/Tom)', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'logiparity-m103-freight-ai-'));
  try {
    const loaded = await loadConfig(resolve('examples/freight/parity.yaml'), {});
    const report = await checkedReport(
      compareEntities(loaded.config.entities, (_, source) =>
        adapters.read(source, { baseDir: loaded.baseDir, env: {} }),
      ),
    );
    const file = join(dir, 'report.json');
    await writeFile(file, jsonReport(report));
    const draft = await prepareDraft({ kind: 'explain', report: file }, aiSettingsSchema.parse({ version: 1 }));
    expect(draft.messages[1]?.content).toContain('uncertainKeys');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
