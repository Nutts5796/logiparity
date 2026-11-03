import { parseCheckedJson } from '../../scripts/validate-report.mjs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { consoleReport, jsonReport, reportExitCode, writeJsonReport, type Report } from '@logiparity/core';

it('writes a versioned report with lossless money and bounded console details', async () => {
  const report: Report = {
    schemaVersion: 1,
    entities: [],
    findings: Array.from({ length: 12 }, (_, i) => ({
      type: 'field_mismatch',
      entity: 'shipment',
      source: 'export',
      key: String(i),
      field: 'payout',
      expected: 900719925474099301n,
      actual: 900719925474099300n,
      message: 'one cent differs',
    })),
  };
  report.findings.push({
    type: 'missing_in_source',
    entity: 'shipment',
    source: 'export',
    key: 'x',
    field: '',
    message: 'missing',
  });
  const text = consoleReport(report);
  expect(text).toContain('Value differences: 12');
  expect(text).toContain('Missing: 1');
  expect(text).toContain('3 additional results');
  expect(text).toContain('900719925474099301');
  const json = parseCheckedJson(jsonReport(report)) as { schemaVersion: number; findings: { expected: string }[] };
  expect(json.schemaVersion).toBe(1);
  expect(json.findings[0]?.expected).toBe('900719925474099301');
  const directory = await mkdtemp(join(tmpdir(), 'logiparity-report-'));
  try {
    await writeJsonReport(report, join(directory, 'nested'));
    expect(await readFile(join(directory, 'nested/report.json'), 'utf8')).toBe(jsonReport(report));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('returns 0 for no findings and prints source errors without values', () => {
  const report: Report = { schemaVersion: 1, entities: [], findings: [] };
  expect(reportExitCode(report)).toBe(0);
  expect(consoleReport(report)).toContain('0 findings');
  report.findings.push({
    type: 'source_error',
    entity: 'x',
    source: 'api',
    key: '',
    field: '',
    message: 'cannot read',
  });
  expect(reportExitCode(report)).toBe(2);
  expect(consoleReport(report)).not.toContain('key=- field=-');
});
