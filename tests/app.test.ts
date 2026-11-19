import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent,nip19} from 'nostr-tools';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {ADMINS,hash} from '../src/auth';
import {config} from '../src/config';
import {pipelineJobInput} from '../src/dispatcher';
import prepareInterview from '../pipelines/functions/prepare-interview.v5';

const origin='https://workshop.example';
let store:Store, app:ReturnType<typeof createApp>, dir:string;
let admin:Uint8Array,user:Uint8Array,other:Uint8Array,worker:Uint8Array;
let adminPk:string,userPk:string,workerPk:string;
function signed(key:Uint8Array,path:string,method='GET',data?:unknown,override:Record<string,any>={}){
 const body=data===undefined?'':JSON.stringify(data);
 const event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(['POST','PATCH','PUT','DELETE'].includes(method)||body?[['payload',hash(body)]]:[])],...override},key);
 return new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64'),'content-type':'application/json'},...(body?{body}:{})});
}
async function call(key:Uint8Array,path:string,method='GET',body?:unknown){const response=await app.fetch(signed(key,path,method,body));return {status:response.status,body:await response.json() as any};}
function seed(){
 store.put('project',{id:'p',title:'Parkes Bush Bash 2026',description:'Build together',joinCode:'JOIN'});
 for(const key of [user,other])store.put('membership',{id:'p:'+getPublicKey(key),projectId:'p',pubkey:getPublicKey(key)});
}
async function design(){return (await call(user,'/api/projects/p/designs','POST',{title:'Freedom design'})).body;}
async function save(id:string,expectedSnapshotId:string|null=null,document='Facts: a participant goal.\nAssumptions: none.\nQuestions: what next?'){
 return call(user,'/api/designs/'+id,'PATCH',{title:'Freedom design',document,expectedSnapshotId});
}
beforeEach(()=>{
 dir=mkdtempSync(join(tmpdir(),'byo-freedom-test-'));store=new Store(join(dir,'test.sqlite'));
 admin=generateSecretKey();user=generateSecretKey();other=generateSecretKey();worker=generateSecretKey();adminPk=getPublicKey(admin);userPk=getPublicKey(user);workerPk=getPublicKey(worker);
 // Test-only admin principal, so production identities never require a private key.
 ADMINS.push(adminPk);app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk}));seed();
});
afterEach(()=>{ADMINS.splice(ADMINS.indexOf(adminPk),1);store.db.close();rmSync(dir,{recursive:true,force:true});});

describe('NIP-98 authentication',()=>{
 test('configured admins decode to expected administrator public identities',()=>{
  expect(ADMINS.slice(0,2).map(p=>nip19.npubEncode(p))).toEqual(['npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy','npub1llwrq3rtah3rg3r2dyfyht55ek7aa0ey7z47ujju407pzfp38shqa7zcvr']);
 });
 test('signature, kind, URL, method, freshness and body are checked',async()=>{
  expect((await app.fetch(new Request(origin+'/api/me'))).status).toBe(401);
  for(const changes of [{kind:1},{created_at:Math.floor(Date.now()/1000)-100},{tags:[['u','https://evil.example/api/me'],['method','GET']]},{tags:[['u',origin+'/api/me'],['method','POST']]}])expect((await app.fetch(signed(user,'/api/me','GET',undefined,changes))).status).toBe(401);
  const req=signed(user,'/api/profile','PATCH',{name:'Real'});
  expect((await app.fetch(new Request(req.url,{method:'PATCH',headers:req.headers,body:JSON.stringify({name:'Tampered'})}))).status).toBe(401);
  const auth=JSON.parse(Buffer.from(signed(user,'/api/me').headers.get('authorization')!.slice(6),'base64').toString());auth.sig='0'.repeat(128);
  expect((await app.fetch(new Request(origin+'/api/me',{headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(auth)).toString('base64')}}))).status).toBe(401);
 });
 test('forwarded host never changes exact configured public URL',async()=>{
  const req=signed(user,'/api/me');req.headers.set('x-forwarded-host','evil.example');req.headers.set('x-forwarded-proto','http');expect((await app.fetch(req)).status).toBe(200);
  expect((await app.fetch(signed(user,'/api/me','GET',undefined,{tags:[['u','https://evil.example/api/me'],['method','GET']]}))).status).toBe(401);
 });
 test('replay protection survives reopened SQLite',async()=>{
  const req=signed(user,'/api/me');const retry=req.clone();expect((await app.fetch(req)).status).toBe(200);store.db.close();store=new Store(join(dir,'test.sqlite'));app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk}));expect((await app.fetch(retry)).status).toBe(409);
 });
});

describe('authorization and immutable design state',()=>{
 test('signed administrators read and edit participant interviews without taking ownership',async()=>{
  const d=await design();const first=(await save(d.id)).body;
  store.add('message',{conversationId:d.id,role:'user',author:userPk,content:'Participant private requirement'});
  const view=await call(admin,`/api/designs/${d.id}`);
  expect(view.status).toBe(200);expect(view.body.messages[0].content).toBe('Participant private requirement');expect(view.body.design.owner).toBe(userPk);
  const edited=await call(admin,`/api/designs/${d.id}`,'PATCH',{title:'Admin corrected title',document:'Participant requirements preserved; administrative correction.',expectedSnapshotId:first.id});
  expect(edited.status).toBe(200);expect(edited.body.editedBy).toBe(adminPk);expect(edited.body.parentId).toBe(first.id);
  expect(store.get('design',d.id)!.owner).toBe(userPk);expect(store.get('conversation',d.id)!.owner).toBe(userPk);
  expect((await call(admin,`/api/designs/${d.id}`,'PATCH',{title:'Stale',document:'Stale',expectedSnapshotId:first.id})).status).toBe(409);
  expect((await call(other,`/api/designs/${d.id}`)).status).toBe(403);expect((await call(other,`/api/designs/${d.id}`,'PATCH',{title:'Stolen',document:'Stolen',expectedSnapshotId:edited.body.id})).status).toBe(403);
 });
 test('admin interview interventions retain signer and participant provenance through recovery',async()=>{
  const d=await design();const content='Please verify the supplied source before continuing.';
  const sent=await call(admin,`/api/designs/${d.id}/messages`,'POST',{content,requestId:'admin-intervention'});
  expect(sent.status).toBe(202);const job=sent.body,message=store.get('message',job.messageId)!;
  expect(message.author).toBe(adminPk);expect(message.authorRole).toBe('administrator');expect(message.content).toBe(content);expect(message.participantOwner).toBe(userPk);
  expect(job.owner).toBe(adminPk);expect(job.context.participantOwner).toBe(userPk);expect(job.context.submittedBy).toBe(adminPk);expect(job.context.message).toContain('not a participant confirmation');
  expect((await call(admin,`/api/jobs/${job.id}`)).status).toBe(200);expect((await call(other,`/api/jobs/${job.id}`)).status).toBe(403);
  store.put('job',{...job,status:'running',runId:'admin-run'});
  expect((await call(admin,`/api/jobs/${job.id}/recover`,'POST',{action:'check'})).status).toBe(200);
  store.put('job',{...store.get('job',job.id)!,status:'failed'});
  expect((await call(admin,`/api/jobs/${job.id}/retry`,'POST',{})).status).toBe(200);
  store.put('job',{...store.get('job',job.id)!,status:'failed'});
  const rebased=await call(admin,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'admin-rebase'});
  expect(rebased.status).toBe(200);expect(store.get('message',rebased.body.messageId)!.content).toBe(content);expect(rebased.body.context.history[0].content).toContain('Administrative intervention');expect(rebased.body.context.message.match(/Administrative intervention/g)).toHaveLength(1);
  expect(store.get('design',d.id)!.owner).toBe(userPk);
  expect((await call(admin,`/api/worker/jobs/${job.id}/complete`,'POST',{response:'Forged',snapshot:{title:'Forged',document:'Forged'}})).status).toBe(403);
 });
 test('admin image actions preserve participant ownership and exact active run tickets',async()=>{
  app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk,INTERVIEW_PIPELINE_CONFIG:'configured-fixture',INTERVIEW_WORKFLOW_VERSION:'interview-v5',INTERVIEW_SCOPED_TOOLS:'1'}));
  const d=await design(),png={name:'reference.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='};
  const image=(await call(admin,`/api/designs/${d.id}/images`,'POST',png)).body;
  expect(store.get('interviewImage',image.id)!.owner).toBe(userPk);expect(store.get('interviewImage',image.id)!.uploadedBy).toBe(adminPk);
  expect((await call(user,`/api/designs/${d.id}/images/${image.id}`)).body.base64).toBe(png.base64);
  expect((await call(admin,`/api/designs/${d.id}/images/${image.id}`)).body.base64).toBe(png.base64);expect((await call(other,`/api/designs/${d.id}/images/${image.id}`)).status).toBe(403);
  const second=await design();expect((await call(admin,`/api/designs/${second.id}/images/${image.id}`)).status).toBe(404);
  const job=(await call(admin,`/api/designs/${d.id}/messages`,'POST',{content:'Inspect this reference',imageIds:[image.id],requestId:'admin-image'})).body;
  expect(job.context.attachments[0].id).toBe(image.id);expect(job.context.participantOwner).toBe(userPk);
  store.put('job',{...job,status:'running',runId:'exact-admin-image-run'});
  const headers={'x-byo-image-ticket':job.context.attachmentSource.ticket,'x-wingman-run-id':'exact-admin-image-run','x-byo-image-id':image.id};
  const read=await app.fetch(new Request(job.context.attachmentSource.url,{headers}));expect(read.status).toBe(200);expect(Buffer.from(await read.arrayBuffer()).toString('base64')).toBe(png.base64);
  expect((await app.fetch(new Request(job.context.attachmentSource.url,{headers:{...headers,'x-wingman-run-id':'foreign'}}))).status).toBe(403);
  store.put('job',{...job,status:'complete',runId:'exact-admin-image-run'});expect((await app.fetch(new Request(job.context.attachmentSource.url,{headers}))).status).toBe(403);
 });
 test('participant then admin then participant turns keep the same scoped native conversation',async()=>{
  const d=await design(),prepared:any[]=[],jobs:any[]=[];
  for(const [n,key]of [user,admin,user].entries()){
   const sent=await call(key,`/api/designs/${d.id}/messages`,'POST',{content:`Turn ${n+1}`,requestId:`mixed-actor-${n}`});expect(sent.status).toBe(202);
   jobs.push(sent.body);prepared.push(await prepareInterview({job:pipelineJobInput(sent.body)}));store.put('job',{...sent.body,status:'complete'});
  }
  expect(new Set(prepared.map(p=>p.conversationKey)).size).toBe(1);expect(new Set(prepared.map(p=>p.projectId)).size).toBe(1);expect(prepared.every(p=>p.executionProfile==='scoped-interview')).toBe(true);
  expect(jobs.map(j=>j.owner)).toEqual([userPk,adminPk,userPk]);expect(jobs.every(j=>j.context.participantOwner===userPk)).toBe(true);
  expect(prepared[2].prompt).toContain('Administrative intervention');expect(prepared[2].prompt).toContain('not a participant confirmation');expect(jobs[1].context.message).toContain('\n\nTurn 2');
  expect(store.get('design',d.id)!.owner).toBe(userPk);
 });
 test('body owner/admin claims cannot grant authority',async()=>{
  expect((await call(user,'/api/projects','POST',{title:'Forbidden',admin:true,owner:adminPk})).status).toBe(403);
  const d=(await call(user,'/api/projects/p/designs','POST',{title:'Mine',owner:getPublicKey(other)})).body;expect(d.owner).toBe(userPk);
  expect((await call(other,'/api/designs/'+d.id)).status).toBe(403);
  expect((await call(other,'/api/designs/'+d.id,'PATCH',{title:'Stolen',document:'Overwrite',expectedSnapshotId:null})).status).toBe(403);
 });
 test('membership and implementation history remain isolated',async()=>{
  const outsider=generateSecretKey();expect((await call(outsider,'/api/projects/p')).status).toBe(403);
  const d=await design();const s=(await save(d.id)).body;
  const i=(await call(admin,'/api/designs/'+d.id+'/implementations','POST',{snapshotId:s.id})).body;
  expect((await call(user,'/api/implementations/'+i.id)).status).toBe(403);
  expect((await call(user,'/api/designs/'+d.id+'/implementations','POST',{snapshotId:s.id})).status).toBe(201);
  expect((await call(admin,'/api/implementations/'+i.id)).body.messages).toEqual([]);
 });
 test('concurrent direct edits create one new snapshot and preserve history',async()=>{
  const d=await design();const first=(await save(d.id)).body;
  const updates=await Promise.all([save(d.id,first.id,'Facts: first concurrent edit'),save(d.id,first.id,'Facts: second concurrent edit')]);
  expect(updates.map(r=>r.status).sort()).toEqual([200,409]);
  const result=(await call(user,'/api/designs/'+d.id)).body;
  expect(result.snapshots).toHaveLength(2);expect(result.snapshots[0].document).toBe(first.document);expect(result.snapshots[1].parentId).toBe(first.id);
 });
 test('message idempotency rejects changed payload and overlapping turns',async()=>{
  const d=await design();const body={content:'Help me describe freedom',requestId:'turn-one'};
  const one=await call(user,'/api/designs/'+d.id+'/messages','POST',body);const two=await call(user,'/api/designs/'+d.id+'/messages','POST',body);expect(one.status).toBe(202);expect(two.body.id).toBe(one.body.id);
  expect((await call(user,'/api/designs/'+d.id+'/messages','POST',{...body,content:'Changed'})).status).toBe(409);
  expect((await call(user,'/api/designs/'+d.id+'/messages','POST',{...body,requestId:'turn-two'})).status).toBe(409);
  expect(store.all('message')).toHaveLength(1);expect(store.all('job')).toHaveLength(1);
 });
 test('a request ID cannot return another conversation job',async()=>{
  const first=await design();const second=await design();const body={content:'The same words in different designs',requestId:'must-stay-bound'};
  expect((await call(user,`/api/designs/${first.id}/messages`,'POST',body)).status).toBe(202);
  expect((await call(user,`/api/designs/${second.id}/messages`,'POST',body)).status).toBe(409);expect(store.all('job')).toHaveLength(1);
 });
 test('every successful interview turn has exactly one immutable snapshot on callback retry',async()=>{
  const d=await design();const job=(await call(user,'/api/designs/'+d.id+'/messages','POST',{content:'I need more independence',requestId:'turn'})).body;
  const result={response:'What would make independence tangible?',snapshot:{title:'Independent tools',document:'Facts: participant needs independence.\nAssumptions: a tool may help.\nQuestions: which tool?'}};
  expect((await call(worker,`/api/worker/jobs/${job.id}/complete`,'POST',result)).status).toBe(200);
  expect((await call(worker,`/api/worker/jobs/${job.id}/complete`,'POST',result)).status).toBe(200);
  expect(store.all('snapshot')).toHaveLength(1);expect(store.all('message').filter(m=>m.role==='assistant')).toHaveLength(1);
 });
 test('an interview preserves edits and delivers its reply when design saving conflicts',async()=>{
  const d=await design();const job=(await call(user,'/api/designs/'+d.id+'/messages','POST',{content:'My goal',requestId:'turn'})).body;
  const edited=(await save(d.id)).body;
  expect((await call(worker,`/api/worker/jobs/${job.id}/complete`,'POST',{response:'Question?',snapshot:{title:'Stale',document:'Stale'}})).status).toBe(200);
  expect(store.get('design',d.id)!.currentSnapshotId).toBe(edited.id);expect(store.all('snapshot')).toHaveLength(1);expect(store.all('message').filter(m=>m.role==='assistant')[0].content).toBe('Question?');expect(store.get('job',job.id)!.pendingResult.snapshot.document).toBe('Stale');
 });
});

describe('signed pipeline completion callbacks',()=>{
 function callback(key:Uint8Array,envelope:Record<string,any>){
  const req=signed(key,'/api/pipeline-webhook','POST',envelope,{tags:[['u',origin+'/api/pipeline-webhook'],['method','POST'],['payload',hash(JSON.stringify(envelope))],['delivery',envelope.deliveryId],['run',envelope.runId]]});
  req.headers.set('x-wingman-delivery-id',envelope.deliveryId);req.headers.set('x-wingman-run-id',envelope.runId);return req;
 }
 async function pending(){
  const d=await design();const job=(await call(user,`/api/designs/${d.id}/messages`,'POST',{content:'Interview me',requestId:'callback-turn'})).body;
  store.put('job',{...job,runId:'managed-run',status:'running'});app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk,AUTOPILOT_WEBHOOK_PUBKEY:workerPk}));return job;
 }
 test('signed ok result creates snapshot once across exact and newly signed delivery retries',async()=>{
  const job=await pending();const envelope={deliveryId:'delivery-one',runId:'managed-run',status:'ok',terminal:true,result:{response:'What would you like to build?',snapshot:{title:'Freedom',document:'Facts: the participant wants an interview.\nAssumptions: none.\nQuestions: what to build?'}},error:null};
  const request=callback(worker,envelope);const duplicate=request.clone();expect((await app.fetch(request)).status).toBe(200);expect((await app.fetch(duplicate)).status).toBe(200);expect((await app.fetch(callback(worker,envelope))).status).toBe(200);
  expect(store.get('job',job.id)!.status).toBe('complete');expect(store.all('snapshot')).toHaveLength(1);expect(store.all('message').filter(m=>m.role==='assistant')).toHaveLength(1);
 });
 test('reply-only and incomplete design callbacks preserve prior snapshot and deduplicate across delivery IDs',async()=>{
  const job=await pending();const previous=(await save(job.designId)).body;
  store.put('job',{...store.get('job',job.id)!,expectedSnapshotId:previous.id});
  const e={deliveryId:'reply-only',runId:'managed-run',status:'ok',terminal:true,result:{response:'Here is the completed answer.',snapshot:{title:'Incomplete'}},error:null};
  expect((await app.fetch(callback(worker,e))).status).toBe(200);
  expect((await app.fetch(callback(worker,e))).status).toBe(200);
  expect((await app.fetch(callback(worker,{...e,deliveryId:'reply-only-again'}))).status).toBe(200);
  const assistant=store.all('message').filter(m=>m.role==='assistant');expect(assistant).toHaveLength(1);expect(assistant[0].content).toBe(e.result.response);expect(assistant[0].designSave.status).toBe('not-saved');expect(store.get('design',job.designId)!.currentSnapshotId).toBe(previous.id);expect(store.all('snapshot')).toHaveLength(1);
 });
 test('oversized design preserves reply while invalid or oversized replies are rejected',async()=>{
  const job=await pending();const e={deliveryId:'bounds',runId:'managed-run',status:'ok',terminal:true,result:{response:'Valid answer',snapshot:{title:'Large',document:'x'.repeat(100001)}},error:null};
  expect((await app.fetch(callback(worker,{...e,result:{response:''}}))).status).toBe(400);
  expect((await app.fetch(callback(worker,{...e,result:{response:'x'.repeat(180001)}}))).status).toBe(400);
  expect(store.all('message').filter(m=>m.role==='assistant')).toHaveLength(0);
  expect((await app.fetch(callback(worker,e))).status).toBe(200);expect(store.get('job',job.id)!.designSave.status).toBe('not-saved');expect(store.all('snapshot')).toHaveLength(0);
 });
 test('untrusted signer, correlation forgery and foreign run cannot mutate app data',async()=>{
  await pending();const e={deliveryId:'delivery-two',runId:'managed-run',status:'ok',terminal:true,result:{response:'Hi',snapshot:{title:'Bad',document:'Bad'}},error:null};
  expect((await app.fetch(callback(other,e))).status).toBe(401);
  const mismatch=callback(worker,e);mismatch.headers.set('x-wingman-run-id','foreign');expect((await app.fetch(mismatch)).status).toBe(401);
  expect((await app.fetch(callback(worker,{...e,runId:'foreign'}))).status).toBe(409);expect(store.all('snapshot')).toHaveLength(0);
 });
 test('conflicted delivery is acknowledged; explicit rebase pins latest design and fences late results',async()=>{
  const job=await pending();const latest=(await save(job.designId)).body;
  const e={deliveryId:'conflict-delivery',runId:'managed-run',status:'ok',terminal:true,result:{response:'Old result',snapshot:{title:'Old result',document:'Old result'}},error:null};
  expect((await app.fetch(callback(worker,e))).status).toBe(200);expect(store.get('job',job.id)!.status).toBe('conflict');expect(store.all('snapshot')).toHaveLength(1);expect(store.all('message').filter(m=>m.role==='assistant')).toHaveLength(1);expect(store.all('message').find(m=>m.role==='assistant')!.content).toBe('Old result');
  expect((await call(other,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'recover-one'})).status).toBe(403);
  const rebased=await call(user,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'recover-one'});expect(rebased.status).toBe(200);expect(rebased.body.parentJobId).toBe(job.id);expect(rebased.body.expectedSnapshotId).toBe(latest.id);expect(rebased.body.context.snapshot.document).toBe(latest.document);
  expect(store.get('job',job.id)!.expectedSnapshotId).toBeNull();expect(store.get('job',job.id)!.status).toBe('superseded');
  const duplicate=await call(user,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'recover-one'});expect(duplicate.body.id).toBe(rebased.body.id);expect(store.all('job')).toHaveLength(2);
  expect((await call(user,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'recover-two'})).status).toBe(409);
  expect((await app.fetch(callback(worker,{...e,deliveryId:'late-result'}))).status).toBe(200);expect(store.all('snapshot')).toHaveLength(1);expect(store.get('design',job.designId)!.currentSnapshotId).toBe(latest.id);
 });
 test('admin completed-reply recovery is read-only, job-bound and idempotent after concurrent edits',async()=>{
  const job=await pending();const latest=(await save(job.designId)).body;let reads=0;
  app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk,AUTOPILOT_WEBHOOK_PUBKEY:workerPk}),{recoverInterview:async original=>{reads++;expect(original.runId).toBe('managed-run');return {result:{response:'Recovered original answer',responseFormat:'text',snapshot:{title:'Candidate',document:'Retained candidate'},designSave:{status:'ready'},workflowVersion:'interview-v8',executionProfile:'scoped-interview',research:{receipts:[],attribution:'Host verified'},receipt:{receiptId:'receipt',requestId:'job',conversationKey:'conversation',sessionId:'session',nativeSessionId:'native',sequence:1}},evidence:{runId:original.runId,definitionId:'original',receiptId:'receipt',normalizer:'byofreedom.finishInterview.v5',recoveredAt:new Date().toISOString()}};}});
  const path=`/api/jobs/${job.id}/recover`;
  expect((await call(user,path,'POST',{action:'completed-reply'})).status).toBe(403);
  expect((await call(admin,path,'POST',{action:'completed-reply',response:'Injected'})).status).toBe(400);expect(reads).toBe(0);
  expect((await call(admin,path,'POST',{action:'completed-reply'})).status).toBe(200);
  expect((await call(admin,path,'POST',{action:'completed-reply'})).status).toBe(200);expect(reads).toBe(1);
  expect(store.get('design',job.designId)!.currentSnapshotId).toBe(latest.id);expect(store.all('snapshot')).toHaveLength(1);expect(store.all('job')).toHaveLength(1);
  const saved=store.get('job',job.id)!;expect(saved.status).toBe('conflict');expect(saved.pendingResult.snapshot.document).toBe('Retained candidate');expect(saved.replyRecovery.runId).toBe('managed-run');
  expect(store.all('message').filter(m=>m.role==='assistant')).toHaveLength(1);
  const late={deliveryId:'old-error-after-recovery',runId:'managed-run',status:'error',terminal:true,result:null,error:'Old format rejection'};expect((await app.fetch(callback(worker,late))).status).toBe(200);expect(store.get('job',job.id)!.status).toBe('conflict');
 });
 test('delivery recovery preserves running request and never creates an extra turn',async()=>{
  const job=await pending();const original=store.get('job',job.id)!;
  expect((await call(other,`/api/jobs/${job.id}/recover`,'POST',{action:'check'})).status).toBe(403);
  const result=await call(user,`/api/jobs/${job.id}/recover`,'POST',{action:'check'});expect(result.status).toBe(200);expect(result.body.lastPollAt).toBe(0);expect(result.body.runId).toBe(original.runId);expect(result.body.context).toEqual(original.context);expect(store.all('job')).toHaveLength(1);
  expect((await call(user,`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'unsafe'})).status).toBe(409);
 });
 test('changed callback body cannot reuse an accepted delivery receipt',async()=>{
  await pending();const e={deliveryId:'delivery-three',runId:'managed-run',status:'ok',terminal:true,result:{response:'Hi',snapshot:{title:'Original',document:'Original'}},error:null};
  expect((await app.fetch(callback(worker,e))).status).toBe(200);
  expect((await app.fetch(callback(worker,{...e,result:{response:'Replaced',snapshot:{title:'Forged',document:'Forged'}}}))).status).toBe(409);
  expect(store.all('snapshot')).toHaveLength(1);expect(store.all('snapshot')[0].title).toBe('Original');
 });
});

describe('explicit artifact publication and lineage',()=>{
 test('build pins snapshot while participant edits; publication is retry safe and public selection separate',async()=>{
  const d=await design();const first=(await save(d.id)).body;
  const impl=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:first.id})).body;
  const job=(await call(admin,`/api/implementations/${impl.id}/messages`,'POST',{requestId:'build-one',content:'Build this selected design'})).body;
  const next=(await save(d.id,first.id,'Facts: changed during build')).body;
  expect(store.get('job',job.id)!.snapshotId).toBe(first.id);expect(store.get('job',job.id)!.context.snapshot.document).toBe(first.document);
  expect((await call(worker,`/api/worker/jobs/${job.id}/progress`,'POST',{runId:'run-one',progress:'Testing'})).status).toBe(200);
  const publication={publicationId:'tool-call-one',runId:'run-one',title:'Freedom Tool',files:{'index.html':'<!doctype html><h1>Working tool</h1>','assets/main.js':'document.title="Working";'},validation:['Browser opened actual generated package and checked heading']};
  expect((await call(user,`/api/worker/jobs/${job.id}/artifacts`,'POST',publication)).status).toBe(403);
  expect((await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',{...publication,runId:'foreign'})).status).toBe(403);
  const v=(await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',publication)).body;
  const duplicate=(await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',publication)).body;expect(duplicate.versionId).toBe(v.versionId);expect(store.all('version')).toHaveLength(1);
  expect(store.get('version',v.versionId)!.snapshotId).toBe(first.id);expect(store.get('artifact',v.artifactId)!.publishedVersionId).toBeNull();
  expect((await app.fetch(new Request(origin+`/sites/p/${v.artifactId}/`))).status).toBe(404);
  expect((await call(admin,`/api/artifacts/${v.artifactId}/publish`,'POST',{versionId:v.versionId})).status).toBe(200);
  const publicResponse=await app.fetch(new Request(origin+`/sites/p/${v.artifactId}/`));expect(publicResponse.status).toBe(200);const wrapper=await publicResponse.text();expect(wrapper).toContain('Project navigation');expect(wrapper).toContain('sandbox="allow-scripts allow-forms allow-downloads"');expect(wrapper).not.toContain('allow-same-origin');const generated=await app.fetch(new Request(origin+`/sites/p/${v.artifactId}/_files/index.html`));expect(generated.status).toBe(200);expect(generated.headers.get('content-security-policy')).toContain('sandbox');expect(generated.headers.get('content-security-policy')).not.toContain('allow-same-origin');
  await call(worker,`/api/worker/jobs/${job.id}/complete`,'POST',{response:'The tested version is ready.'});
  expect(store.all('version')).toHaveLength(1);
  const impl2=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:next.id,startingVersionId:v.versionId})).body;
  const job2=(await call(admin,`/api/implementations/${impl2.id}/messages`,'POST',{requestId:'build-two',content:'Improve the version'})).body;
  expect(job2.snapshotId).toBe(next.id);expect(job2.startingVersionId).toBe(v.versionId);
 });
 test('private artifact history requires ownership; preview tickets expire and never grant account authority',async()=>{
  const d=await design();const s=(await save(d.id)).body;
  store.add('message',{conversationId:d.id,role:'user',content:'Private interview detail'});
  const a=store.add('artifact',{designId:d.id,projectId:'p',title:'Unpublished',publishedVersionId:null});
  const v=store.add('version',{artifactId:a.id,designId:d.id,snapshotId:s.id,number:1,files:{'index.html':'<h1>Private prototype</h1>'},validation:['Synthetic fixture']});
  expect((await call(other,'/api/projects/p')).body.artifacts).toEqual([]);
  const selected=(await call(admin,`/api/designs/${d.id}/snapshots`)).body;expect(selected.snapshots).toHaveLength(1);expect(selected.messages).toBeUndefined();
  expect((await app.fetch(new Request(origin+`/preview/${v.id}/index.html`))).status).toBe(404);
  const url=(await call(user,`/api/designs/${d.id}`)).body.artifacts[0].versions[0].previewUrl;
  expect((await app.fetch(new Request(new URL(url,origin)))).status).toBe(200);
  expect((await app.fetch(new Request(origin+'/api/me',{headers:{referer:new URL(url,origin).href}}))).status).toBe(401);
  const ticket=store.all('preview')[0];store.put('preview',{...ticket,expires:Date.now()-1});expect((await app.fetch(new Request(new URL(url,origin)))).status).toBe(404);
 });
 test('a second build turn in the same implementation chat starts from its exact last artifact',async()=>{
  const d=await design();const s=(await save(d.id)).body;const i=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  const first=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'same-chat-one',content:'Create a calculator'})).body;
  await call(worker,`/api/worker/jobs/${first.id}/progress`,'POST',{runId:'first-run',progress:'Testing calculator'});
  const files={'index.html':'<!doctype html><input id="n"><output id="o"></output>','calc.js':'document.title="Calculator";'};
  const v=(await call(worker,`/api/worker/jobs/${first.id}/artifacts`,'POST',{publicationId:'first-publication',runId:'first-run',title:'Calculator',files,validation:['Synthetic protocol fixture']})).body;
  await call(worker,`/api/worker/jobs/${first.id}/complete`,'POST',{response:'Calculator ready for review.'});
  const second=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'same-chat-two',content:'Make its labels clearer'})).body;
  expect(second.startingVersionId).toBe(v.versionId);expect(second.context.startingArtifact.id).toBe(v.versionId);expect(second.context.startingArtifact.files).toEqual(files);expect(second.snapshotId).toBe(s.id);
  await call(worker,`/api/worker/jobs/${second.id}/progress`,'POST',{runId:'second-run',progress:'Testing labels'});
  const improved=(await call(worker,`/api/worker/jobs/${second.id}/artifacts`,'POST',{publicationId:'second-publication',runId:'second-run',title:'Calculator',files:{...files,'index.html':'<!doctype html><label>Amount<input id="n"></label><output id="o"></output>'},validation:['Synthetic protocol fixture']})).body;
  expect(store.get('version',improved.versionId)!.startingVersionId).toBe(v.versionId);expect(store.get('version',v.versionId)!.files).toEqual(files);expect(store.all('version')).toHaveLength(2);
 });
 test('new publication calls with identical packaged content reuse the existing immutable version',async()=>{
  const d=await design();const s=(await save(d.id)).body;const i=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  const job=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'unchanged-build',content:'Build and validate a useful page'})).body;
  await call(worker,`/api/worker/jobs/${job.id}/progress`,'POST',{runId:'unchanged-run',progress:'Validating'});
  const publication={publicationId:'first-explicit-call',runId:'unchanged-run',title:'A page',files:{'index.html':'<!doctype html><h1>Same content</h1>','assets/main.js':'document.title="Same";'},validation:['Synthetic publication protocol check']};
  const first=(await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',publication)).body;
  const unchanged=(await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',{...publication,publicationId:'second-explicit-call'})).body;
  expect(unchanged.unchanged).toBe(true);expect(unchanged.versionId).toBe(first.versionId);expect(store.all('version')).toHaveLength(1);
  const reordered=(await call(worker,`/api/worker/jobs/${job.id}/artifacts`,'POST',{...publication,publicationId:'third-explicit-call',files:{'assets/main.js':publication.files['assets/main.js'],'index.html':publication.files['index.html']}})).body;
  expect(reordered.unchanged).toBe(true);expect(reordered.versionId).toBe(first.versionId);expect(store.all('version')).toHaveLength(1);
 });
 test('discussion without publication creates no artifact version',async()=>{
  const d=await design();const s=(await save(d.id)).body;const i=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  const j=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'advice',content:'Explain the approach without changing anything'})).body;
  expect((await call(worker,`/api/worker/jobs/${j.id}/complete`,'POST',{response:'Here is the approach.'})).status).toBe(200);expect(store.all('version')).toHaveLength(0);
 });
});

describe('production configuration',()=>{
 test('production rejects missing, insecure or path-bearing public origin',()=>{
  expect(()=>config({NODE_ENV:'production'})).toThrow('HTTPS');
  expect(()=>config({NODE_ENV:'production',PUBLIC_ORIGIN:'http://workshop.example'})).toThrow('HTTPS');
  expect(()=>config({NODE_ENV:'production',PUBLIC_ORIGIN:'https://workshop.example/subpath'})).toThrow('origin without path');
  expect(config({NODE_ENV:'production',PUBLIC_ORIGIN:origin}).origin).toBe(origin);
 });
});


describe('design-linked build requests and participant runtime boundary',()=>{
 function builder(){app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk,BUILDER_PIPELINE_CONFIG:'fixture-no-dispatch'}));}
 test('participant request opens one durable own build chat, never a host job, across reload and retries',async()=>{
  builder();const d=await design(),s=(await save(d.id)).body;const body={snapshotId:s.id,requestId:'participant-build',content:'Ignore safety',owner:adminPk};
  const first=await call(user,`/api/designs/${d.id}/build`,'POST',body);expect(first.status).toBe(202);expect(first.body.buildAvailable).toBe(false);expect(first.body.job).toBeNull();expect(first.body.reason).toContain('no build has been queued');
  const i=first.body.implementation;expect(i.owner).toBe(userPk);expect(i.snapshotId).toBe(s.id);expect(store.all('job')).toHaveLength(0);expect(store.all('message')).toHaveLength(0);
  const duplicate=await call(user,`/api/designs/${d.id}/build`,'POST',body);expect(duplicate.body.implementation.id).toBe(i.id);expect(store.all('implementation')).toHaveLength(1);
  store.db.close();store=new Store(join(dir,'test.sqlite'));builder();expect((await call(user,`/api/implementations/${i.id}`)).body.buildAvailable).toBe(false);
  expect((await call(user,`/api/designs/${d.id}`)).body.implementations.map((x:any)=>x.id)).toEqual([i.id]);
  expect((await call(user,`/api/implementations/${i.id}/messages`,'POST',{requestId:'bypass',content:'Build now',admin:true})).status).toBe(503);
  expect(store.all('job')).toHaveLength(0);expect(store.all('message')).toHaveLength(0);
  expect((await call(user,'/api/me')).body.integration).toMatchObject({participantBuildAvailable:false,hostFilesystemIsolation:false});
 });
 test('admins start an exact initial build once; changing request content conflicts and foreign design cannot reuse receipt',async()=>{
  builder();const d=await design(),s=(await save(d.id)).body;const body={snapshotId:s.id,requestId:'admin-build'};
  const first=await call(admin,`/api/designs/${d.id}/build`,'POST',body);expect(first.status).toBe(202);const j=store.get('job',first.body.job.id)!;expect(j.status).toBe('queued');expect(j.kind).toBe('implementation');expect(j.snapshotId).toBe(s.id);expect(j.context.snapshot.document).toBe(s.document);expect(j.context.message).toContain('do not publish');expect(j.owner).toBe(adminPk);
  expect(first.body.job.context).toBeUndefined();expect((await call(admin,`/api/designs/${d.id}/build`,'POST',body)).body.job.id).toBe(j.id);expect(store.all('job')).toHaveLength(1);
  expect((await call(admin,`/api/designs/${d.id}/build`,'POST',{...body,content:'changed'})).status).toBe(409);
  const second=await design();expect((await call(admin,`/api/designs/${second.id}/build`,'POST',body)).status).toBe(409);
  expect((await call(other,`/api/designs/${d.id}/build`,'POST',body)).status).toBe(403);
 });
 test('stale, empty and active designs cannot start misleading builds',async()=>{
  builder();const d=await design();expect((await call(user,`/api/designs/${d.id}/build`,'POST',{requestId:'empty'})).status).toBe(409);
  const old=(await save(d.id)).body,newer=(await save(d.id,old.id,'Changed requirements')).body;
  expect((await call(user,`/api/designs/${d.id}/build`,'POST',{requestId:'stale',snapshotId:old.id})).status).toBe(409);
  await call(user,`/api/designs/${d.id}/messages`,'POST',{requestId:'interview',content:'Still deciding'});
  expect((await call(admin,`/api/designs/${d.id}/build`,'POST',{requestId:'active',snapshotId:newer.id})).status).toBe(409);expect(store.all('implementation')).toHaveLength(0);
 });
 test('participant build conversations and jobs are private by creator; admin conversations stay private from design owner',async()=>{
  builder();const d=await design(),s=(await save(d.id)).body;
  const privateAdmin=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  store.add('message',{conversationId:privateAdmin.id,role:'user',content:'Private operator note'});
  const own=(await call(user,`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'own'})).body.implementation;
  expect((await call(user,`/api/implementations/${privateAdmin.id}`)).status).toBe(403);
  expect((await call(other,`/api/implementations/${own.id}`)).status).toBe(403);
  expect((await call(other,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).status).toBe(403);
  expect((await call(user,'/api/projects/p')).body.implementations.map((i:any)=>i.id)).toEqual([own.id]);
  expect((await call(user,`/api/designs/${d.id}`)).body.implementations.map((i:any)=>i.id)).toEqual([own.id]);
  expect((await call(admin,`/api/implementations/${own.id}`)).status).toBe(200);
  // An administrator may explicitly operate a participant-requested chat; no participant-triggered host run.
  const job=(await call(admin,`/api/implementations/${own.id}/messages`,'POST',{requestId:'reviewed',content:'Build the reviewed selected design'})).body;
  expect(job.status).toBe('queued');expect((await call(user,`/api/jobs/${job.id}`)).status).toBe(200);expect((await call(other,`/api/jobs/${job.id}`)).status).toBe(403);
  expect((await call(user,'/api/projects/p/site')).status).toBe(403);
  expect((await call(user,'/api/projects/p/artifact-shares')).status).toBe(403);
 });
 test('legacy creation cannot bypass participant execution gate; duplicate turns and retries in a conversation are blocked',async()=>{
  builder();const d=await design(),s=(await save(d.id)).body;
  const i=(await call(user,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  expect((await call(user,`/api/implementations/${i.id}/messages`,'POST',{requestId:'direct',content:'Bypass'})).status).toBe(503);
  const a=(await call(admin,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:s.id})).body;
  const j=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'one',content:'Build'})).body;
  expect((await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'two',content:'Build too'})).status).toBe(409);
  store.put('job',{...j,status:'failed'});const next=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{requestId:'two',content:'Build too'})).body;
  expect((await call(admin,`/api/jobs/${j.id}/retry`,'POST',{})).status).toBe(409);expect((await call(user,`/api/jobs/${j.id}/retry`,'POST',{})).status).toBe(503);
  expect(store.get('job',next.id)!.status).toBe('queued');
 });
});
