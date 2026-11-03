import { limitFindings, appendFinding, FindingsLimitError } from './finding-limit.js';
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
function displayZone(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return value;
  } catch {
    return undefined;
  }
}
const order = (left: string, right: string) => left.localeCompare(right, 'en', { numeric: true });
export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort(
    (a, b) =>
      order(a.entity, b.entity) ||
      order(a.key, b.key) ||
      order(a.field, b.field) ||
      order(a.source, b.source) ||
      order(a.currency ?? '', b.currency ?? '') ||
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
// A unique equal-amount pair on one composite-key load is a review hint, never an automatic match.
function suggestChargeMappings(findings: Finding[], entities: readonly EntityConfig[]): void {
  for (const entity of entities) {
    if (keyFields(entity.key).length < 2) continue;
    const missing = findings.filter((f) => f.entity === entity.name && f.type === 'missing_in_source');
    const extra = findings.filter((f) => f.entity === entity.name && f.type === 'extra_in_source');
    const signature = (f: Finding) =>
      JSON.stringify([
        f.source,
        f.keyParts?.slice(0, -1),
        f.amounts?.map((a) => [a.field, a.currency, String(a.amount)]),
      ]);
    const buckets = new Map<string, { missing: Finding[]; extra: Finding[] }>();
    for (const [rows, side] of [
      [missing, 'missing'],
      [extra, 'extra'],
    ] as const)
      for (const f of rows) {
        if (!f.keyParts?.length || f.amounts?.length !== 1) continue;
        const key = signature(f),
          bucket = buckets.get(key) ?? { missing: [], extra: [] };
        bucket[side].push(f);
        buckets.set(key, bucket);
      }
    for (const pair of buckets.values())
      if (pair.missing.length === 1 && pair.extra.length === 1)
        for (const f of [...pair.missing, ...pair.extra])
          f.hint = 'Likely an unmapped charge code; compare the missing and extra line on this load.';
  }
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
  const baselineInvalid = new Map(
    baseline.issues
      .filter((issue) => issue.type === 'invalid_value')
      .map((issue) => [JSON.stringify([issue.key, issue.field]), issue]),
  );
  const invalidIssues = new Map<string, Finding[]>();
  for (const issue of current.issues) {
    if (issue.type !== 'invalid_value') continue;
    const entries = invalidIssues.get(issue.key) ?? [];
    entries.push(issue);
    invalidIssues.set(issue.key, entries);
  }
  const currencyFields = new Set(
    [config.currencyField, ...Object.values(entity.compare).map((rule) => rule.currencyField)].filter(Boolean),
  );
  for (const [key, expected] of baseline.rows) {
    const actual = current.rows.get(key);
    if (!actual) {
      appendFinding(report, rowDetails(entity, source, reference, key, baseline, 'missing_in_source'));
      continue;
    }
    for (const issue of invalidIssues.get(key) ?? []) {
      if (baseline.uncertain.get(key)?.has(issue.field)) {
        const invalid = baselineInvalid.get(JSON.stringify([key, issue.field]));
        issue.evidence = {
          ...issue.evidence,
          ...(invalid
            ? { referenceInvalid: true, ...(invalid.actual === undefined ? {} : { referenceValue: invalid.actual }) }
            : { referenceUncertain: true }),
        };
      } else issue.expected = expected[issue.field] ?? null;
    }
    const currencyFindings = new Set<string>();
    for (const [field, value] of Object.entries(expected)) {
      if (
        keys.has(field) ||
        currencyFields.has(field) ||
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
        const currencyField = entity.compare[field]?.currencyField ?? config.currencyField ?? field;
        if (currencyFindings.has(currencyField)) continue;
        currencyFindings.add(currencyField);
        appendFinding(report, {
          type: 'field_mismatch',
          entity: entity.name,
          source,
          key,
          field: entity.compare[field]?.currencyField ?? config.currencyField ?? field,
          reason: 'currency_mismatch',
          keyParts: baseline.parts.get(key) ?? [key],
          expected: expectedCurrency,
          actual: actualCurrency,
          message: `Currency differs: ${expectedCurrency} on ${reference}, ${actualCurrency} on ${source}.`,
        });
        continue;
      }
      if (!equalValues(value, actualValue, entity.compare[field]))
        appendFinding(report, {
          type: 'field_mismatch',
          entity: entity.name,
          source,
          key,
          ...(baseline.parts.has(key) ? { keyParts: baseline.parts.get(key) ?? [] } : {}),
          field,
          expected: value,
          actual: actualValue,
          ...(actualCurrency ? { currency: actualCurrency } : {}),
          evidence: {
            offsetFree: current.offsetFree.get(key)?.has(field) ?? false,
            ...(entity.compare[field]?.displayTimezoneField &&
            displayZone(expected[entity.compare[field]!.displayTimezoneField!])
              ? { timezone: displayZone(expected[entity.compare[field]!.displayTimezoneField!])! }
              : {}),
          },
          message: `${keyText(key, baseline.parts.get(key))}: ${field} differs from ${reference}.`,
        });
    }
  }
  for (const key of current.rows.keys())
    if (!baseline.rows.has(key))
      appendFinding(report, rowDetails(entity, source, reference, key, current, 'extra_in_source'));
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
    const qualifies = state.qualifyingRows.get(definition.name) ?? new Set<number>();
    aggregate.excludedRows[source] =
      definition.type === 'count'
        ? []
        : [...new Set([...state.excludedRows, ...[...excluded].flatMap((key) => state.rowNumbers.get(key) ?? [])])]
            .filter((row) => qualifies.has(row))
            .sort((a, b) => a - b);
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
            appendFinding(report, {
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
      appendFinding(report, {
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
  options: Partial<Pick<Config, 'patterns' | 'maxInvalidRows' | 'maxFindings'>> = {},
): Promise<Report> {
  const secrets = secretValues(entities, env);
  const report: Report = {
    schemaVersion: 1,
    findings: [],
    entities: [],
    patterns: options.patterns ?? { minCount: 3 },
  };
  limitFindings(report, options.maxFindings ?? 10000);
  const finalKeys: Record<string, string> = Object.create(null) as Record<string, string>;
  entitiesLoop: for (const entity of entities) {
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
      try {
        const current = await readSource(
          entity,
          source,
          config,
          read,
          secrets,
          report,
          options.maxInvalidRows ?? 50,
          options.maxFindings ?? 10000,
        );
        if (!current) {
          if (source === reference) break;
          continue;
        }
        summary.counts[source] = current.count;
        if (summary.uniqueCounts) summary.uniqueCounts[source] = current.rows.size;
        for (const issue of current.issues) {
          if (source === reference && issue.type === 'invalid_value')
            issue.evidence = {
              ...issue.evidence,
              referenceInvalid: true,
              ...(issue.actual === undefined ? {} : { referenceValue: issue.actual }),
            };
          appendFinding(report, issue);
        }
        publishAggregates(entity, source, reference, current, summary, report);
        if (source === reference) {
          baseline = current;
          const last = [...current.rows.keys()].at(-1);
          if (last && typeof entity.key === 'string') finalKeys[entity.name] = last;
        } else if (baseline) {
          compareSource(entity, source, reference, baseline, current, report);
          collectReconciliation(entity, baseline, current, source, reference, summary);
        }
      } catch (error) {
        if (!(error instanceof FindingsLimitError)) throw error;
        report.truncated = true;
        report.findings.push({
          type: 'source_error',
          entity: entity.name,
          source,
          key: '',
          field: '',
          message: error.message,
        });
        break entitiesLoop;
      }
    }
  }
  suggestChargeMappings(report.findings, entities);
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
