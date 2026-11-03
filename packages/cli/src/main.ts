#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { basename, resolve } from 'node:path';
import { adapters, validateConfig } from '@logiparity/adapters';
import {
  compareEntities,
  consoleReport,
  errorText,
  loadConfig,
  reportExitCode,
  writeReports,
  safeConsole,
  redactSecrets,
  secretValues,
} from '@logiparity/core';
import { runScenario, validateScenario, scenarioConsole } from '@logiparity/scenarios';
import { aiCommand } from './ai.js';
import { installBrowser } from './browser.js';
import { version } from './version.js';
import { initConfig } from './init.js';

let configuredSecrets = secretValues(undefined);
const output = (text: string) => process.stdout.write(safeConsole(redactSecrets(text, configuredSecrets)));
const help = `LogiParity ${version} — data parity checks for TEST AND STAGING ENVIRONMENTS ONLY.

Usage: logiparity demo [--bugs]
       logiparity install-browser
       logiparity check --config <parity.yaml>
       logiparity scenario validate <scenario.yaml> --target <target.yaml>
       logiparity scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>] [--allow-modules]
       logiparity ai suggest-config --openapi <spec.yaml> --entity <name>
       logiparity ai scenario --from <description>
       logiparity ai explain <report.json>
       logiparity init [--config <parity.yaml>]
       logiparity validate --config <parity.yaml> [--allow-missing-env]
       logiparity --version
       logiparity --help

Reads REST, CSV/XLSX, Playwright tables and read-only PostgreSQL sources. No telemetry.
The first source is the reference. Paths are relative to the configuration file.
Exit codes: 0 = parity, 1 = findings, 2 = configuration or runtime error.
Money defaults to decimal strings. Numeric input requires allowNumber: true.
Money tolerance uses integer minor units.
Outputs: console, HTML, JUnit XML, JSON, Markdown.
failOn: category list or allowed counts (e.g. {missing: 2}); runtime errors always exit 2.
AI commands preview locally by default. Add --send to call the explicitly configured provider.
AI options: --ai-config <ai.yaml>, --redact-fields <field,...> (repeatable), --output <new file>.
AI requires LOGIPARITY_AI_BASE_URL, LOGIPARITY_AI_MODEL and LOGIPARITY_AI_API_KEY for --send.
Drafts are marked for review, never overwritten or executed automatically.
init writes a commented starter config without overwriting an existing file.
`;

function commandHelp(commands: readonly string[]): string {
  const command = commands[0];
  if (command === 'scenario')
    return `Usage: logiparity scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>] [--allow-modules]\n       logiparity scenario validate <scenario.yaml> --target <target.yaml>\nValidation opens no sources and performs no mutations.\n`;
  if (command === 'check')
    return 'Usage: logiparity check --config <parity.yaml>\nCompare configured sources. Exit 0 for parity, 1 for findings, 2 for configuration or connection failures.\n';
  if (command === 'validate')
    return 'Usage: logiparity validate --config <parity.yaml> [--allow-missing-env]\nValidate mappings and environment references without opening sources. For targets use scenario validate.\n';
  if (command === 'init')
    return 'Usage: logiparity init [--config <parity.yaml>]\nCreate a starter without overwriting an existing file; then run validate and check.\n';
  if (command === 'install-browser')
    return 'Usage: logiparity install-browser\nInstall Chromium for the optional Playwright UI adapter.\n';
  if (command === 'demo') return 'Usage: logiparity demo [--bugs]\nRun the local synthetic delivery service.\n';
  if (command === 'ai')
    return 'Usage: logiparity ai suggest-config --openapi <spec> --entity <name>\n       logiparity ai scenario --from <description>\n       logiparity ai explain <report.json>\nPreview locally by default; --send requires an explicitly configured provider.\n';
  return help;
}
async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    options: {
      config: { type: 'string', short: 'c' },
      target: { type: 'string' },
      'report-dir': { type: 'string' },
      bugs: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      'allow-modules': { type: 'boolean' },
      'allow-missing-env': { type: 'boolean' },
      openapi: { type: 'string' },
      entity: { type: 'string' },
      from: { type: 'string' },
      output: { type: 'string' },
      'ai-config': { type: 'string' },
      'redact-fields': { type: 'string', multiple: true },
      send: { type: 'boolean' },
    },
    allowPositionals: true,
    strict: true,
  });
  if (values.help) {
    output(commandHelp(positionals));
    return 0;
  }
  if (values.version) {
    output(version + '\n');
    return 0;
  }
  if (positionals[0] === 'demo' && positionals.length === 1) {
    const { startDemo } = await import('@logiparity/demo-delivery');
    await startDemo({ allBugs: values.bugs === true, writeExample: true });
    return 0;
  }
  if (positionals[0] === 'install-browser' && positionals.length === 1) return installBrowser();
  if (positionals[0] === 'scenario' && positionals[1] === 'validate' && positionals[2] && values.target) {
    await validateScenario(positionals[2], values.target, process.env);
    output('The scenario configuration is valid. Sources were not opened and no mutations were performed.\n');
    return 0;
  }
  if (positionals[0] === 'scenario' && (!values.target || !positionals[2]))
    throw new Error(commandHelp(['scenario']).trim());
  if (values['allow-missing-env'] && positionals[0] !== 'validate')
    throw new Error('--allow-missing-env requires validate');
  if (positionals[0] === 'ai') return aiCommand(positionals.slice(1), values);
  if (
    values.openapi !== undefined ||
    values.entity !== undefined ||
    values.from !== undefined ||
    values.output !== undefined ||
    values['ai-config'] !== undefined ||
    values['redact-fields'] !== undefined ||
    values.send !== undefined
  )
    throw new Error('AI options require logiparity ai; see --help.');
  if (
    positionals.length === 3 &&
    positionals[0] === 'scenario' &&
    positionals[1] === 'run' &&
    positionals[2] &&
    values.target &&
    !values.config
  ) {
    const report = await runScenario(
      positionals[2],
      values.target,
      resolve(values['report-dir'] ?? `logiparity-scenario-report/${basename(positionals[2], '.yaml')}`),
      process.env,
      { allowModules: values['allow-modules'] === true },
    );
    output(scenarioConsole(report));
    return report.exitCode;
  }
  if (values['allow-modules']) throw new Error('--allow-modules requires scenario run');
  if (values.target || values['report-dir'])
    throw new Error('Use scenario run <scenario.yaml> --target <target.yaml> [--report-dir <dir>] [--allow-modules].');
  if (positionals.length === 1 && positionals[0] === 'init') {
    const destination = await initConfig(values.config ?? 'parity.yaml');
    output(
      `Created ${destination}. Set STAGING_API_URL and edit the source mappings. Run npx logiparity validate --config "${values.config ?? 'parity.yaml'}", then npx logiparity check --config "${values.config ?? 'parity.yaml'}". Test and staging only.\n`,
    );
    return 0;
  }
  if (positionals.length !== 1 || !['check', 'validate'].includes(positionals[0] ?? '') || !values.config)
    throw new Error('Use logiparity check --config <parity.yaml> or logiparity init; see --help for usage.');
  const { config, baseDir, missingEnv, warnings } = await loadConfig(values.config, process.env, {
    allowMissingEnv: values['allow-missing-env'] === true,
    command: positionals[0] === 'validate' ? 'validate' : 'check',
  });
  configuredSecrets = secretValues(config);
  for (const warning of positionals[0] === 'validate' || !config.report.outputs.includes('console') ? warnings : [])
    process.stderr.write(safeConsole(redactSecrets(`Warning: ${warning}\n`, configuredSecrets)));
  validateConfig(config);
  if (positionals[0] === 'validate') {
    output(
      `The configuration is valid.${missingEnv.length ? ` Missing environment allowed: ${missingEnv.join(', ')}.` : ''} Source availability was not checked.\n`,
    );
    return 0;
  }
  const report = await compareEntities(
    config.entities,
    (_, source, context) =>
      adapters.read(source, {
        baseDir,
        ...(config.allowedHosts ? { allowedHosts: config.allowedHosts } : {}),
        env: process.env,
        reportDir: resolve(baseDir, config.report.dir),
        warn: (message) => {
          context.warn(message);
          process.stderr.write(safeConsole(redactSecrets(`Warning: ${message}`, configuredSecrets)) + '\n');
        },
      }),
    process.env,
    { patterns: config.patterns, maxInvalidRows: config.maxInvalidRows },
  );
  if (warnings.length) report.warnings = [...warnings.map((message) => ({ message })), ...(report.warnings ?? [])];
  if (config.report.outputs.includes('console'))
    output(consoleReport(report, { entities: config.entities, displayTimezone: config.report.displayTimezone }));
  await writeReports(report, resolve(baseDir, config.report.dir), config.report.outputs, {
    entities: config.entities,
    displayTimezone: config.report.displayTimezone,
    environment: config.environment,
    configFile: basename(values.config),
    generatedAt: new Date().toISOString(),
  });
  return reportExitCode(report);
}

try {
  process.exitCode = await main();
} catch (error) {
  const message = safeConsole(redactSecrets(errorText(error), configuredSecrets));
  process.stderr.write(`LogiParity: ${message}\n`);
  process.exitCode = 2;
}
