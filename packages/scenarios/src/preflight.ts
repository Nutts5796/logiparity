import { realpath, readFile } from 'node:fs/promises';
import { resolve, relative, isAbsolute } from 'node:path';
import { loadScenario, loadTarget } from './config.js';
import { requiredStateSources, validateStateMappings } from './state.js';
import { requestPlan } from './http.js';
import { validateSource } from '@logiparity/adapters';
export async function scenarioFixture(baseDir: string, file: string): Promise<unknown> {
  const root = await realpath(baseDir),
    entry = await realpath(resolve(baseDir, file));
  const path = relative(root, entry);
  if (isAbsolute(file) || path === '..' || path.startsWith('../') || isAbsolute(path))
    throw new Error('setup.fixture must stay within the scenario directory, including symlinks.');
  return JSON.parse(await readFile(entry, 'utf8')) as unknown;
}
export async function validateScenario(
  scenarioFile: string,
  targetFile: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const { scenario, baseDir } = await loadScenario(scenarioFile, env);
  const { target } = await loadTarget(targetFile, env);
  if (scenario.target !== target.name) throw new Error('Scenario target name does not match the target file.');
  validateStateMappings(target.state, scenario.invariants, scenario.events);
  for (const name of requiredStateSources(scenario.invariants, scenario.events)) {
    const source = target.state[name];
    if (source) validateSource(source);
  }
  const fixture = scenario.setup ? await scenarioFixture(baseDir, scenario.setup.fixture) : undefined;
  if (scenario.setup && !target.setup) throw new Error('Scenario fixture requires target.setup');
  if (target.setup && scenario.setup) requestPlan(target, target.setup, { fixture });
  for (const event of scenario.events) {
    const template = target.events[event.type];
    if (!template) throw new Error(`Target has no mapping for ${event.type}`);
    requestPlan(target, template, { params: event.params, step: event.step });
  }
  if (target.replan) requestPlan(target, target.replan, {});
  if (target.clock && scenario.wait && 'source' in scenario.wait)
    requestPlan(target, target.clock.advance, { seconds: scenario.wait.pollSeconds });
  for (const artifact of target.artifacts) requestPlan(target, { method: 'GET', path: artifact.path }, {});
  for (const invariant of scenario.invariants)
    if (typeof invariant === 'object' && 'module' in invariant) {
      const root = await realpath(baseDir),
        entry = await realpath(resolve(baseDir, invariant.module));
      const path = relative(root, entry);
      if (isAbsolute(invariant.module) || path === '..' || path.startsWith('../') || isAbsolute(path))
        throw new Error('Invariant module must stay within the scenario directory');
    }
}
