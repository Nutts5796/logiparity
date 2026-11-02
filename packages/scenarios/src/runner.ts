import { readFile, mkdir } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { join, resolve } from 'node:path';
import { adapters } from '@logiparity/adapters';
import { compareEntities, loadConfig, reportExitCode, writeReports, errorText } from '@logiparity/core';
import { loadScenario, loadTarget } from './config.js';
import { affectedBy, canonical, prepareInvariant, type Snapshot } from './invariants.js';
import { requestPlan, sendRequest, targetHeaders } from './http.js';
import { writeScenarioReport, type ScenarioReport } from './report.js';

export async function runScenario(scenarioFile: string, targetFile: string, reportDir: string, env: NodeJS.ProcessEnv = process.env): Promise<ScenarioReport> {
  const { scenario, baseDir } = await loadScenario(scenarioFile, env);
  const { target, baseDir: targetDir } = await loadTarget(targetFile, env);
  if (scenario.target !== target.name) throw new Error('Scenario target name does not match the selected target file');
  if (!target.state[scenario.wait.source]) throw new Error(`Missing wait state source ${scenario.wait.source}`);
  const fixture: unknown = scenario.setup ? JSON.parse(await readFile(resolve(baseDir, scenario.setup.fixture), 'utf8')) : undefined;
  if (scenario.setup && !target.setup) throw new Error('Scenario fixture requires target.setup');
  const checks = await Promise.all(scenario.invariants.map((i) => prepareInvariant(i, baseDir)));
  const headers = targetHeaders(target, env);
  const setup = scenario.setup && target.setup ? requestPlan(target, target.setup, { fixture }) : undefined;
  const events = [...scenario.events].sort((a, b) => a.step - b.step).map((event) => {
    const template = target.events[event.type]; if (!template) throw new Error(`Target has no mapping for ${event.type}`);
    return { event, plan: requestPlan(target, template, { params: event.params, step: event.step }) };
  });
  const replan = target.replan ? requestPlan(target, target.replan, {}) : undefined;
  if (target.clock) requestPlan(target, target.clock.advance, { seconds: scenario.wait.pollSeconds });
  const artifacts = target.artifacts.map((a) => ({ ...a, plan: requestPlan(target, { method: 'GET', path: a.path }, {}) }));
  const artifactDir = resolve(reportDir, 'artifacts');
  const parityEnv = { ...env, LOGIPARITY_SCENARIO_ARTIFACT_DIR: artifactDir };
  const parity = scenario.afterwards ? await loadConfig(resolve(baseDir, scenario.afterwards.parity), parityEnv) : undefined;
  const report: ScenarioReport = { schemaVersion: 1, kind: 'scenario', name: scenario.name, target: target.name, environment: target.environment, events: events.map(({ event }) => ({ step: event.step, type: event.type, completed: false })), invariants: [], exitCode: 2 };
  const read = async (names = Object.keys(target.state)): Promise<Snapshot> => {
    const state: Snapshot = {};
    for (const name of names) {
      const source = target.state[name]; if (!source) throw new Error(`Missing state source ${name}`);
      state[name] = [];
      for await (const row of adapters.read(source, { baseDir: targetDir, env, reportDir })) state[name].push(row);
    }
    return state;
  };
  const send = async (plan: ReturnType<typeof requestPlan>) => { const response = await sendRequest(plan, target, headers); await response.body?.cancel(); };
  try {
    if (setup) await send(setup);
    const before = await read();
    const usesBuiltins = scenario.invariants.some((i) => typeof i === 'string' || 'sla_window_violations' in i);
    const affected = usesBuiltins ? affectedBy(canonical(before), scenario.events) : { affectedKeys: [], cancelledKeys: [] };
    for (const [index, { plan }] of events.entries()) { await send(plan); report.events[index]!.completed = true; }
    if (replan) await send(replan);
    const deadline = Date.now() + scenario.wait.timeoutSeconds * 1000;
    let virtualElapsed = 0;
    while (true) {
      const state = (await read([scenario.wait.source]))[scenario.wait.source];
      if (state?.length === 1 && Object.entries(scenario.wait.until).every(([key, value]) => Object.hasOwn(state[0]!, key) && state[0]![key] === value)) break;
      if (Date.now() >= deadline || virtualElapsed >= scenario.wait.timeoutSeconds) throw new Error(`Timed out waiting for state.${scenario.wait.source} completion after ${scenario.wait.timeoutSeconds}s`);
      const seconds = Math.min(scenario.wait.pollSeconds, scenario.wait.timeoutSeconds - virtualElapsed);
      if (target.clock) { await send(requestPlan(target, target.clock.advance, { seconds })); virtualElapsed += seconds; }
      else await new Promise((done) => setTimeout(done, Math.min(seconds * 1000, Math.max(0, deadline - Date.now()))));
    }
    const after = await read();
    for (const check of checks) report.invariants.push(await check({ before, after, events: scenario.events, ...affected }));
    if (parity) {
      await mkdir(artifactDir, { recursive: true });
      for (const artifact of artifacts) {
        const response = await sendRequest(artifact.plan, target, headers);
        if (!response.body) throw new Error('Empty artifact response');
        await pipeline(Readable.fromWeb(response.body as import('node:stream/web').ReadableStream), createWriteStream(join(artifactDir, artifact.file)));
      }
      const directory = resolve(reportDir, 'parity');
      report.parity = await compareEntities(parity.config.entities, (_, source) => adapters.read(source, { baseDir: parity.baseDir, env: parityEnv, reportDir: directory }));
      await writeReports(report.parity, directory, ['html', 'json', 'markdown', 'junit'], { entities: parity.config.entities });
    }
    report.exitCode = report.parity && reportExitCode(report.parity) === 2 ? 2 : report.invariants.some((i) => !i.passed) || report.parity && reportExitCode(report.parity) === 1 ? 1 : 0;
  } catch (error) { report.error = errorText(error); report.exitCode = 2; }
  await writeScenarioReport(report, reportDir);
  return report;
}
