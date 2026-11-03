import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import JSZip from 'jszip';
import {expect,it} from 'vitest';
const run=promisify(execFile);
it('streams a shared-string workbook in a fresh process within a bounded RSS budget',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'logiparity-xlsx-rss-'));
  try{
    const count=25000;const zip=new JSZip();
    zip.file('xl/workbook.xml','<workbook xmlns:r="urn:rels"><sheets><sheet name="Data" r:id="r1"/></sheets></workbook>');
    zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');
    const text='<sst>'+Array.from({length:count},(_,i)=>`<si><t>unique shared string ${String(i).padStart(10,'0')}</t></si>`).join('')+'</sst>';
    expect(Buffer.byteLength(text)).toBeGreaterThan(1100000);
    zip.file('xl/sharedStrings.xml',text);
    zip.file('xl/worksheets/sheet1.xml','<worksheet>'+Array.from({length:count},(_,i)=>`<row r="${i+1}"><c r="A${i+1}" t="s"><v>${i}</v></c></row>`).join('')+'</worksheet>');
    const file=join(dir,'shared.xlsx');await writeFile(file,await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}));
    const script=`import {xlsxRows} from ${JSON.stringify(new URL('file://'+resolve('packages/adapters/dist/xlsx.js')).href)};let count=0;for await(const row of xlsxRows(process.argv[1],'Data')){if(!String(row.values[0]).startsWith('unique shared string'))throw Error('Wrong shared string');count++;}console.log(JSON.stringify({count,rss:process.resourceUsage().maxRSS*1024}));`;
    const result=await run(process.execPath,['--input-type=module','-e',script,file],{timeout:30000});const data=JSON.parse(result.stdout) as {count:number;rss:number};
    expect(data.count).toBe(count);
    expect(data.rss).toBeLessThan(192*1024*1024);
  }finally{await rm(dir,{recursive:true,force:true});}
});
