import { expect, it } from 'vitest';
import { compareEntities, consoleReport, entitySchema, groupFindings, htmlReport, markdownReport, normalize, ruleSchema, type Report } from '@logiparity/core';
const source={type:'csv',file:'unused.csv',fields:{load_id:'ID',pay:'Pay',status:'Status'}};
const entity=entitySchema.parse({name:'load',key:'load_id',sources:{reference:source,lines:{...source,rollup:{by:'load_id',sum:['pay'],first:['status']}}},compare:{pay:{type:'money',currency:'USD'},status:{type:'enum'}},aggregates:[{name:'total',type:'sum',field:'pay'}]});
it.each(['reference','lines'])('reports first-field conflicts in rolled-up %s without guessing a mapping',async name=>{
  const e=entitySchema.parse({...entity,sources:{reference:{...source,...(name==='reference'?{rollup:{by:'load_id',sum:['pay'],first:['status']}}:{})},lines:entity.sources.lines}});
  const report=await compareEntities([e],async function*(sourceName){yield {load_id:'L1',pay:sourceName===name?'1.00':'2.00',status:'delivered'};if(sourceName===name)yield {load_id:'L1',pay:'1.00',status:'cancelled'};});
  expect(report.findings).toHaveLength(1);expect(report.findings[0]).toMatchObject({reason:'rollup_conflict',field:'status',values:[{line:1,value:'delivered'},{line:2,value:'cancelled'}]});expect(report.groups).toEqual([]);
});
it('flags blank money in a rollup and skips comparisons and aggregates that depend on it',async()=>{
  const report=await compareEntities([entity],async function*(name){yield {load_id:'L1',pay:'1.00',status:'delivered'};if(name==='lines')yield {load_id:'L1',pay:'',status:'delivered'};});
  expect(report.findings).toHaveLength(1);expect(report.findings[0]).toMatchObject({reason:'rollup_missing_value',actual:null});expect(report.entities[0]?.aggregates?.[0]?.skippedSources).toEqual(['lines']);expect(report.groups).toEqual([]);
});
it('identifies repeated charge lines before summing without labelling them as rounding',async()=>{
  const e=entitySchema.parse({...entity,sources:{reference:source,lines:{...source,fields:{...source.fields,charge:'Charge'},rollup:{by:'load_id',sum:['pay'],first:['status'],duplicates:{by:['load_id','charge']}}}}});
  const report=await compareEntities([e],async function*(name){if(name==='reference'){yield {load_id:'L1',pay:'1.00',status:'delivered'};yield {load_id:'L2',pay:'1.00',status:'delivered'};}else{yield {load_id:'L1',pay:'1.00',status:'delivered',charge:'fuel'};yield {load_id:'L1',pay:'1.00',status:'delivered',charge:'fuel'};yield {load_id:'L2',pay:'1.00',status:'delivered',charge:'fuel'};}});
  expect(report.findings).toHaveLength(1);expect(report.findings[0]).toMatchObject({type:'duplicate_key',reason:'rollup_duplicate',key:'L1'});expect(report.groups).toEqual([]);expect(report.entities[0]?.aggregates?.[0]?.skippedSources).toEqual(['lines']);
  for(const by of [['charge'],['load_id','missing'],['load_id','load_id']])expect(entitySchema.safeParse({...e,sources:{...e.sources,lines:{...e.sources.lines,rollup:{...e.sources.lines!.rollup,duplicates:{by}}}}}).success).toBe(false);
});
it('requires explicit symbol and accounting-sign options without weakening grouping or precision',()=>{
  const money=(value:string,options:Record<string,unknown>={})=>normalize(value,ruleSchema.parse({type:'money',currency:'USD',...options}),'csv');
  expect(()=>money('$1,700.00')).toThrow('currency symbol');expect(()=>money('(200.00)')).toThrow('negative parentheses');
  expect(money('$1,700.00',{allowCurrencySymbol:true})).toBe(170000n);expect(money('(200.00)',{negativeParentheses:true})).toBe(-20000n);expect(money('($200.00)',{allowCurrencySymbol:true,negativeParentheses:true})).toBe(-20000n);
  for(const value of ['€1.00','$$1.00','$1,70.00','$1.001'])expect(()=>money(value,{allowCurrencySymbol:true})).toThrow();expect(()=>money('(-$200.00)',{allowCurrencySymbol:true,negativeParentheses:true})).toThrow('conflicting signs');
});
it('supports explicit export datetime formats and retains DST gap and overlap checks',()=>{
  const date=(value:string,options:Record<string,unknown>={})=>normalize(value,ruleSchema.parse({type:'datetime',format:'MM/dd/yyyy HH:mm',sourceTimezones:{csv:'America/New_York'},...options}),'csv');
  expect(date('11/02/2026 08:01')).toBe(Date.parse('2026-11-02T13:01:00Z'));expect(()=>date('03/08/2026 02:30')).toThrow('daylight-saving gap');expect(()=>date('11/01/2026 01:30')).toThrow('ambiguous');expect(()=>date('02/30/2026 12:00')).toThrow('Invalid');
  expect(()=>date('11/02/2026',{format:'MM/dd/yyyy'})).toThrow('date has no time');expect(()=>date('2026-11-02',{format:undefined})).toThrow('date has no time');
  expect(date('11/01/2026 01:30 -0400',{format:'MM/dd/yyyy HH:mm ZZZ'})).toBe(Date.parse('2026-11-01T05:30:00Z'));
});
it('uses singular grammar, meaningful money units and clean finding locations',()=>{
  const finding={type:'field_mismatch' as const,entity:'load',source:'lines',key:'L1',field:'pay',expected:100n,actual:99n,message:'Mismatch'};
  const report:Report={schemaVersion:1,entities:[{entity:'load',reference:'reference',counts:{}}],findings:[finding]};const presentation={entities:[entity]};
  const output=consoleReport(report,presentation);expect(output).toContain('1 entity, 1 finding (1 blocking)');expect(output).toContain('-$0.01 (1 cent)');expect(output).toContain('$1.00 (100 cents)');expect(markdownReport(report,presentation)).toContain('1 entity · 1 finding');
  const aggregate=consoleReport({...report,findings:[{...finding,type:'aggregate_mismatch',field:'total',key:''}]},presentation);expect(aggregate).toContain('$1.00 (100 cents)');expect(groupFindings([finding],[entity])[0]?.delta).toBe('-1');
  const error=consoleReport({...report,findings:[{type:'source_error',entity:'load',source:'',key:'',field:'',message:'Invalid source'}]});expect(error).toContain('1 entity, 0 findings (0 blocking), 1 configuration/source error');expect(error).not.toMatch(/key=-|field=-|load\//);
  const html=htmlReport(report,presentation);expect(html.indexOf('id="groups-title"')).toBeLessThan(html.indexOf('id="counts-title"'));
});
