import { describe, expect, it } from 'vitest';
import { equalValues, moneyMinor, normalize, ruleSchema } from '@logiparity/core';

describe('normalization', () => {
  it.each([
    ['1.01', 'USD', 'en-US', 101n],
    ['-1,234.50', 'USD', 'en-US', -123450n],
    ['1.234,50', 'EUR', 'de-DE', 123450n],
    ['1\u202f234,50', 'EUR', 'fr-FR', 123450n],
    ['100', 'JPY', 'en-US', 100n],
    ['1.234', 'KWD', 'en-US', 1234n],
    ['12,34,567.89', 'INR', 'en-IN', 123456789n],
    ['9007199254740993.01', 'USD', 'en-US', 900719925474099301n],
    ['1.0000', 'USD', 'en-US', 100n],
    ['+0.00', 'USD', 'en-US', 0n],
  ])('converts %s %s exactly', (input, currency, locale, expected) =>
    expect(moneyMinor(input, currency, locale)).toBe(expected),
  );
  it.each(['1.005', '1,2.00', '$1.00', 'NaN', '1e3', '1.2.3'])('rejects invalid or unrounded money %s', (v) =>
    expect(() => moneyMinor(v, 'USD')).toThrow(),
  );
  it('rejects numeric money to preserve exactness', () =>
    expect(() => normalize(1.01, ruleSchema.parse({ type: 'money', currency: 'USD' }), 'api')).toThrow(
      'decimal string',
    ));
  it('trims, folds case, maps enums and controls empty/null', () => {
    expect(normalize('  hi  ', undefined, 'a')).toBe('hi');
    expect(normalize(true, undefined, 'a')).toBe(true);
    expect(normalize(2n, undefined, 'a')).toBe(2n);
    expect(normalize(null, undefined, 'a')).toBeNull();
    expect(normalize(undefined, undefined, 'a')).toBeNull();
    expect(normalize(' ', undefined, 'a')).toBeNull();
    expect(normalize('', ruleSchema.parse({ type: 'string', emptyAsNull: false }), 'a')).toBe('');
    expect(normalize(' HIGH ', ruleSchema.parse({ type: 'string', caseFold: true }), 'a')).toBe('high');
    expect(
      normalize(
        ' Delivered ',
        ruleSchema.parse({ type: 'enum', map: { Delivered: 'DELIVERED' }, caseFold: true }),
        'a',
      ),
    ).toBe('delivered');
    expect(normalize('unknown', ruleSchema.parse({ type: 'enum' }), 'a')).toBe('unknown');
    expect(normalize('constructor', ruleSchema.parse({ type: 'enum' }), 'a')).toBe('constructor');
    expect(normalize(7, undefined, 'a')).toBe(7);
    expect(() => normalize({}, undefined, 'a')).toThrow('scalar');
    expect(() => normalize(NaN, undefined, 'a')).toThrow('finite');
  });
  it('parses localized finite numbers and compares tolerances', () => {
    const number = ruleSchema.parse({ type: 'number', locale: 'de-DE', tolerance: 0.1 });
    expect(normalize('1.234,50', number, 'a')).toBe(1234.5);
    expect(equalValues(1, 1.05, number)).toBe(true);
    expect(equalValues(1, 1.2, number)).toBe(false);
    expect(equalValues(1, 1)).toBe(true);
    expect(equalValues('1', 1)).toBe(false);
    expect(() => normalize('9'.repeat(400), number, 'a')).toThrow('finite');
  });
  it('uses integer money tolerance in both directions', () => {
    const money = ruleSchema.parse({ type: 'money', currency: 'USD', tolerance: 1 });
    expect(equalValues(101n, 100n, money)).toBe(true);
    expect(equalValues(100n, 101n, money)).toBe(true);
    expect(equalValues(103n, 100n, money)).toBe(false);
    expect(equalValues(100n, 100n)).toBe(true);
  });
  it('normalizes explicit and source-local datetimes to UTC with tolerance', () => {
    const rule = ruleSchema.parse({
      type: 'datetime',
      sourceTimezones: { export: 'America/Chicago' },
      toleranceSeconds: 60,
    });
    const utc = normalize('2026-11-02T13:00:00Z', rule, 'api');
    expect(normalize('2026-11-02 07:00:00', rule, 'export')).toBe(utc);
    expect(normalize(new Date('2026-11-02T13:00:00Z'), rule, 'api')).toBe(utc);
    expect(equalValues(0, 60000, rule)).toBe(true);
    expect(equalValues(0, 60001, rule)).toBe(false);
    expect(() => normalize('2026-11-02T13:00:00', rule, 'api')).toThrow('sourceTimezones.api');
    expect(() => normalize('not-a-dateZ', rule, 'api')).toThrow('Invalid ISO');
    expect(() => normalize('2026-11-01T01:30:00', rule, 'export')).toThrow('ambiguous');
    expect(() => normalize('2026-03-08T02:30:00', rule, 'export')).toThrow('gap');
    expect(() =>
      normalize('2026-11-02T07:00:00', ruleSchema.parse({ type: 'datetime', sourceTimezones: { a: 'No/Zone' } }), 'a'),
    ).toThrow('timezone');
  });
});
