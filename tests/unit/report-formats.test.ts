import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { consoleReport, htmlReport, junitReport, markdownReport, writeReports, type Report } from '@logiparity/core';

const exec = promisify(execFile);
const schema = resolve('tests/fixtures/junit/JUnit.xsd');
const stamp = new Date('2026-11-02T12:00:00Z');
const report: Report = {
  schemaVersion: 1,
  entities: [
    {
      entity: 'shipment',
      reference: 'api',
      counts: { api: 2, export: 1 },
      aggregates: [{ name: 'payout', type: 'sum', values: { api: 101n, export: 100n }, skippedSources: ['ui'] }],
    },
  ],
  findings: [
    {
      type: 'field_mismatch',
      entity: 'shipment',
      source: 'export',
      key: 'S1',
      field: 'payout',
      expected: 101n,
      actual: 100n,
      message: 'payout differs',
      blocking: true,
      screenshot: 'screenshots/failed row.png',
    },
    {
      type: 'missing_in_source',
      entity: 'shipment',
      source: 'export',
      key: 'S2',
      field: '',
      message: 'missing',
      blocking: false,
    },
  ],
};

describe('report formats', () => {
  it('writes each requested file and leaves console-only checks free of filesystem writes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logiparity-formats-'));
    try {
      await writeReports(report, join(dir, 'not-created'), ['console']);
      await expect(readFile(join(dir, 'not-created/report.json'))).rejects.toThrow('ENOENT');
      await writeReports(report, dir, ['json', 'html', 'junit', 'markdown', 'json']);
      expect(await readFile(join(dir, 'report.html'), 'utf8')).toBe(htmlReport(report));
      expect(await readFile(join(dir, 'report.md'), 'utf8')).toBe(markdownReport(report));
      expect(await readFile(join(dir, 'report.json'), 'utf8')).toContain('"blocking": false');
      await exec('xmllint', ['--nonet', '--noout', '--schema', schema, join(dir, 'junit.xml')]);
      await writeFile(join(dir, 'occupied'), 'file');
      await expect(writeReports(report, join(dir, 'occupied'), ['html'])).rejects.toThrow('Cannot write html report');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it('renders all findings and aggregates in self-contained HTML with safe screenshot links', () => {
    const html = htmlReport(report);
    expect(html).toContain('Failed');
    expect(html).toContain('Allowed by failOn');
    expect(html).toContain('id="entity-filter"');
    expect(html).toContain('id="type-filter"');
    expect(html).toContain('screenshots/failed%20row.png');
    expect(html).toContain('title="101"');
    expect(html).toContain("connect-src 'none'");
    expect(html).toContain("script-src 'sha256-");
    expect(html).not.toMatch(/<(?:script|link|img)[^>]+(?:src|href)=/);
    expect(htmlReport(report)).toBe(html);
  });
  it('escapes HTML, rejects unsafe evidence paths and keeps data out of executable script', () => {
    for (const screenshot of [
      'javascript:alert(1)',
      'https://example.invalid/x.png',
      '//example.invalid/x.png',
      'screenshots/../private.png',
      'screenshots/x\\y.png',
      'screenshots/x.png?token=secret',
      'screenshots/\n.png',
      'screenshots/x.svg',
      'screenshots//x.png',
    ]) {
      const hostile: Report = {
        ...report,
        findings: [
          {
            ...report.findings[0]!,
            entity: '"><img src=x onerror=alert(1)>',
            message: '</script><script>alert(1)</script>',
            screenshot,
          },
        ],
      };
      const html = htmlReport(hostile);
      expect(html).not.toContain('View screenshot');
      expect(html.includes('</script><script>')).toBe(false);
      expect(html).not.toContain('<img src=');
      expect(html.match(/<script>/g)).toHaveLength(1);
    }
  });
  it('renders successful, observed and errored outcomes consistently', () => {
    const empty: Report = { schemaVersion: 1, entities: [], findings: [] };
    expect(htmlReport(empty)).toContain('All configured comparisons passed');
    expect(markdownReport(empty)).toContain('**Passed**');
    const allowed: Report = { ...report, findings: report.findings.map((f) => ({ ...f, blocking: false })) };
    expect(htmlReport(allowed)).toContain('Passed');
    expect(markdownReport(allowed)).toContain('0 blocking');
    const error: Report = {
      ...report,
      findings: [
        {
          type: 'source_error',
          entity: 'shipment',
          source: 'api',
          key: '',
          field: '',
          message: 'cannot read',
          blocking: false,
        },
      ],
    };
    expect(htmlReport(error)).toContain('Runtime error');
    expect(consoleReport(error)).toContain('0 findings (0 blocking findings), 1 source error');
  });
  it('escapes Markdown injection and limits comment summaries to 50 findings', () => {
    const hostile = {
      ...report.findings[0]!,
      reason: 'rollup_conflict' as const,
      message: '![x](https://example.invalid/img) | <script>\n`code` & text',
      actual: null,
    };
    const markdown = markdownReport({ ...report, findings: Array.from({ length: 52 }, () => hostile) });
    expect(markdown).toContain('2 additional findings');
    expect(markdown).not.toContain('![x]');
    expect(markdown).toContain('\\|');
    expect(markdown).toContain('\\<script\\>');
    expect(markdown).not.toContain('<br>');
    expect(markdown).toContain('101');
    expect(markdown).not.toContain('&quot;');
  });
  it('validates pass/failure/skipped/error JUnit reports against the independent Ant XSD', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'logiparity-junit-'));
    try {
      for (const [index, findings] of [
        [],
        report.findings,
        [
          {
            type: 'source_error',
            entity: 'shipment',
            source: 'api',
            key: '',
            field: '',
            message: 'bad \u0000\ud800 XML & </failure> 😀',
          },
        ],
        [
          {
            type: 'field_mismatch',
            entity: '<x>&',
            source: 'api',
            key: '1',
            field: 'value',
            message: 'quoted "value"',
            expected: 1,
            actual: null,
          },
        ],
      ].entries()) {
        const value = { ...report, findings } as Report;
        const xml = junitReport(value, stamp);
        const file = join(dir, `report-${index}.xml`);
        await writeFile(file, xml);
        await exec('xmllint', ['--nonet', '--noout', '--schema', schema, file]);
        expect(xml).toContain('timestamp="2026-11-02T12:00:00"');
        if (index === 1) {
          expect(xml).toContain('failures="1"');
          expect(xml).toContain('skipped="1"');
          expect(xml.match(/<testcase /g)).toHaveLength(8);
        }
        if (index === 2) {
          expect(xml).toContain('errors="1"');
          expect(xml).toContain('bad �� XML &amp;');
        }
      }
      const invalid = join(dir, 'invalid.xml');
      await writeFile(invalid, '<testsuites><testcase/></testsuites>');
      await expect(exec('xmllint', ['--nonet', '--noout', '--schema', schema, invalid])).rejects.toThrow();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
