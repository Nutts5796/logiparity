import Ajv from 'ajv';
import { readFileSync } from 'node:fs';
import type { Report } from '@logiparity/core';
// Source workspaces and installed lib/<package>/dist have the same relative depth.
const schema = JSON.parse(readFileSync(new URL('../../../docs/report-schema.json', import.meta.url), 'utf8'));
const ajv = new Ajv({ allErrors: true });
const validate = ajv.compile(schema);
export function parityReport(input: unknown, file: string): Report {
  if (!validate(input))
    throw new Error(
      `${file}: expected a Parity schemaVersion: 1 report.json. For scenario reports use parity/report.json. Check paths: ${(
        validate.errors ?? []
      )
        .slice(0, 5)
        .map((error) => error.dataPath || '<root>')
        .join(', ')}.`,
    );
  return input as Report;
}
