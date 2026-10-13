const assert = require('node:assert/strict');
const { planNowhereBatch, summarizeNowhereBatch } = require('../tools/nowhere-batch');
const state={machines:[{id:'host',name:'Test host',monitorClientId:'agent'}],managedInstances:[
 {id:'legacy',name:'Legacy',kind:'nowhere',version:'v2.1.0',status:'running',machineId:'host'},
 {id:'lts',name:'LTS',kind:'nowhere',version:'v2.2.1',status:'stopped',machineId:'host'},
 {id:'nw3',name:'NW3',kind:'nowhere',version:'v3.0.0',status:'running',machineId:'host'},
 {id:'future',name:'Future',kind:'nowhere',version:'v3.0.1',status:'running',machineId:'host'},
 {id:'draft',name:'Draft',kind:'nowhere',version:'v2.1.0',status:'draft',machineId:'host'},
 {id:'other',kind:'sing-box',version:'1.13.18',status:'running',machineId:'host'},
]};
let rows=planNowhereBatch(state);assert.equal(rows.length,5);assert.equal(rows[0].phase,'queued');assert.equal(rows[0].targetVersion,'v2.2.1');assert(rows.slice(1).every(r=>r.phase==='skipped'));
assert.equal(planNowhereBatch(state,[{instanceId:'legacy',phase:'running'}])[0].phase,'skipped');
assert.equal(planNowhereBatch({...state,machines:[]})[0].phase,'skipped');
const batch={id:'batch',createdAt:new Date().toISOString(),expiresAt:Date.now()+86400000,rows:[{...rows[0],operationId:'job'},...rows.slice(1)]};
let report=summarizeNowhereBatch(batch,()=>({phase:'running'}));assert.equal(report.counts.completed,4);assert.equal(report.done,false);
report=summarizeNowhereBatch(batch,()=>({phase:'completed',result:{ok:false,error:'download-failed',rolledBack:true}}));assert.equal(report.counts.failed,1);assert.equal(report.done,true);assert.equal(report.rows[0].rolledBack,true);
report=summarizeNowhereBatch(batch,()=>({phase:'completed',result:{ok:true}}));assert.equal(report.counts.success,1);
report=summarizeNowhereBatch(batch,()=>{throw Error('missing')});assert.equal(report.counts['needs-review'],1);
report=summarizeNowhereBatch({...batch,createdAt:new Date(Date.now()-180000).toISOString()},()=>({phase:'prepared'}));assert.equal(report.counts['needs-review'],1);
console.log('Nowhere batch targets, skips, slow jobs and failure progress passed');

assert.equal(summarizeNowhereBatch({...batch,createdAt:new Date(Date.now()-180000).toISOString(),rows:[{phase:'queued'}]},()=>null).done,true);
