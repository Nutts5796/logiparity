import { expect, it } from 'vitest';
import { compareEntities, entitySchema, groupFindings, htmlReport, markdownReport, consoleReport, type Finding } from '@logiparity/core';
const source={type:'csv',file:'unused.csv',fields:{load_id:'ID',carrier_pay:'Pay',status:'Status',units:'Units'}};
const entity=entitySchema.parse({name:'load',key:'load_id',sources:{tms:source,settlement:{...source,rollup:{by:'load_id',sum:['carrier_pay','units'],first:['status']}}},compare:{carrier_pay:{type:'money',currency:'USD'},units:{type:'number'},status:{type:'enum'}}});
it('rolls up normalized money and exact numeric sums while keeping the first mapped value',async()=>{
  const report=await compareEntities([entity],async function*(name){if(name==='tms')yield {load_id:'L1',carrier_pay:'1150.25',units:0.3,status:'delivered'};else{yield {load_id:'L1',carrier_pay:'1000.00',units:0.1,status:'delivered'};yield {load_id:'L1',carrier_pay:'100.00',units:0.2,status:'delivered'};yield {load_id:'L1',carrier_pay:'50.25',units:null,status:'delivered'};}});
  expect(report.findings).toEqual([]);expect(report.entities[0]?.counts).toEqual({tms:1,settlement:3});
});
it('retains duplicate detection on sources without an explicit rollup',async()=>{
  const report=await compareEntities([{...entity,sources:{tms:entity.sources.tms!,settlement:entity.sources.tms!}}],async function*(){yield {load_id:'L1'};yield {load_id:'L1'};});expect(report.findings.map(f=>f.type)).toEqual(['duplicate_key','duplicate_key']);
});
it('rejects rollup references that cannot be compared safely',()=>{
  for(const rollup of [{by:'other',sum:['carrier_pay'],first:['status','units']},{by:'load_id',sum:['status'],first:['carrier_pay','units']},{by:'load_id',sum:['carrier_pay'],first:['carrier_pay']},{by:'load_id',sum:['carrier_pay'],first:[]}])expect(entitySchema.safeParse({...entity,sources:{...entity.sources,settlement:{...source,rollup}}}).success).toBe(false);
});
it('reports invalid sum input without comparing partial rolled-up data',async()=>{
  const report=await compareEntities([entity],async function*(name){yield {load_id:'L1',carrier_pay:name==='tms'?'1.00':'bad',units:1,status:'delivered'};});expect(report.findings.map(f=>f.type)).toEqual(['source_error']);
});
const missing=(key:string,type:Finding['type']='missing_in_source'):Finding=>({type,entity:'load',source:'settlement',key,field:'',message:'Synthetic absence'});
it.each(['missing_in_source','extra_in_source'] as const)('groups regular %s strides before field patterns without dropping rows',type=>{
  const findings=[missing('L000200',type),missing('L000400',type),missing('L000600',type),{...missing('L1','field_mismatch'),field:'status',expected:'delivered',actual:'in_transit'}];
  const groups=groupFindings(findings,[entity]);expect(groups[0]).toMatchObject({kind:type==='missing_in_source'?'missing_stride':'extra_stride',stride:'200',count:3});expect(groups[0]?.summary).toContain('likely page boundary');expect(groupFindings([...findings].reverse(),[entity])).toEqual(groups);
  const report={schemaVersion:1 as const,entities:[],findings,groups};for(const text of [htmlReport(report),markdownReport(report),consoleReport(report)])expect(text).toContain('likely page boundary');expect(report.findings).toHaveLength(4);
});
it('does not infer page boundaries from two keys, mixed prefixes, contiguous or irregular keys',()=>{
  for(const keys of [['L200','L400'],['L200','X400','L600'],['L1','L2','L3'],['L200','L400','L601'],['uuid-a','uuid-b','uuid-c']])expect(groupFindings(keys.map(k=>missing(k)))).toEqual([]);
});
it('keeps a regular page-boundary run when the final partial-page key is also missing',()=>{
  const findings=['L200','L400','L600','L750'].map(k=>missing(k));
  const groups=groupFindings(findings);expect(groups).toHaveLength(1);expect(groups[0]).toMatchObject({kind:'missing_stride',count:3,stride:'200'});expect(groups[0]?.summary).toContain('L200 to L600');expect(findings).toHaveLength(4);
});
