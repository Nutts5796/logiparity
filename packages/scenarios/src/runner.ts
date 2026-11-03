import { mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { basename, join, resolve } from 'node:path';
import { adapters, validateConfig } from '@logiparity/adapters';
import {
  compareEntities,
  loadConfig,
  reportExitCode,
  writeReports,
  errorText,
  humanize,
  shortSecretWarnings,
  redactSecrets,
  redactTree,
  secretValues,
} from '@logiparity/core';
import { scenarioFixture } from './preflight.js';
import { loadScenario, loadTarget } from './config.js';
import { affectedBy, prepareInvariant, type Snapshot } from './invariants.js';
import {
  canonicalFor,
  cancelledBy,
  needsAffected,
  requiredStateSources,
  validateStateMappings,
  validateState,
} from './state.js';
import { requestPlan, sendRequest, targetHeaders } from './http.js';
import { writeScenarioReport, type ScenarioReport } from './report.js';

export async function runScenario(
  scenarioFile: string,
  targetFile: string,
  reportDir: string,
  env: NodeJS.ProcessEnv = process.env,
  options: { allowModules?: boolean } = {},
): Promise<ScenarioReport> {
  const { scenario, baseDir } = await loadScenario(scenarioFile, env);
  const { target, baseDir: targetDir } = await loadTarget(targetFile, env);
  if (scenario.target !== target.name) throw new Error('Scenario target name does not match the selected target file');
  const secrets = secretValues({ scenario, target }, env);
  try {
    const wait = scenario.wait && 'source' in scenario.wait ? scenario.wait : undefined;
    validateStateMappings(target.state, scenario.invariants, scenario.events);
    const required = requiredStateSources(scenario.invariants, scenario.events);
    for (const source of required)
      if (!target.state[source])
        throw new Error(
          `Selected invariants require state.${source}; configure that source or select fewer invariants.`,
        );
    const custom = scenario.invariants.some((i) => typeof i === 'object' && !('sla_window_violations' in i));
    const stateNames = [
      ...new Set([...(custom ? Object.keys(target.state) : required), ...(wait ? [wait.source] : [])]),
    ];
    const warnings = new Set<string>(shortSecretWarnings([scenario, target], env));
    if (scenario.invariants.every((invariant) => invariant === 'no_order_lost' || invariant === 'single_assignment'))
      warnings.add(
        'These invariants cannot detect a replan that never ran. Add affected_reassigned to verify reassignment. See https://github.com/Nutts5796/logiparity/blob/main/docs/scenarios.md#reassignment-and-validation',
      );
    const warn = (message: string) => {
      if (!warnings.has(message)) {
        warnings.add(message);
      }
    };
    if (wait && !target.state[wait.source]) throw new Error(`Missing wait state source ${wait.source}`);
    const fixture: unknown = scenario.setup ? await scenarioFixture(baseDir, scenario.setup.fixture) : undefined;
    if (scenario.setup && !target.setup) throw new Error('Scenario fixture requires target.setup');
    const checks = await Promise.all(
      scenario.invariants.map((i) => prepareInvariant(i, baseDir, options.allowModules)),
    );
    const headers = targetHeaders(target, env);
    const setup = scenario.setup && target.setup ? requestPlan(target, target.setup, { fixture }) : undefined;
    const events = [...scenario.events]
      .sort((a, b) => a.step - b.step)
      .map((event) => {
        const template = target.events[event.type];
        if (!template) throw new Error(`Target has no mapping for ${event.type}`);
        return { event, plan: requestPlan(target, template, { params: event.params, step: event.step }) };
      });
    const replan = target.replan ? requestPlan(target, target.replan, {}) : undefined;
    if (target.clock && wait) requestPlan(target, target.clock.advance, { seconds: wait.pollSeconds });
    const artifacts = target.artifacts.map((a) => ({
      ...a,
      plan: requestPlan(target, { method: 'GET', path: a.path }, {}),
    }));
    const artifactDir = resolve(reportDir, 'artifacts');
    const parityEnv = { ...env, LOGIPARITY_SCENARIO_ARTIFACT_DIR: artifactDir };
    const parity = scenario.afterwards
      ? await loadConfig(resolve(baseDir, scenario.afterwards.parity), parityEnv)
      : undefined;
    if (parity) validateConfig(parity.config);
    const report: ScenarioReport = {
      schemaVersion: 1,
      kind: 'scenario',
      name: scenario.name,
      target: target.name,
      environment: target.environment,
      synthetic: target.name === 'demo',
      sourceLabels: Object.fromEntries(stateNames.map((name) => [name, target.state[name]?.label ?? humanize(name)])),
      events: events.map(({ event }) => ({ step: event.step, type: event.type, completed: false })),
      invariants: [],
      warnings: [],
      exitCode: 2,
    };
    const read = async (names = stateNames): Promise<Snapshot> => {
      const state: Snapshot = {};
      for (const name of names) {
        const source = target.state[name];
        if (!source) throw new Error(`Missing state source ${name}`);
        state[name] = [];
        for await (const row of adapters.read(source, {
          baseDir: targetDir,
          env,
          reportDir,
          warn,
          allowedHosts: target.allowedHosts,
        }))
          state[name].push(row);
      }
      return state;
    };
    const send = async (plan: ReturnType<typeof requestPlan>) => {
      const response = await sendRequest(plan, target, headers);
      await response.body?.cancel();
    };
    try {
      if (setup) await send(setup);
      const before = await read();
      validateState(before, scenario.invariants, scenario.events);
      const affected = needsAffected(scenario.invariants)
        ? affectedBy(canonicalFor(before, scenario.invariants, scenario.events), scenario.events)
        : {
            affectedKeys: [],
            cancelledKeys: scenario.invariants.includes('single_assignment')
              ? cancelledBy(canonicalFor(before, ['single_assignment']).orders, scenario.events)
              : [],
          };
      report.affectedOrderCount = affected.affectedKeys.length;
      for (const [index, { plan }] of events.entries()) {
        await send(plan);
        report.events[index]!.completed = true;
      }
      if (replan) await send(replan);
      if (scenario.wait && 'seconds' in scenario.wait) {
        const milliseconds = scenario.wait.seconds * 1000;
        await new Promise((done) => setTimeout(done, milliseconds));
      }
      const deadline = Date.now() + (wait?.timeoutSeconds ?? 0) * 1000;
      let virtualElapsed = 0;
      while (wait) {
        const state = (await read([wait.source]))[wait.source];
        if (
          state?.length === 1 &&
          Object.entries(wait.until).every(([key, value]) => Object.hasOwn(state[0]!, key) && state[0]![key] === value)
        )
          break;
        if (Date.now() >= deadline || virtualElapsed >= wait.timeoutSeconds)
          throw new Error(`Timed out waiting for state.${wait.source} completion after ${wait.timeoutSeconds}s`);
        const seconds = Math.min(wait.pollSeconds, wait.timeoutSeconds - virtualElapsed);
        if (target.clock) {
          await send(requestPlan(target, target.clock.advance, { seconds }));
          virtualElapsed += seconds;
        } else
          await new Promise((done) => setTimeout(done, Math.min(seconds * 1000, Math.max(0, deadline - Date.now()))));
      }
      const after = await read();
      for (const check of checks)
        report.invariants.push(await check({ before, after, events: scenario.events, ...affected }));
      if (parity) {
        await mkdir(artifactDir, { recursive: true });
        for (const artifact of artifacts) {
          const response = await sendRequest(artifact.plan, target, headers);
          if (!response.body) throw new Error('Empty artifact response');
          await pipeline(
            Readable.fromWeb(response.body as import('node:stream/web').ReadableStream),
            createWriteStream(join(artifactDir, artifact.file)),
          );
        }
        const directory = resolve(reportDir, 'parity');
        report.parity = await compareEntities(
          parity.config.entities,
          (_, source, context) =>
            adapters.read(source, {
              baseDir: parity.baseDir,
              env: parityEnv,
              ...(parity.config.allowedHosts ? { allowedHosts: parity.config.allowedHosts } : {}),
              reportDir: directory,
              warn: (message) => {
                context.warn(message);
                warn(message);
              },
            }),
          parityEnv,
          { patterns: parity.config.patterns, maxInvalidRows: parity.config.maxInvalidRows },
        );
        await writeReports(report.parity, directory, ['html', 'json', 'markdown', 'junit'], {
          entities: parity.config.entities,
          displayTimezone: parity.config.report.displayTimezone,
          environment: parity.config.environment,
          configFile: basename(scenario.afterwards!.parity),
          generatedAt: new Date().toISOString(),
        });
      }
      report.exitCode =
        report.parity && reportExitCode(report.parity) === 2
          ? 2
          : report.invariants.some((i) => !i.passed) || (report.parity && reportExitCode(report.parity) === 1)
            ? 1
            : 0;
    } catch (error) {
      report.error = redactSecrets(errorText(error), secrets);
      report.exitCode = 2;
    }
    report.warnings = [...warnings].map((message) => redactSecrets(message, secrets));
    const redactedReport = redactTree(report, secrets);
    await writeScenarioReport(redactedReport, reportDir);
    return redactedReport;
  } catch (error) {
    throw new Error(redactSecrets(errorText(error), secrets));
  }
}
