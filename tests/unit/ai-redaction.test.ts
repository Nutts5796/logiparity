import { expect, it } from 'vitest';
import { redactInput, redacted } from '@logiparity/ai';

it('masks default secrets recursively and scrubs copied values without mutating the input', () => {
  const input = { Authorization: 'Bearer private-token', nested: [{ password: 'p[a]ss', note: 'copied p[a]ss and Bearer private-token' }], plain: 'visible' };
  const original = structuredClone(input); const result = redactInput(input);
  expect(result.data).toEqual({ Authorization: redacted, nested: [{ password: redacted, note: `copied ${redacted} and ${redacted}` }], plain: 'visible' });
  expect(result.count).toBe(2); expect(input).toEqual(original);
});
it('understands finding field names, masks values, and removes aliases from messages', () => {
  const result = redactInput({ report: { findings: [{ field: 'customer_email', expected: 'alice@example.test', actual: 'bob@example.test', message: 'alice@example.test differs from bob@example.test' }, { field: 'status', expected: 'delivered', actual: 'in_transit' }] } }, ['CUSTOMER_EMAIL']);
  expect(JSON.stringify(result.data)).not.toContain('@example.test'); expect(JSON.stringify(result.data)).toContain('delivered'); expect(result.count).toBe(2);
});
it('supports exact property/index/wildcard paths and subtrees', () => {
  const result = redactInput({ rows: [{ id: 'C100', note: 'C100 account' }, { id: 'C200', note: 'C200 account' }], customer: { email: 'private@example.test' }, count: 2 }, ['$.rows[*].id', "$['customer']"]);
  expect(result.data).toEqual({ rows: [{ id: redacted, note: `${redacted} account` }, { id: redacted, note: `${redacted} account` }], customer: redacted, count: 2 });
});
it('scrubs explicitly supplied credential literals including copies in object keys', () => {
  const result = redactInput({ 'key-fixture-token': 'text fixture-token' }, [], ['fixture-token']);
  expect(result.data).toEqual({ [`key-${redacted}`]: redacted }); expect(result.scrub('fixture-token echoed by a provider')).toBe(`${redacted} echoed by a provider`);
});
it.each(['$..key', '$.rows[?(@.secret)]', '$'])('rejects unsupported redaction expression %s before sending', (path) => expect(() => redactInput({}, [path])).toThrow());
it('fails closed if redaction would exceed its bounded sensitive-value budget', () => {
  expect(() => redactInput({ secret: Array.from({ length: 5001 }, (_, i) => `value-${i}`) })).toThrow('Too many sensitive values');
});
it('preserves nulls and exact numeric encodings while masking selected scalar values', () => {
  const result = redactInput({ customer: 123, note: 'Customer 123', flag: false, total: '900719925474099301', empty: null }, ['customer']);
  expect(result.data).toEqual({ customer: redacted, note: `Customer ${redacted}`, flag: false, total: '900719925474099301', empty: null });
});
