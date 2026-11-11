import { normalize, ruleSchema } from '@logiparity/core';

export function columnName(header: string): string {
  const plain = header
    .replace(/^\$\.?/, '')
    .replace(/\[['"]([^'"\]]+)['"]\]/g, '.$1')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
  const aliases: Record<string, string> = {
    record_id: 'id',
    recordid: 'id',
    identifier: 'id',
    cust_id: 'customer_id',
    customerid: 'customer_id',
    total_amount: 'amount',
    totalamount: 'amount',
    amount_usd: 'amount',
    unit_count: 'units',
    power_units: 'units',
    filing_date: 'date',
    record_date: 'date',
    status_code: 'status',
  };
  return aliases[plain] ?? (plain || 'column');
}
export interface Guess {
  type: 'string' | 'enum' | 'number' | 'money' | 'date' | 'datetime';
  evidence: string;
  format?: string;
  naive?: boolean;
  symbol?: boolean;
}
const present = (v: unknown) => v !== null && v !== undefined && String(v).trim() !== '';
export function guess(header: string, values: unknown[]): Guess {
  const cells = values.filter(present),
    texts = cells.map((v) => (v instanceof Date ? v.toISOString() : String(v).trim())),
    name = columnName(header);
  const summary = `${cells.length}/${values.length} nonempty sample values`;
  if (!cells.length)
    return { type: 'string', evidence: `${summary}; empty column, no type evidence — TODO review with nonempty data` };
  if (/(?:^|_)id$|identifier|zip|postal|code/.test(name) && !/(?:status|date)/.test(name))
    return {
      type: 'string',
      evidence: `${summary}; identifier-like name, preserve text and leading zeroes — TODO confirm identifier semantics`,
    };
  const formats: [RegExp, string][] = [
    [/^\d{4}-\d{2}-\d{2}$/, 'yyyy-MM-dd'],
    [/^\d{8}$/, 'yyyyMMdd'],
    [/^\d{2}-[A-Za-z]{3}-\d{2}$/, 'dd-MMM-yy'],
  ];
  for (const [shape, format] of formats)
    if (texts.every((t) => shape.test(t)) && (format !== 'yyyyMMdd' || /date|day/.test(name))) {
      try {
        const rule = ruleSchema.parse({ type: 'date', format });
        texts.forEach((t) => normalize(t, rule, 'sample'));
        return {
          type: 'date',
          format,
          evidence: `${summary}; all values parse as ${format}; TODO confirm calendar and century rule`,
        };
      } catch {
        return {
          type: 'string',
          evidence: `${summary}; date-shaped values fail strict calendar parsing — TODO correct the values or format`,
        };
      }
    }
  if (texts.every((t) => /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(t)))
    return {
      type: 'datetime',
      naive: !texts.every((t) => /(?:Z|[+-]\d{2}:?\d{2})$/i.test(t)),
      evidence: `${summary}; timestamp-shaped values; TODO verify offsets and source zone`,
    };
  const symbol = texts.some((t) => /[$€£¥]/.test(t)),
    money = /amount|price|payout|balance|cost|money|cents/.test(name) || symbol;
  const decimals = texts.map((t) => t.replace(/^[$€£¥]\s*/, '').replace(/\s*[$€£¥]$/, ''));
  const numeric = decimals.every((t) => /^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(t));
  if (numeric && money)
    return {
      type: 'money',
      symbol,
      evidence: `${summary}; monetary name/symbol and decimal-shaped values. TODO confirm currency, major/minor units and cent precision${/cents/.test(name) ? '; integer cents need conversion to major-unit text before a money rule' : ''}`,
    };
  if (numeric && decimals.every((value) => Number.isFinite(Number(value.replaceAll(',', '')))))
    return {
      type: 'number',
      evidence: `${summary}; finite decimal-shaped values, comma groups/dot decimal assumed — TODO confirm separators and identifier semantics`,
    };
  const distinct = new Set(texts),
    folded = new Set(texts.map((t) => t.toLowerCase()));
  if (
    /status|flag|state|category|kind|type/.test(name) ||
    (texts.length >= 3 && distinct.size <= 20 && distinct.size <= texts.length / 2)
  )
    return {
      type: 'enum',
      evidence: `${summary}; ${distinct.size} distinct spellings${folded.size < distinct.size ? ', including case variants (caseFold stays false)' : ''}; TODO confirm vocabulary`,
    };
  return {
    type: 'string',
    evidence: `${summary}; no consistent numeric/calendar type${cells.some((v) => v && typeof v === 'object') ? '; complex JSON/Excel value needs a scalar mapping' : ''} — TODO review as text`,
  };
}
