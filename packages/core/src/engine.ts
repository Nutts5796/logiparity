import { errorText, type EntityConfig } from './config.js';
import { equalValues, normalize } from './normalize.js';
import type { Finding, NormalizedValue, Report, SourceReader } from './types.js';

type Row = Record<string, NormalizedValue>;
const order = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => order(a.entity, b.entity) || order(a.key, b.key) || order(a.field, b.field) || order(a.source, b.source) || order(a.type, b.type));
}

export async function compareEntities(entities: EntityConfig[], read: SourceReader): Promise<Report> {
  const report: Report = { schemaVersion: 1, findings: [], entities: [] };
  for (const entity of entities) {
    const sources = Object.entries(entity.sources);
    const reference = sources[0]?.[0] ?? '';
    const summary = { entity: entity.name, reference, counts: {} as Record<string, number> };
    report.entities.push(summary);
    let baseline: Map<string, Row> | undefined;
    for (const [source, config] of sources) {
      const rows = new Map<string, Row>();
      const duplicates: Finding[] = [];
      let rowNumber = 0;
      let context = '';
      try {
        for await (const raw of read(source, config)) {
          rowNumber++;
          context = `row ${rowNumber}`;
          const rawKey = raw[entity.key];
          if ((typeof rawKey !== 'string' && typeof rawKey !== 'number') || String(rawKey).trim() === '' || (typeof rawKey === 'number' && !Number.isSafeInteger(rawKey))) throw new Error(`Invalid key ${entity.key}; provide a nonempty string or safe integer.`);
          const key = String(rawKey).trim();
          context += `, key ${key}`;
          if (rows.has(key)) {
            duplicates.push({ type: 'duplicate_key', entity: entity.name, source, key, field: entity.key, message: `${source}: duplicate key ${key} at row ${rowNumber}; make source keys unique. The first record is used.` });
            continue;
          }
          const row: Row = Object.create(null) as Row;
          for (const [field, value] of Object.entries(raw)) {
            context = `row ${rowNumber}, key ${key}, field ${field}`;
            row[field] = field === entity.key ? key : normalize(value, entity.compare[field], source);
          }
          rows.set(key, row);
        }
        summary.counts[source] = rowNumber;
      } catch (error) {
        report.findings.push({ type: 'source_error', entity: entity.name, source, key: '', field: '', message: `${entity.name}/${source}${context ? ` (${context})` : ''}: ${errorText(error)} Check this source's configuration and data.` });
        if (source === reference) break;
        continue;
      }
      report.findings.push(...duplicates);
      if (source === reference) { baseline = rows; continue; }
      if (!baseline) continue;
      for (const [key, expected] of baseline) {
        const actual = rows.get(key);
        if (!actual) {
          report.findings.push({ type: 'missing_in_source', entity: entity.name, source, key, field: '', message: `${source}: key ${key} exists in reference ${reference} but is missing here; check export filtering and pagination.` });
          continue;
        }
        for (const [field, expectedValue] of Object.entries(expected)) {
          // Partial sources (e.g. a dispatcher table) compare only explicitly mapped fields.
          if (field === entity.key || !Object.hasOwn(config.fields, field)) continue;
          const actualValue = actual[field] ?? null;
          if (!equalValues(expectedValue, actualValue, entity.compare[field])) report.findings.push({ type: 'field_mismatch', entity: entity.name, source, key, field, expected: expectedValue, actual: actualValue, message: `${source}: key ${key}, field ${field} differs from reference ${reference}; check formatting, rounding and business rules.` });
        }
      }
      for (const key of rows.keys()) if (!baseline.has(key)) report.findings.push({ type: 'extra_in_source', entity: entity.name, source, key, field: '', message: `${source}: key ${key} is absent from reference ${reference}; check stale or incorrectly included records.` });
    }
  }
  sortFindings(report.findings);
  report.entities.sort((a, b) => order(a.entity, b.entity));
  return report;
}
