import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = process.env.LOGIPARITY_REPORT_SCHEMA_ROOT ?? fileURLToPath(new URL('../docs/', import.meta.url));
const parity = JSON.parse(readFileSync(resolve(directory, 'report-schema.json'), 'utf8'));
const scenario = JSON.parse(readFileSync(resolve(directory, 'scenario-report-schema.json'), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validators = { parity: ajv.compile(parity) };
validators.scenario = ajv.compile(scenario);
/** Development-only validation: this script is excluded from the CLI package. */
export function assertReport(value) {
  const serialized = JSON.parse(
    JSON.stringify(value, (_, item) => (typeof item === 'bigint' ? item.toString() : item)),
  );
  const kind = serialized.kind === 'scenario' ? 'scenario' : 'parity';
  const validate = validators[kind];
  if (!validate(serialized))
    throw new Error(`${kind} report violates its published schema: ${ajv.errorsText(validate.errors)}`);
}
export function parseCheckedJson(...args) {
  const value = JSON.parse(...args);
  if (
    value &&
    value.schemaVersion === 1 &&
    (value.kind === 'scenario' || (Array.isArray(value.findings) && Array.isArray(value.entities)))
  )
    assertReport(value);
  return value;
}
export async function checkedReport(pending) {
  const report = await pending;
  assertReport(report);
  return report;
}
