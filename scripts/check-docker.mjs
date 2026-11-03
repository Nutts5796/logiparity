import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const root = fileURLToPath(new URL('../', import.meta.url));
const image = process.env.LOGIPARITY_DOCKER_IMAGE ?? 'logiparity:1.0.1';
const run = promisify(execFile);
const probe = `const fs=require('node:fs/promises'); const {execFile}=require('node:child_process'); const {promisify}=require('node:util'); const run=promisify(execFile);
(async()=>{
if(process.getuid()===0) throw Error('Container must be non-root');
const p='/usr/local/lib/node_modules/logiparity'; if(process.env.LOGIPARITY_EXPECT_BROWSER==='1'){ const {chromium}=require(p+'/node_modules/playwright'); const browser=await chromium.launch({headless:true}); const page=await browser.newPage(); await page.setContent('<title>LogiParity container smoke</title>'); if(await page.title()!=='LogiParity container smoke') throw Error('Chromium failed'); await browser.close(); }else{try{await fs.access('/ms-playwright');throw Error('Slim image contains browsers')}catch(e){if(e.code!=='ENOENT')throw e;}}
for(const file of ['/tmp/logiparity.tgz','/tmp/browser/node_modules/playwright/cli.js']){try{await fs.access(file);throw Error('Installer artifact remains: '+file)}catch(e){if(e.code!=='ENOENT')throw e;}}
await fs.writeFile('/tmp/a.csv','ID,Payout,At\\nS1,6.25,2026-11-02T13:01:00Z\\n'); await fs.writeFile('/tmp/b.csv','ID,Payout,At\\nS1,6.24,2026-11-02T13:00:00Z\\n');
const source=file=>({type:'csv',file,fields:{id:'ID',payout:'Payout',at:'At'}}); await fs.writeFile('/tmp/parity.yaml',JSON.stringify({version:1,entities:[{name:'shipment',key:'id',sources:{a:source('/tmp/a.csv'),b:source('/tmp/b.csv')},compare:{payout:{type:'money',currency:'USD'},at:{type:'datetime'}}}],report:{outputs:['html','json','markdown','junit'],dir:'/tmp/report'}}));
let code;try{await run('logiparity',['check','--config','/tmp/parity.yaml'])}catch(e){code=e.code}if(code!==1)throw Error('Wrong parity exit '+code); const html=await fs.readFile('/tmp/report/report.html','utf8');if(!html.includes('$6.25')||!html.includes('Nov 2, 2026, 1:01 PM UTC')||!html.includes('data:font/woff2;base64,'))throw Error('Display values missing');
const ai=await run('logiparity',['ai','scenario','--from','Synthetic container breakdown']); if(!ai.stdout.includes('nothing sent'))throw Error('AI not offline'); const adapters=await import(p+'/api/adapters.js');adapters.validateSource({type:'sql',query:'SELECT 1'});
const http=require('node:http');const server=http.createServer((req,res)=>res.end(JSON.stringify({data:[{id:'S1',payout:'6.25',at:'2026-11-02T13:01:00Z'}]})));await new Promise(done=>server.listen(0,'127.0.0.1',done));try{await fs.writeFile('/tmp/api.yaml',JSON.stringify({version:1,entities:[{name:'shipment',key:'id',sources:{api:{type:'rest',baseUrl:'http://127.0.0.1:'+server.address().port,path:'/',fields:{id:'$.id',payout:'$.payout',at:'$.at'}},csv:source('/tmp/a.csv')},compare:{payout:{type:'money',currency:'USD'},at:{type:'datetime'}}}]}));await run('logiparity',['check','--config','/tmp/api.yaml']);}finally{server.closeAllConnections();await new Promise(done=>server.close(done));}
console.log('Docker non-root, API/file checks, SQL validation, reports, money/UTC values and offline AI passed; browser='+process.env.LOGIPARITY_EXPECT_BROWSER+'; uid='+process.getuid());
})().catch(e=>{console.error(e.message);process.exitCode=1});`;
await run('npm', ['run', 'release:prepare'], { cwd: root, maxBuffer: 4 * 1024 * 1024, timeout: 300000 });
for (const target of ['runtime', 'slim']) {
  const tag = target === 'runtime' ? image : `${image}-slim`;
  const build = spawn('docker', ['build', '--target', target, '--tag', tag, '.'], { cwd: root, stdio: 'inherit' });
  const code = await new Promise((accept, reject) => {
    build.once('error', reject);
    build.once('exit', accept);
  });
  assert.equal(code, 0, `Docker ${target} build failed`);
  assert.equal((await run('docker', ['run', '--rm', '--network=none', tag, '--version'])).stdout.trim(), '1.0.1');
  const result = await run(
    'docker',
    [
      'run',
      '--rm',
      '--network=none',
      '--shm-size=1g',
      '--env',
      `LOGIPARITY_EXPECT_BROWSER=${target === 'runtime' ? '1' : '0'}`,
      '--entrypoint',
      'node',
      tag,
      '-e',
      probe,
    ],
    { maxBuffer: 1024 * 1024, timeout: 60000 },
  );
  console.log(`${target}: ${result.stdout.trim()}`);
}
