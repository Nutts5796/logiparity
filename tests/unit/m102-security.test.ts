import { expect, it } from 'vitest';
import {
  assertAllowedHost,
  validAllowedHost,
  consoleReport,
  htmlReport,
  markdownReport,
  junitReport,
  jsonReport,
  redactSecrets,
  type Report,
} from '@logiparity/core';
import { redactInput } from '@logiparity/ai';
it('compares effective scheme ports and bracketed IPv6, with case-insensitive hosts (sam)', () => {
  expect(() => assertAllowedHost('https://127.0.0.1', ['127.0.0.1:80'])).toThrow(/allowedHosts/);
  expect(() => assertAllowedHost('https://127.0.0.1', ['127.0.0.1:443'])).not.toThrow();
  expect(() => assertAllowedHost('postgres://ALLOWED.TEST/db', ['allowed.test:5432'])).not.toThrow();
  expect(() => assertAllowedHost('http://[::1]:80', ['[::1]:80'])).not.toThrow();
  for (const host of ['*.test', ':0', '127.0.0.1:0', 'socket:']) expect(validAllowedHost(host)).toBe(false);
});
it.each(['\u034f', '\ufe0f', '\u3164', '\u2028'])(
  'redacts secrets split by default-ignorable %s before every writer',
  (separator) => {
    const secret = 'SensitiveToken123456',
      split = secret.slice(0, 5) + separator + secret.slice(5);
    expect(redactSecrets(split, [secret])).toBe('[REDACTED]');
  },
);
it('normalizes known credentials before scrubbing unlabeled provider text', () => {
  const redaction = redactInput({ password: 'SensitiveToken123456' });
  expect(redaction.scrub('Sensitive\ufe0fToken123456')).toBe('[REDACTED]');
  expect(redaction.scrub('Sensitive\u2028Token123456')).toBe('[REDACTED]');
});
it('removes C0/C1 controls and line separators in every report format (sam)', () => {
  const dirty = 'a\u001bb\u0007c\bD\u009bE\u2028F';
  const report: Report = {
    schemaVersion: 1,
    entities: [],
    findings: [{ type: 'source_error', entity: 'order', source: 'b', key: '', field: '', message: dirty }],
  };
  for (const render of [consoleReport, htmlReport, markdownReport, junitReport, jsonReport])
    for (const char of ['\u001b', '\u0007', '\b', '\u009b', '\u2028']) expect(render(report)).not.toContain(char);
});
it.each(['HTTP://STAGING-Secret-Host.invalid:03091', 'http://2130706433:3091', 'http://例え.test:3091'])(
  'redacts canonical URL variants of %s',
  (url) => {
    expect(redactSecrets(new URL(url).href, [url])).toBe('[REDACTED]');
  },
);
const secret = 'HiddenCredential12345';
it.each([
  `--password=${secret}`,
  `--password ${secret}`,
  `--token=${secret}`,
  `-p${secret}`,
  `{\\"token\\":\\"${secret}\\"}`,
  `"password":\n "${secret}"`,
  `<password>${secret}</password>`,
  `"api key": "${secret}"`,
  `password: ${secret} with spaces`,
  `Basic ${Buffer.from(secret).toString('base64')}`,
  `-----BEGIN PRIVATE KEY-----\n${secret}\n-----END PRIVATE KEY-----`,
  `password\u00a0:\u00a0${secret}`,
  `password\uff1a ${secret}`,
])('scrubs and idempotently re-scrubs the new credential form %s', (input) => {
  const once = redactInput(input).data as string;
  expect(once).not.toContain(secret);
  expect(once).not.toContain(Buffer.from(secret).toString('base64'));
  expect(once).not.toContain('with spaces');
  expect(redactInput(once).data).toBe(once);
});
