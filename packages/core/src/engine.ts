import { secretValues, redactSecrets, redactTree } from './diagnostics.js';
import { keyFields, type EntityConfig, type Config } from './config.js';
import type { Report, Finding, SourceReader, EntitySummary } from './types.js';
import { readSource, type SourceState } from './source-state.js';
import { equalValues } from './normalize.js';
import { aggregateEqual } from './aggregates.js';
import { applyFailurePolicies } from './policy.js';
import { groupFindings, attachGroupMembership } from './groups.js';
import { collectReconciliation, reconcileAggregates } from './reconciliation.js';
import { keyText } from './keys.js';
import { formatMoneyMajor } from './money-display.js';
const order = (left: string, right: string) => left.localeCompare(right, 'en', { numeric: true });
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      order(a.entity, b.entity) ||
      order(a.key, b.key) ||
      order(a.field, b.field) ||
      order(a.source, b.source) ||
      order(a.type, b.type),
  );
}
function rowDetails(
  entity: EntityConfig,
  source: string,
  reference: string,
  key: string,
  state: SourceState,
  type: 'missing_in_source' | 'extra_in_source',
): Finding {
  const parts = state.parts.get(key),
    row = state.rows.get(key);
  const money = Object.entries(entity.compare).find(
    ([field, rule]) => rule.type === 'money' && typeof row?.[field] === 'bigint',
  );
  const currency = money ? (state.currencies.get(key)?.get(money[0]) ?? money[1].currency ?? 'USD') : undefined;
  const amount = money && row ? `, ${formatMoneyMajor(row[money[0]] as bigint, currency ?? 'USD')}` : '';
  const message =
    type === 'missing_in_source'
      ? `${keyText(key, parts)}: missing from ${source}${amount}.`
      : `${keyText(key, parts)}: not on ${reference}${amount}.`;
  return {
    type,
    entity: entity.name,
    source,
    key,
    field: '',
    message,
    ...(money && row
      ? { amounts: [{ field: money[0], currency: currency ?? 'USD', amount: row[money[0]] as bigint }] }
      : {}),
    ...(parts ? { keyParts: parts } : {}),
    evidence: {
      paginated:
        entity.sources[source]?.type === 'rest'
          ? !!entity.sources[source].pagination
          : entity.sources[source]?.type === 'ui'
            ? !!entity.sources[source].nextPage
            : false,
      pageSizes: [entity.sources[source], entity.sources[reference]].flatMap((config) =>
        config?.type === 'rest' && config.pagination && 'size' in config.pagination ? [config.pagination.size] : [],
      ),
    },
    ...(type === 'missing_in_source' ? { referencePosition: state.positions.get(key) ?? 1 } : {}),
  };
}
// Compare valid, certain cells; an invalid cell does not suppress unrelated rows or fields.
function compareSource(
  entity: EntityConfig,
  source: string,
  reference: string,
  baseline: SourceState,
  current: SourceState,
  report: Report,
): void {
  const config = entity.sources[source];
  if (!config) return;
  const keys = new Set(keyFields(entity.key));
  for (const [key, expected] of baseline.rows) {
    const actual = current.rows.get(key);
    if (!actual) {
      report.findings.push(rowDetails(entity, source, reference, key, baseline, 'missing_in_source'));
      continue;
    }
    for (const issue of current.issues)
      if (issue.key === key && issue.type === 'invalid_value') issue.expected = expected[issue.field] ?? null;
    for (const [field, value] of Object.entries(expected)) {
      if (
        keys.has(field) ||
        !Object.hasOwn(config.fields, field) ||
        (config.rollup && !config.rollup.sum.includes(field) && !config.rollup.first.includes(field)) ||
        current.uncertain.get(key)?.has(field) ||
        baseline.uncertain.get(key)?.has(field)
      )
        continue;
      const actualValue = actual[field] ?? null;
      const expectedCurrency = baseline.currencies.get(key)?.get(field),
        actualCurrency = current.currencies.get(key)?.get(field);
      if (expectedCurrency && actualCurrency && expectedCurrency !== actualCurrency) {
        report.findings.push({
          type: 'field_mismatch',
          entity: entity.name,
          source,
          key,
          field: entity.compare[field]?.currencyField ?? config.currencyField ?? field,
          expected: expectedCurrency,
          actual: actualCurrency,
          message: `Currency differs: ${expectedCurrency} on ${reference}, ${actualCurrency} on ${source}.`,
        });
        continue;
      }
      if (!equalValues(value, actualValue, entity.compare[field]))
        report.findings.push({
          type: 'field_mismatch',
          entity: entity.name,
          source,
          key,
          ...(baseline.parts.has(key) ? { keyParts: baseline.parts.get(key) ?? [] } : {}),
          field,
          expected: value,
          actual: actualValue,
          ...(actualCurrency ? { currency: actualCurrency } : {}),
          evidence: { offsetFree: current.offsetFree.get(key)?.has(field) ?? false },
          message: `${keyText(key, baseline.parts.get(key))}: ${field} differs from ${reference}.`,
        });
    }
  }
  for (const key of current.rows.keys())
    if (!baseline.rows.has(key))
      report.findings.push(rowDetails(entity, source, reference, key, current, 'extra_in_source'));
}
function publishAggregates(
  entity: EntityConfig,
  source: string,
  reference: string,
  state: SourceState,
  summary: EntitySummary,
  report: Report,
): void {
  for (const [index, definition] of entity.aggregates.entries()) {
    const aggregate = summary.aggregates?.[index];
    if (!aggregate) continue;
    const actual = state.measurements.get(definition.name);
    aggregate.sourceStatus ??= {};
    aggregate.uncertainKeys ??= {};
    if (actual === undefined) {
      aggregate.skippedSources.push(source);
      aggregate.sourceStatus[source] = 'not_mapped';
      continue;
    }
    const excluded = state.excluded.get(definition.name) ?? new Set<string>();
    aggregate.sourceStatus[source] = excluded.size ? 'uncertain' : 'certain';
    aggregate.uncertainKeys[source] = [...excluded].map((key) => state.parts.get(key) ?? [key]);
    aggregate.values[source] = actual;
    aggregate.rawValues ??= {};
    aggregate.rawValues[source] = state.rawMeasurements.get(definition.name) ?? actual;
    aggregate.excludedRows ??= {};
    aggregate.excludedRows[source] = [
      ...new Set([
        ...state.excludedRows,
        ...state.invalidRows,
        ...[...excluded].flatMap((key) => state.rowNumbers.get(key) ?? []),
      ]),
    ].sort((a, b) => a - b);
    const currencies = state.currencyMeasurements.get(definition.name);
    if (currencies) {
      aggregate.valuesByCurrency ??= {};
      aggregate.valuesByCurrency[source] = currencies;
      aggregate.rawValuesByCurrency ??= {};
      aggregate.rawValuesByCurrency[source] = state.rawCurrencies.get(definition.name) ?? {};
      const referenceCurrencies = aggregate.valuesByCurrency[reference];
      if (source !== reference && referenceCurrencies) {
        for (const currency of new Set([...Object.keys(currencies), ...Object.keys(referenceCurrencies)])) {
          const expectedAmount = BigInt(referenceCurrencies[currency] ?? 0),
            actualAmount = BigInt(currencies[currency] ?? 0);
          if (!aggregateEqual(expectedAmount, actualAmount, definition))
            report.findings.push({
              type: 'aggregate_mismatch',
              entity: entity.name,
              source,
              key: '',
              field: definition.name,
              currency,
              expected: expectedAmount,
              actual: actualAmount,
              message: `${definition.name} (${currency}) differs from ${reference}.`,
            });
        }
      }
      continue;
    }
    const expected = aggregate.values[reference];
    if (source !== reference && expected !== undefined && !aggregateEqual(expected, actual, definition))
      report.findings.push({
        type: 'aggregate_mismatch',
        entity: entity.name,
        source,
        key: '',
        field: definition.name,
        expected,
        actual,
        message: `${definition.name} differs from ${reference}.`,
      });
  }
}
function redactReportValues(report: Report, secrets: readonly string[]): void {
  const value = (input: unknown) => (typeof input === 'string' ? redactSecrets(input, secrets, 'data') : input);
  for (const finding of report.findings) {
    finding.key = String(value(finding.key));
    if (finding.keyParts) finding.keyParts = finding.keyParts.map((part) => String(value(part)));
    if (typeof finding.expected === 'string') finding.expected = String(value(finding.expected));
    if (typeof finding.actual === 'string') finding.actual = String(value(finding.actual));
    if (finding.relatedKeys) finding.relatedKeys = finding.relatedKeys.map((key) => String(value(key)));
    finding.values?.forEach((item) => {
      if (typeof item.value === 'string') item.value = String(value(item.value));
    });
    finding.message = redactSecrets(finding.message, secrets);
  }
  for (const group of report.groups ?? []) {
    if (group.keys) group.keys = group.keys.map((key) => String(value(key)));
    group.summary = redactSecrets(group.summary, secrets);
    if (typeof group.expected === 'string') group.expected = String(value(group.expected));
    if (typeof group.actual === 'string') group.actual = String(value(group.actual));
  }
}
export async function compareEntities(
  entities: EntityConfig[],
  read: SourceReader,
  env: NodeJS.ProcessEnv = process.env,
  options: Partial<Pick<Config, 'patterns' | 'maxInvalidRows'>> = {},
): Promise<Report> {
  const secrets = secretValues(entities, env);
  const report: Report = {
    schemaVersion: 1,
    findings: [],
    entities: [],
    patterns: options.patterns ?? { minCount: 3 },
  };
  const finalKeys: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const entity of entities) {
    const sources = Object.entries(entity.sources),
      reference = sources[0]?.[0] ?? '';
    const summary: EntitySummary = {
      entity: entity.name,
      reference,
      counts: {},
      uniqueCounts: {},
      filters: Object.fromEntries(
        sources
          .filter(([, source]) => Object.keys(source.where).length || Object.keys(source.rollup?.where ?? {}).length)
          .map(([name, source]) => [
            name,
            { source: source.where, rollup: source.rollup?.where ?? {}, caseSensitive: source.caseSensitive },
          ]),
      ),
      rollupSources: sources.filter(([, source]) => !!source.rollup).map(([name]) => name),
      pluralLabel: entity.pluralLabel ?? 'records',
      aggregates: entity.aggregates.map((aggregate) => ({
        name: aggregate.name,
        type: aggregate.type,
        values: {},
        skippedSources: [],
        sourceStatus: Object.fromEntries(sources.map(([source]) => [source, 'not_read' as const])),
      })),
    };
    report.entities.push(summary);
    let baseline: SourceState | undefined;
    for (const [source, config] of sources) {
      const current = await readSource(entity, source, config, read, secrets, report, options.maxInvalidRows ?? 50);
      if (!current) {
        if (source === reference) break;
        continue;
      }
      summary.counts[source] = current.count;
      if (summary.uniqueCounts) summary.uniqueCounts[source] = current.rows.size;
      report.findings.push(...current.issues);
      publishAggregates(entity, source, reference, current, summary, report);
      if (source === reference) {
        baseline = current;
        const last = [...current.rows.keys()].at(-1);
        if (last && typeof entity.key === 'string') finalKeys[entity.name] = last;
      } else if (baseline) {
        compareSource(entity, source, reference, baseline, current, report);
        collectReconciliation(entity, baseline, current, source, reference, summary);
      }
    }
  }
  sortFindings(report.findings);
  report.entities.sort((a, b) => order(a.entity, b.entity));
  applyFailurePolicies(report, entities);
  report.groups = groupFindings(report.findings, entities, finalKeys, report.patterns);
  attachGroupMembership(report);
  reconcileAggregates(report, entities);
  attachGroupMembership(report);
  redactReportValues(report, secrets);
  return redactTree(report, secrets);
}
