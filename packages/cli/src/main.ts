#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { adapters } from '@logiparity/adapters';
import { compareEntities, consoleReport, errorText, loadConfig, reportExitCode, writeJsonReport } from '@logiparity/core';

const help = `LogiParity 0.1.0 (M1) — data parity checks for TEST AND STAGING ENVIRONMENTS ONLY.

Usage: logiparity check --config <parity.yaml>
       logiparity --help

Reads configured REST sources with GET and local CSV/XLSX files. No telemetry.
The first source is the reference. Paths are relative to the configuration file.
Exit codes: 0 = parity, 1 = findings, 2 = configuration or runtime error.
Money must be decimal strings; tolerance is in integer minor units.
HTML/JUnit/Markdown, aggregates and failOn are planned for M2.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: { config: { type: 'string', short: 'c' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  if (values.help) { process.stdout.write(help); return 0; }
  if (positionals.length !== 1 || positionals[0] !== 'check' || !values.config) throw new Error('Use logiparity check --config <parity.yaml>, or --help for usage.');
  const { config, baseDir } = await loadConfig(values.config);
  const report = await compareEntities(config.entities, (_, source) => adapters.read(source, { baseDir, env: process.env }));
  if (config.report.outputs.includes('console')) process.stdout.write(consoleReport(report));
  if (config.report.outputs.includes('json')) await writeJsonReport(report, resolve(baseDir, config.report.dir));
  return reportExitCode(report);
}

try { process.exitCode = await main(); }
catch (error) { process.stderr.write(`LogiParity: ${errorText(error)}\n`); process.exitCode = 2; }
