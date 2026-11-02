#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { adapters } from '@logiparity/adapters';
import { compareEntities, consoleReport, errorText, loadConfig, reportExitCode, writeReports } from '@logiparity/core';
import { runScenario, scenarioConsole } from '@logiparity/scenarios';
import { basename } from 'node:path';
import { initConfig } from './init.js';

const help = `LogiParity 0.1.0 (M4) — data parity checks for TEST AND STAGING ENVIRONMENTS ONLY.

Usage: logiparity check --config <parity.yaml>
       logiparity scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>]
       logiparity init [--config <parity.yaml>]
       logiparity --help

Reads REST, CSV/XLSX, Playwright tables and read-only PostgreSQL sources. No telemetry.
The first source is the reference. Paths are relative to the configuration file.
Exit codes: 0 = parity, 1 = findings, 2 = configuration or runtime error.
Money must be decimal strings; tolerance is in integer minor units.
Outputs: console, HTML, JUnit XML, JSON, Markdown.
failOn: category list or allowed counts (e.g. {missing: 2}); runtime errors always exit 2.
init writes a commented starter config without overwriting an existing file.
`;

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({ options: { config: { type: 'string', short: 'c' }, target: { type: 'string' }, 'report-dir': { type: 'string' }, help: { type: 'boolean', short: 'h' } }, allowPositionals: true, strict: true });
  if (values.help) { process.stdout.write(help); return 0; }
  if (positionals.length === 3 && positionals[0] === 'scenario' && positionals[1] === 'run' && positionals[2] && values.target && !values.config) {
    const report = await runScenario(positionals[2], values.target, resolve(values['report-dir'] ?? `logiparity-scenario-report/${basename(positionals[2], '.yaml')}`));
    process.stdout.write(scenarioConsole(report));
    return report.exitCode;
  }
  if (values.target || values['report-dir']) throw new Error('Use scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>].');
  if (positionals.length === 1 && positionals[0] === 'init') {
    const destination = await initConfig(values.config ?? 'parity.yaml');
    process.stdout.write(`Created ${destination}. Set STAGING_API_URL, edit the source mappings and run logiparity check --config "${destination}". Test and staging only.\n`);
    return 0;
  }
  if (positionals.length !== 1 || positionals[0] !== 'check' || !values.config) throw new Error('Use logiparity check --config <parity.yaml> or logiparity init; see --help for usage.');
  const { config, baseDir } = await loadConfig(values.config);
  const report = await compareEntities(config.entities, (_, source) => adapters.read(source, { baseDir, env: process.env, reportDir: resolve(baseDir, config.report.dir) }));
  if (config.report.outputs.includes('console')) process.stdout.write(consoleReport(report));
  await writeReports(report, resolve(baseDir, config.report.dir), config.report.outputs, { entities: config.entities });
  return reportExitCode(report);
}

try { process.exitCode = await main(); }
catch (error) { process.stderr.write(`LogiParity: ${errorText(error)}\n`); process.exitCode = 2; }
