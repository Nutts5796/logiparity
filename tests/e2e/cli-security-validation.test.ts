import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, expect, it } from 'vitest';
import { startServer } from '../helpers.js';
const cli=resolve('packages/cli/dist/main.js');const dirs:string[]=[];
afterEach(async()=>{await Promise.all(dirs.splice(0).map(d=>rm(d,{recursive:true,force:true})));});
async function dir(){const d=await mkdtemp(join(tmpdir(),'logiparity-cli-security-'));dirs.push(d);return d;}
async function run(args:string[],cwd:string,env:NodeJS.ProcessEnv={}){const child=spawn(process.execPath,[cli,...args],{cwd,env:{...process.env,...env},stdio:['ignore','pipe','pipe']});let stdout='';let stderr='';child.stdout.on('data',(v:Buffer)=>{stdout+=v.toString();});child.stderr.on('data',(v:Buffer)=>{stderr+=v.toString();});const [code]=await once(child,'exit');return {code,stdout,stderr};}
it('prints the installed version without configuration',async()=>{const result=await run(['--version'],await dir());expect(result).toEqual({code:0,stdout:'1.0.0\n',stderr:''});});
it('validates schema, field references and extraction syntax without reading files or contacting servers',async()=>{
  const d=await dir();let hits=0;const server=await startServer((_,res)=>{hits++;res.end('{}');});
  const config={version:1,entities:[{name:'load',key:'id',sources:{api:{type:'rest',baseUrl:server.url,path:'/',fields:{id:'$.id'}},file:{type:'csv',file:'missing.csv',fields:{id:'ID'}}}}]};
  try{await writeFile(join(d,'config.yaml'),JSON.stringify(config));expect((await run(['validate','--config','config.yaml'],d)).code).toBe(0);expect(hits).toBe(0);
    config.entities[0]!.sources.api.fields.id='$..id';await writeFile(join(d,'config.yaml'),JSON.stringify(config));expect((await run(['validate','--config','config.yaml'],d)).code).toBe(2);expect(hits).toBe(0);
    await writeFile(join(d,'config.yaml'),JSON.stringify({...config,entities:[{...config.entities[0],compare:{missing:{type:'string'}}}]}));expect((await run(['validate','--config','config.yaml'],d)).stderr).toContain('not mapped');
  }finally{await server.close();}
});
it.each(['omitted','fixed','module denied','module allowed','module outside'] as const)('runs scenario preflight and optional wait: %s',async(mode)=>{
  const d=await dir();let events=0;const server=await startServer((req,res)=>{if(req.method==='POST')events++;res.end(JSON.stringify({data:[{id:'L1'}]}));});
  try{
    await writeFile(join(d,'check.ts'),'export default ()=>({name:"custom",passed:true,affectedKeys:[],explanation:"checked"})');
    await writeFile(join(d,'target.yaml'),JSON.stringify({version:1,name:'test',environment:'test',allowMutations:true,baseUrl:server.url,events:{driver_no_show:{method:'POST',path:'/event'}},state:{orders:{type:'rest',baseUrl:server.url,path:'/',fields:{id:'$.id'}}}}));
    const moduleMode=mode.startsWith('module');await writeFile(join(d,'scenario.yaml'),JSON.stringify({version:1,name:'absence',target:'test',events:[{step:1,type:'driver_no_show',params:{driver:'D1'}}],...(mode==='fixed'?{wait:{seconds:0.01}}:{}),invariants:moduleMode?[{name:'custom',module:mode==='module outside'?join(d,'check.ts'):'./check.ts'}]:['no_order_lost']}));
    const allowed=mode==='module allowed'||mode==='module outside';const result=await run(['scenario','run','scenario.yaml','--target','target.yaml','--report-dir','report',...(allowed?['--allow-modules']:[])],d);
    expect(result.code,result.stdout+result.stderr).toBe(mode==='module denied'||mode==='module outside'?2:0);expect(events).toBe(mode==='module denied'||mode==='module outside'?0:1);
    if(mode==='module denied')expect(result.stderr).toContain('--allow-modules');
  }finally{await server.close();}
});
it('redacts a configured arbitrary-name credential in console errors and every report format',async()=>{
  const d=await dir();const token='test-path-credential';await mkdir(join(d,token));
  const config={version:1,entities:[{name:'load',key:'id',sources:{file:{type:'csv',file:`./${token}/missing.csv`,fields:{id:'ID'}},api:{type:'rest',baseUrl:'http://127.0.0.1:1',path:'/',auth:{type:'bearer',tokenEnv:'CREDENTIAL_VALUE'},fields:{id:'$.id'}}}}],report:{outputs:['console','html','json','markdown','junit'],dir:'report'}};
  await writeFile(join(d,'config.yaml'),JSON.stringify(config));const result=await run(['check','--config','config.yaml'],d,{CREDENTIAL_VALUE:token});expect(result.code).toBe(2);expect(result.stdout+result.stderr).not.toContain(token);
  for(const file of ['report.html','report.json','report.md','junit.xml']){const text=await readFile(join(d,'report',file),'utf8');expect(text).not.toContain(token);expect(text).toContain('REDACTED');}
  await writeFile(join(d,token,'invalid.yaml'),JSON.stringify({...config,typo:true}));const invalid=await run(['validate','--config',`${token}/invalid.yaml`],d,{CREDENTIAL_VALUE:token});expect(invalid.code).toBe(2);expect(invalid.stderr).not.toContain(token);
});
it('runs the documented freight example',async()=>{const result=await run(['check','--config',resolve('examples/freight/parity.yaml')],await dir());expect(result.code,result.stdout+result.stderr).toBe(0);expect(result.stdout).toContain('0 findings');});
