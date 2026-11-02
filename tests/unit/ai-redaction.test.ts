import { expect, it } from 'vitest';
import { redactInput, redacted } from '@logiparity/ai';

it('masks default secrets recursively and scrubs copied values without mutating the input', () => {
  const input = { Authorization: 'Bearer private-token', nested: [{ password: 'long-p[a]ss', note: 'copied long-p[a]ss and Bearer private-token' }], plain: 'visible' };
  const original = structuredClone(input); const result = redactInput(input);
  expect(result.data).toEqual({ Authorization: redacted, nested: [{ password: redacted, note: `copied ${redacted} and Bearer ${redacted}` }], plain: 'visible' });
  expect(result.count).toBe(3); expect(input).toEqual(original);
});
it('understands finding field names, masks values, and removes aliases from messages', () => {
  const result = redactInput({ report: { findings: [{ field: 'customer_email', expected: 'alice@example.test', actual: 'bob@example.test', message: 'alice@example.test differs from bob@example.test' }, { field: 'status', expected: 'delivered', actual: 'in_transit' }] } }, ['CUSTOMER_EMAIL']);
  expect(JSON.stringify(result.data)).not.toContain('@example.test'); expect(JSON.stringify(result.data)).toContain('delivered'); expect(result.count).toBe(2);
});
it('supports exact property/index/wildcard paths and subtrees', () => {
  const result = redactInput({ rows: [{ id: 'CUSTOMER100', note: 'CUSTOMER100 account' }, { id: 'CUSTOMER200', note: 'CUSTOMER200 account' }], customer: { email: 'private@example.test' }, count: 2 }, ['$.rows[*].id', "$['customer']"]);
  expect(result.data).toEqual({ rows: [{ id: redacted, note: `${redacted} account` }, { id: redacted, note: `${redacted} account` }], customer: redacted, count: 2 });
});
it('scrubs explicitly supplied credential literals including copies in object keys', () => {
  const result = redactInput({ 'key-fixture-token': 'text fixture-token' }, [], ['fixture-token']);
  expect(result.data).toEqual({ [`key-${redacted}`]: redacted }); expect(result.scrub('fixture-token echoed by a provider')).toBe(`${redacted} echoed by a provider`);
});
it.each(['$..key', '$.rows[?(@.secret)]', '$'])('rejects unsupported redaction expression %s before sending', (path) => expect(() => redactInput({}, [path])).toThrow());
it('fails closed if redaction would exceed its bounded sensitive-value budget', () => {
  expect(() => redactInput({ secret: Array.from({ length: 5001 }, (_, i) => `secret-value-${i}`) })).toThrow('Too many sensitive values');
});
it('preserves nulls and exact numeric encodings while masking selected scalar values', () => {
  const result = redactInput({ customer: 123, note: 'Customer 123', flag: false, total: '900719925474099301', empty: null }, ['customer']);
  expect(result.data).toEqual({ customer: redacted, note: 'Customer 123', flag: false, total: '900719925474099301', empty: null });
});

it('masks expanded credential names without globally scrubbing short values or numbers', () => {
  const input = { passwd:'password-long', pwd:'short', private_key:'private-key-long', credential:'credential-long', jwt:'jwt-token-long', subscription_key:'subscription-long', 'api.key':'api-key-long', auth_retries:1, id:'L1001', note:'short 1 password-long' };
  const result=redactInput(input); const data=result.data as Record<string,unknown>;
  for(const name of ['passwd','pwd','private_key','credential','jwt','subscription_key','api.key','auth_retries']) expect(data[name]).toBe(redacted);
  expect(data.id).toBe('L1001'); expect(data.note).toBe(`short 1 ${redacted}`);
  expect(redactInput({id:'L1001', note:'tiny'},[],['1','tiny']).data).toEqual({id:'L1001',note:'tiny'});
});
it.each(['key','sig','signature','X-Amz-Signature','X-Amz-Credential','access_token'])('masks URL query and fragment credential %s and provider echoes', name=>{
  const result=redactInput({url:`https://user:password-long@example.test/?${name}=query-secret#${name}=fragment-secret`,note:'Bearer bearer-secret'});
  const text=JSON.stringify(result.data); for(const secret of ['password-long','query-secret','fragment-secret','bearer-secret']) {expect(text).not.toContain(secret);expect(result.scrub(`echo ${secret}`)).toBe(`echo ${redacted}`);}
  expect(result.scrub('https://u:pw@example.test/?sig=x#key=y Bearer tiny')).toBe(`https://u:${redacted}@example.test/?sig=${redacted}#key=${redacted} Bearer ${redacted}`);
});
