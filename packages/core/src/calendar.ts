import { DateTime } from 'luxon';

export function formatHasTime(format: string): boolean {
  return DateTime.fromFormatExplain('', format).tokens.some(
    (token) => !token.literal && /^(?:[HhmsSu]+|[tTfF]{1,4}|[xX])$/.test(token.val),
  );
}
export function isCalendarFormat(format: string): boolean {
  const tokens = DateTime.fromFormatExplain('', format).tokens.filter((token) => !token.literal);
  return (
    !tokens.some((token) => /^(?:[HhmsSuZaXxz]+|[tTfF]{1,4})$/.test(token.val)) &&
    tokens.some((token) => /^y{2,4}$/.test(token.val)) &&
    tokens.some((token) => /^[ML]{1,4}$/.test(token.val)) &&
    tokens.some((token) => /^d{1,2}$/.test(token.val))
  );
}
// Calendar dates have no instant or zone. The fixed 1969–2068 pivot does not depend on the host year or Luxon settings.
export function normalizeDate(text: string, format: string | undefined, locale: string): string {
  if (!format && !/^\d{4}-\d{2}-\d{2}$/.test(text))
    throw new Error('Date requires an ISO calendar day (yyyy-MM-dd), or a date-only format; omit the time and zone.');
  const selected = format ?? 'yyyy-MM-dd';
  const explanation = DateTime.fromFormatExplain(text, selected, { locale });
  if (!explanation.rawMatches || explanation.invalidReason)
    throw new Error(`Date value does not match configured calendar format "${selected}".`);
  const parts = { ...explanation.result };
  if (
    explanation.tokens.some((token) => !token.literal && token.val === 'yy') &&
    typeof explanation.matches?.y === 'number'
  ) {
    const year = explanation.matches.y % 100;
    parts.year = year <= 68 ? 2000 + year : 1900 + year;
  }
  const date = DateTime.fromObject(parts, { zone: 'UTC', locale });
  if (!date.isValid || date.year < 1 || date.year > 9999)
    throw new Error('Invalid calendar date; check the year, month, day and leap year.');
  return date.toISODate()!;
}
