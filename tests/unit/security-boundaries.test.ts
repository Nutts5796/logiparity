import { expect, it } from 'vitest';
import { secretValues, redactSecrets, safeConsole, assertAllowedHost } from '@logiparity/core';
import { redactInput } from '@logiparity/ai';
import { requestPlan, renderTemplate } from '../../packages/scenarios/src/http.js';
import { targetSchema } from '@logiparity/scenarios';
const target = targetSchema.parse({
  version: 1,
  name: 'staging',
  environment: 'staging',
  allowMutations: true,
  allowedHosts: ['example.test'],
  baseUrl: 'https://example.test/api/v1/',
  events: {},
  state: { orders: { type: 'csv', file: 'unused', fields: { id: 'ID' } } },
});
it.each(['.\t./admin', ' ../admin', '..;/admin', '.;/admin', '..%00/admin', '..%20/admin', '%252e%252e/admin'])(
  'rejects the base-path bypass %s',
  (path) => expect(() => requestPlan(target, { method: 'POST', path }, {})).toThrow(),
);
it('encodes exact placeholders and confines resolved paths to the target prefix', () => {
  const plan = requestPlan(target, { method: 'POST', path: '{{params.p}}' }, { params: { p: '/internal/delete-all' } });
  expect(plan.url.pathname).toBe('/api/v1/%2Finternal%2Fdelete-all');
  expect(() => requestPlan(target, { method: 'POST', path: '{{params.p}}' }, { params: { p: ' ../admin' } })).toThrow(
    'whitespace',
  );
  expect(renderTemplate('{{params.n}}', { params: { n: 12 } })).toBe(12);
});
it('treats URL/path/header bindings as sensitive unless explicitly public', () => {
  const env = {
    CARRIER_KEY: 'carrier-key-123',
    DB_PASS: 'password-123',
    TMS_SIG: 'signature-123',
    PLAIN_ID: 'public-id-123',
  };
  const config = { sources: { api: { path: '/fail/${CARRIER_KEY}/${DB_PASS}/${TMS_SIG}/${PLAIN_ID}' } } };
  expect(secretValues(config, env)).toEqual(expect.arrayContaining(Object.values(env)));
  expect(secretValues({ ...config, publicEnv: ['PLAIN_ID'] }, env)).not.toContain(env.PLAIN_ID);
});
it('protects schema paths and file names while masking short whole data/URL/header values', () => {
  const secret = ['config'];
  expect(redactSecrets('entities[0].compare.config /config-dir/config.yaml', secret)).toBe(
    'entities[0].compare.config /config-dir/config.yaml',
  );
  expect(redactSecrets('https://example.test/config/orders', secret)).toContain('/[REDACTED]/');
  expect(redactSecrets('Authorization: Bearer config', secret)).toBe('Authorization: Bearer [REDACTED]');
  expect(redactSecrets('config', secret, 'data')).toBe('[REDACTED]');
  expect(redactSecrets('configuration', secret, 'data')).toBe('configuration');
});
it('collects the Basic credential encoding and strips invisible controls', () => {
  const values = secretValues(
    { auth: { type: 'basic', usernameEnv: 'USER', passwordEnv: 'PASS' } },
    { USER: 'test', PASS: 'longpassword' },
  );
  expect(values).toContain(Buffer.from('test:longpassword').toString('base64'));
  expect(safeConsole('a\u200bb\ufeffc')).toBe('abc');
});
it.each([
  '{"password":"SecretPwd123"}',
  '"Authorization": "Basic c2VjcmV0OnBhc3M="',
  'Authorization: Digest username="alice", response="digest-secret-123", nonce="nonce-secret-123"',
  'bearer: tok',
  'mysql://u:p@ss@h',
])('masks credential forms in free text: %s', (text) => {
  const redaction = redactInput({ message: text });
  const output = JSON.stringify(redaction.data);
  for (const credential of ['SecretPwd123', 'c2VjcmV0OnBhc3M=', 'digest-secret-123', 'nonce-secret-123', 'tok', 'p@ss'])
    expect(output.includes(credential)).toBe(false);
  expect(output).toContain('[REDACTED]');
});
it('blocks disallowed hosts before connecting', () => {
  expect(() => assertAllowedHost('https://evil.test/api', ['staging.test'])).toThrow('No request was sent');
  expect(() => assertAllowedHost('postgres://u:p@localhost/db', ['localhost'])).not.toThrow();
  expect(targetSchema.safeParse({ ...target, allowedHosts: undefined }).success).toBe(false);
});
