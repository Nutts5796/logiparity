import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ExcelJS from '@logiparity/exceljs';
import { afterEach, expect, it } from 'vitest';
import { loadConfig, sourceSchema } from '@logiparity/core';
import { readFileSource } from '@logiparity/adapters';
import { loadScenario } from '@logiparity/scenarios';
import { collect } from '../helpers.js';
const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
async function directory() { const dir = await mkdtemp(join(tmpdir(), 'logiparity-m7-')); dirs.push(dir); return dir; }
it.each(['csv', 'xlsx'] as const)('lists available %s headers with file/row context when a mapping is missing', async (type) => {
  const dir = await directory(); const file = join(dir, `input.${type}`);
  if (type === 'csv') await writeFile(file, 'Shipment ID,Payout,Delivery Date\nS1,6.25,2026-11-02\n');
  else { const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet('Shipments'); sheet.addRow(['Shipment ID', 'Payout', 'Delivery Date']); sheet.addRow(['S1', '6.25', '2026-11-02']); await workbook.xlsx.writeFile(file); }
  const config = sourceSchema.parse({ type, file, ...(type === 'xlsx' ? { sheet: 'Shipments' } : {}), fields: { id: 'Shipment ID', at: 'Delivered at' } });
  if (config.type !== 'csv' && config.type !== 'xlsx') throw new Error('Unexpected fixture source');
  const error: unknown = await collect(readFileSource(config, { baseDir: dir, env: {} })).catch((value: unknown) => value);
  expect(String(error)).toContain(file); expect(String(error)).toContain('Available headers: "Shipment ID", "Payout", "Delivery Date"'); expect(String(error)).not.toContain('Check file permissions and the source mapping');
});
it.each(['root', 'source', 'pagination', 'rule', 'report', 'auth'])('lists valid keys for an unknown %s key', async (location) => {
  const dir = await directory();
  const api: Record<string, unknown> = { type: 'rest', baseUrl: 'https://staging.example.test', path: '/shipments', fields: { id: '$.id' }, pagination: { type: 'page', size: 100 }, auth: { type: 'bearer', tokenEnv: 'TOKEN' } };
  const compare: Record<string, unknown> = { payout: { type: 'money', currency: 'USD' } }; const report: Record<string, unknown> = { outputs: ['json'], dir: './report' };
  const config: Record<string, unknown> = { version: 1, entities: [{ name: 'shipment', key: 'id', sources: { api, csv: { type: 'csv', file: 'unused.csv', fields: { id: 'ID' } } }, compare }], report };
  const object = location === 'source' ? api : location === 'pagination' ? api.pagination as Record<string, unknown> : location === 'rule' ? compare.payout as Record<string, unknown> : location === 'report' ? report : location === 'auth' ? api.auth as Record<string, unknown> : config;
  object.typo = 'not a credential'; const file = join(dir, 'config.yaml'); await writeFile(file, JSON.stringify(config));
  const error: unknown = await loadConfig(file).catch((value: unknown) => value); expect(String(error)).toContain('Valid keys:');
  if (location === 'pagination') { expect(String(error)).toContain('pageParam'); expect(String(error)).not.toContain('cursorParam'); }
  expect(String(error)).toContain(location === 'pagination' ? 'totalPath' : location === 'rule' ? 'allowNumber' : location === 'auth' ? 'tokenEnv' : location === 'report' ? 'outputs' : location === 'source' ? 'baseUrl' : 'entities');
});
it.each([
  { invariant: { name: 'custom', module: './custom.ts', typo: true }, valid: 'module, name' },
  { invariant: { name: 'ready', jsonPath: '$.after.control[0].ready', expected: true, typo: true }, valid: 'expected, jsonPath, name' },
  { invariant: { sla_window_violations: { max: 0, typo: true } }, valid: 'max' },
])('lists the selected invariant object keys: $valid', async ({ invariant, valid }) => {
  const dir = await directory(); const file = join(dir, 'scenario.yaml');
  await writeFile(file, JSON.stringify({ version: 1, name: 'No-show', target: 'staging', events: [{ step: 1, type: 'driver_no_show' }], wait: { until: { ready: true } }, invariants: [invariant] }));
  await expect(loadScenario(file, {})).rejects.toThrow(`Valid keys: ${valid}`);
});

it.each(['entity','aggregate'] as const)('lists valid keys for an unknown %s property',async(location)=>{
  const dir=await directory();const source={type:'csv',file:'unused.csv',fields:{id:'ID'}};
  const aggregate={name:'loads',type:'count',typo:true};
  const entity={name:'load',key:'id',sources:{a:source,b:source},...(location==='entity'?{typo:true}:{aggregates:[aggregate]})};
  const file=join(dir,'parity.yaml');await writeFile(file,JSON.stringify({version:1,entities:[entity]}));
  const error=await loadConfig(file).catch((e:unknown)=>e);expect(String(error)).toContain('Valid keys:');expect(String(error)).toContain(location==='entity'?'aggregates':'where');
});
