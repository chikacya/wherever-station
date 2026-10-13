// Batch progress tests intercept all requests and never execute production jobs.
const assert=require('node:assert/strict');
const {chromium}=require('playwright');
const args=process.argv.slice(2),base=args[args.indexOf('--url')+1];
if(!base?.startsWith('http://127.0.0.1:'))throw Error('Supply local --url');
const state={version:14,revision:1,settings:{monitoring:{}},machines:[{id:'host',name:'Test VPS',monitorClientId:'agent'}],nodes:[],managedInstances:[],subscriptions:[],externalSources:[],serviceBindings:[],providers:[],certificates:[],deploymentPresets:[]};
const rows=[{instanceId:'nw-one',name:'First instance',machineName:'Test VPS',currentVersion:'v2.1.0',targetVersion:'v2.2.1',phase:'queued',reason:''},{instanceId:'nw-two',name:'Second instance',machineName:'Test VPS',currentVersion:'v2.1.2',targetVersion:'v2.2.1',phase:'queued',reason:''},{instanceId:'nw-three',name:'Already current',machineName:'Test VPS',currentVersion:'v3.0.0',targetVersion:'v3.0.0',phase:'skipped',reason:'已经是目标版本'}];
let batch=null,finished=false,starts=0,submissions=0;
function report(){if(!batch)return null;return {...batch,rows:batch.rows.map((r,i)=>i===2?r:{...r,phase:finished?(i===0?'success':'failed'):'running',reason:finished?(i===0?'更新完成':'download-failed'):'下载、校验并更新中',rolledBack:finished&&i===1}),counts:{total:3,completed:finished?3:1,success:finished?1:0,failed:finished?1:0,skipped:1,'needs-review':0},done:finished};}
(async()=>{const browser=await chromium.launch();try{const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('https://api.github.com/**',r=>r.fulfill({json:[]}));
await page.route('**/api/rpc2',async route=>{const {method,params,id}=route.request().postDataJSON();let result={};
if(method==='proxyConsole:getState')result=state;
else if(method==='public:getMe')result={two_factor_enabled:false};
else if(method==='common:getNodes')result={agent:{uuid:'agent',name:'Test VPS'}};
else if(['proxyConsole:listInstanceStates','proxyConsole:listManagedTasks'].includes(method))result=[];
else if(method==='proxyConsole:previewNowhereBatch')result={rows};
else if(method==='proxyConsole:getNowhereBatch')result=report();
else if(method==='proxyConsole:startNowhereBatch'){starts++;batch={id:'batch-one',createdAt:new Date().toISOString(),rows};result={batch:report(),specs:rows.slice(0,2).map((r,i)=>({instanceId:r.instanceId,operationId:'job-'+i,command:'mock-command',clientId:'agent'}))};}
else if(method==='admin:exec'){if(params.command==='mock-command')submissions++;result={task_id:'mock-task-'+submissions};}
else if(method==='admin:getSpecificTaskResult')result={exit_code:0,result:'PCSTATES\t1\t'+Buffer.from('{"states":[]}').toString('base64')};
else if(method==='proxyConsole:bindManagedTask')result={phase:'running'};
await route.fulfill({json:{jsonrpc:'2.0',id,result}});});
await page.goto(base+'/admin.html');await page.locator('.nav').getByRole('button',{name:'部署节点',exact:true}).click();
await page.getByRole('button',{name:'批量更新 Nowhere',exact:true}).click();let dialog=page.locator('dialog[open]');await dialog.getByText(/计划更新 2 个/).waitFor();
await dialog.getByRole('button',{name:'更新全部可升级实例',exact:true}).click();await dialog.getByText('正在更新，提交完成后可离开页面',{exact:true}).waitFor();
assert.equal(starts,1);assert.equal(submissions,2);assert.equal(await dialog.getByRole('progressbar').getAttribute('value'),'1');
await dialog.getByRole('button',{name:'后台运行，关闭窗口',exact:true}).click();
await page.locator('.nav').getByRole('button',{name:'节点',exact:true}).click();await page.locator('.nav').getByRole('button',{name:'部署节点',exact:true}).click();
await page.getByRole('button',{name:'查看进度',exact:true}).click();dialog=page.locator('dialog[open]');await dialog.getByText('First instance',{exact:true}).waitFor();assert.equal(starts,1);assert.equal(submissions,2);
await page.reload();await page.locator('.nav').getByRole('button',{name:'部署节点',exact:true}).click();await page.getByRole('button',{name:'查看进度',exact:true}).click();
finished=true;dialog=page.locator('dialog[open]');await dialog.getByText('批量处理完成',{exact:true}).waitFor({timeout:10000});assert.equal(await dialog.getByRole('progressbar').getAttribute('value'),'3');await dialog.getByText(/已回退/).waitFor();
await page.screenshot({path:require('node:path').join(__dirname,'../artifacts/nowhere-batch/progress-desktop.png')});
await page.setViewportSize({width:375,height:812});assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+2));await page.screenshot({path:require('node:path').join(__dirname,'../artifacts/nowhere-batch/progress-mobile.png')});
assert.deepEqual(errors,[]);assert.equal(submissions,2);console.log(JSON.stringify({ok:true,progress:true,partialFailure:true,reloadRecovery:true,noDuplicateSubmission:true,mobile:true}));
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
