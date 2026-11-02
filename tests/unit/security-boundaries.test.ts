import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { consoleReport, entitySchema, compareEntities, redactSecrets, secretValues, safeConsole, type Report } from '@logiparity/core';
import { redactInput, aiSettingsSchema, prepareDraft, renderDraft } from '@logiparity/ai';
import { prepareInvariant, targetSchema, scenarioConsole } from '@logiparity/scenarios';
import { requestPlan } from '../../packages/scenarios/src/http.js';
const dirs: string[] = [];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
const target=targetSchema.parse({version:1,name:'test',environment:'test',allowMutations:true,baseUrl:'http://127.0.0.1/api/v1/',events:{},state:{orders:{type:'csv',file:'unused',fields:{id:'ID'}}}});
it.each(['.','..','%2e','%2E%2E','.%2e','%252e%252e','%2e%2e%2fother','..\\other'])('rejects dot-segment placeholder %s before URL normalization',value=>{
  expect(()=>requestPlan(target,{method:'POST',path:'orders/{{params.id}}/cancel'},{params:{id:value}})).toThrow('dot-segments');
});
it('permits ordinary identifiers and dots within a path segment',()=>expect(requestPlan(target,{method:'POST',path:'orders/{{params.id}}/cancel'},{params:{id:'a.b'}}).url.pathname).toBe('/api/v1/orders/a.b/cancel'));
it('requires opt-in before loading modules and confines entries including symlinks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'logiparity-modules-'));dirs.push(root);const inside=join(root,'scenario');const outside=join(root,'outside.ts');
  const {mkdir}=await import('node:fs/promises');await mkdir(inside);await writeFile(outside,'throw new Error("executed outside")');await writeFile(join(inside,'check.ts'),'export default () => ({name:"ok",passed:true,affectedKeys:[],explanation:"checked"})');
  await expect(prepareInvariant({name:'check',module:'./check.ts'},inside)).rejects.toThrow('--allow-modules');
  await expect(prepareInvariant({name:'check',module:'./check.ts'},inside,true)).resolves.toBeTypeOf('function');
  for(const module of ['../outside.ts',outside])await expect(prepareInvariant({name:'escape',module},inside,true)).rejects.toThrow('scenario directory');
  await symlink(outside,join(inside,'link.ts'));await expect(prepareInvariant({name:'escape',module:'./link.ts'},inside,true)).rejects.toThrow('scenario directory');
});
it('rejects executable module invariants in an AI scenario draft',async()=>{
  const prepared=await prepareDraft({kind:'scenario',description:'Synthetic absence'},aiSettingsSchema.parse({version:1}));
  expect(()=>renderDraft(prepared,'version: 1\nname: test\ntarget: test\nevents: [{step: 1, type: driver_no_show}]\ninvariants: [{name: custom, module: ./custom.ts}]\n')).toThrow('cannot contain module');
});
it.each(['accessToken','refresh_token','X-API-KEY','clientSecret','PASSWORD_HASH','authHeader','cookieJar','sessionId'])('redacts normalized secret field %s and copied values',field=>{
  const result=redactInput({[field]:'sensitive-value',note:'copy sensitive-value'});expect(JSON.stringify(result.data)).not.toContain('sensitive-value');
});
it('masks credential query parameters in embedded and relative URLs and copied decoded values',()=>{
  const result=redactInput({url:'See https://example.test/x?access_token=encoded%2Fsecret&x=ok&API-Key=key-secret#end',relative:'/x?sessionId=session-secret',nested:'https://example.test/?next=https://other.test/?token=deep-secret',copy:'encoded/secret key-secret session-secret deep-secret'});
  expect(JSON.stringify(result.data)).not.toMatch(/encoded|key-secret|session-secret/);expect(JSON.stringify(result.data)).toContain('x=ok');expect(result.scrub('encoded/secret')).toBe('[REDACTED]');
});
it('strips terminal C0/C1 controls from console values but retains newline/tab',()=>{
  const controls='\u001b[31m\u009b2J\u0000\r\b';const report:Report={schemaVersion:1,entities:[],findings:[{type:'source_error',entity:controls,source:'csv',key:'',field:'',message:controls}]};
  expect(consoleReport(report)).not.toContain('\u001b');expect(safeConsole(controls+'\n\t')).toBe('[31m2J\n\t');
  expect(scenarioConsole({schemaVersion:1,kind:'scenario',name:controls,target:'t',environment:'test',events:[],invariants:[],error:controls,exitCode:2})).not.toContain('\u009b');
});
it('redacts configured secret values and encoded path copies before errors enter a report',async()=>{
  const source={type:'rest',baseUrl:'http://127.0.0.1',path:'/path/ab+c',auth:{type:'bearer',tokenEnv:'CUSTOM_VALUE'},fields:{id:'$.id'}};
  const entity=entitySchema.parse({name:'load',key:'id',sources:{api:source,csv:{type:'csv',file:'unused',fields:{id:'ID'}}}});
  const env={CUSTOM_VALUE:'ab+c'};const report=await compareEntities([entity],async function*(){throw new Error('/path/ab+c and /path/ab%2Bc');yield {id:'unreachable'};},env);
  expect(report.findings[0]?.message).toContain('[REDACTED]');expect(report.findings[0]?.message).not.toMatch(/ab\+c|ab%2Bc/);
  expect(redactSecrets('/path/short',secretValues({headersEnv:{Authorization:'ODD'}},{ODD:'Bearer short'}))).toBe('/path/[REDACTED]');
  expect(redactSecrets('/%61bc/x/ab%2bc', ['abc','ab+c'])).toBe('/[REDACTED]/x/[REDACTED]');
});
it('redacts only variables the configuration uses, not the whole environment',()=>{
  const env={CHILD_SESSION:'1',TERM_SESSION_ID:'w0t0p0:9F1C2D3E-4B5A-6789',SSH_AUTH_SOCK:'/private/tmp/launch/Listeners',API_TOKEN:'tok_live_123456',SVC:'svc_secret_value',PLAIN_ID:'plain-value-1'};
  const secrets=secretValues({path:'/orders/${API_TOKEN}/${PLAIN_ID}',auth:{tokenEnv:'SVC'}},env);
  expect(secrets.sort()).toEqual(['svc_secret_value','tok_live_123456']);
  expect(redactSecrets('LogiParity 1.0.0 session w0t0p0:9F1C2D3E-4B5A-6789 token tok_live_123456',secrets)).toBe('LogiParity 1.0.0 session w0t0p0:9F1C2D3E-4B5A-6789 token [REDACTED]');
});
