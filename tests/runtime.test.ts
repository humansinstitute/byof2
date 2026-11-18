import {expect,test} from 'bun:test';
import {mkdtempSync,rmSync,statSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pipelineJobInput,shouldRetryDelivery,pipelineBinding,startDispatcher} from '../src/dispatcher';
import {Store} from '../src/store';
import type {RemotePipelineConfig} from '../integration/remote-pipelines';
import {materializePipelineCredentials} from '../src/credentials';

test('lost-acceptance retries keep identical immutable pipeline input',()=>{
 const original={id:'job-one',kind:'interview',conversationId:'conversation',projectId:'project',designId:'design',snapshotId:'snapshot-one',startingVersionId:null,context:{message:'Help me develop my vision',history:[],snapshot:{id:'snapshot-one',document:'Authoritative facts'}},status:'queued',attempts:0,progress:'Waiting',createdAt:'2026-01-01'};
 const retry={...original,status:'uncertain',attempts:4,progress:'Recovering',lastAttemptAt:Date.now(),error:'HTTP response lost',recoveryRequestedAt:Date.now()};
 expect(JSON.stringify(pipelineJobInput(retry))).toBe(JSON.stringify(pipelineJobInput(original)));
 expect(pipelineJobInput(retry)).not.toHaveProperty('attempts');expect(pipelineJobInput(retry)).not.toHaveProperty('status');expect(pipelineJobInput(retry)).not.toHaveProperty('error');
 const changed={...retry,context:{...retry.context,snapshot:{id:'snapshot-two',document:'Other'}}};expect(JSON.stringify(pipelineJobInput(changed))).not.toBe(JSON.stringify(pipelineJobInput(original)));
});

test('opaque pipeline grants become mode600 server files and leave environment',()=>{
 const dir=mkdtempSync(join(tmpdir(),'byo-grant-test-'));
 try{
  const env:Record<string,string|undefined>={INTERVIEW_PIPELINE_CREDENTIAL:'synthetic-opaque-grant-not-a-key',INTERVIEW_PIPELINE_CONFIG:JSON.stringify({installationId:'synthetic-installation',callbackUrl:'https://workshop.example/api/pipeline-webhook'})};
  materializePipelineCredentials(join(dir,'byo.sqlite'),env);const cfg=JSON.parse(env.INTERVIEW_PIPELINE_CONFIG!);
  expect(env.INTERVIEW_PIPELINE_CREDENTIAL).toBeUndefined();expect(readFileSync(cfg.credentialFile,'utf8')).toBe('synthetic-opaque-grant-not-a-key');expect(statSync(cfg.credentialFile).mode&0o777).toBe(0o600);expect(statSync(join(dir,'execution-grants')).mode&0o777).toBe(0o700);expect(cfg.callbackUrl).toBe('https://workshop.example/api/pipeline-webhook');
  // Rotation must tighten an existing file too, rather than relying on creation mode.
  env.INTERVIEW_PIPELINE_CREDENTIAL='synthetic-replacement';materializePipelineCredentials(join(dir,'byo.sqlite'),env);expect(readFileSync(cfg.credentialFile,'utf8')).toBe('synthetic-replacement');expect(statSync(cfg.credentialFile).mode&0o777).toBe(0o600);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('grant materialization refuses missing configuration and multiline values',()=>{
 const dir=mkdtempSync(join(tmpdir(),'byo-grant-denial-'));
 try{
  expect(()=>materializePipelineCredentials(join(dir,'byo.sqlite'),{INTERVIEW_PIPELINE_CREDENTIAL:'synthetic'})).toThrow('Missing INTERVIEW');
  expect(()=>materializePipelineCredentials(join(dir,'byo.sqlite'),{INTERVIEW_PIPELINE_CREDENTIAL:'synthetic\ninjected',INTERVIEW_PIPELINE_CONFIG:'{}'})).toThrow('Invalid opaque');
 }finally{rmSync(dir,{recursive:true,force:true});}
});


test('failed delivery retries require a new explicit recovery action and never duplicate the run',()=>{
 const job={id:'job',runId:'the-original-run',status:'running',context:{snapshot:{id:'immutable'}}};
 expect(shouldRetryDelivery(job,{status:'failed'})).toBe(false);
 const requested={...job,recoveryRequestedAt:100};
 expect(shouldRetryDelivery(requested,{status:'failed'})).toBe(true);
 for(const status of ['pending','delivering','delivered','complete'])expect(shouldRetryDelivery(requested,{status})).toBe(false);
 expect(shouldRetryDelivery(requested,undefined)).toBe(false);
 const retried={...requested,lastDeliveryRetryAt:101};expect(shouldRetryDelivery(retried,{status:'failed'})).toBe(false);
 expect(shouldRetryDelivery({...retried,recoveryRequestedAt:101},{status:'failed'})).toBe(false);
 expect(shouldRetryDelivery({...retried,recoveryRequestedAt:102},{status:'failed'})).toBe(true);
 expect(retried.runId).toBe(job.runId);expect(retried.context).toEqual(job.context);
});


test('lost acceptance cannot start another run under a changed workflow binding',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'byo-binding-test-'));const store=new Store(join(dir,'app.sqlite'));
 const original:RemotePipelineConfig={origin:'https://autopilot.example',clientOrigin:'https://workshop.example',installationId:'installation-original',appId:'app-original',ownerNpub:'synthetic-public-owner',definitionId:'interview-v1',callbackUrl:'https://workshop.example/api/pipeline-webhook',credentialFile:'/unused/synthetic.capability',appPubkey:'a'.repeat(64)};
 const env={INTERVIEW_PIPELINE_CONFIG:JSON.stringify(original)};const submits:{input:unknown,key:string}[]=[];let accepts=false;
 const fake=(()=>({submit:async(input:unknown,key:string)=>{submits.push({input:structuredClone(input),key});if(!accepts)throw Error('Accepted remotely but HTTP response lost');return {response:{runId:'original-accepted-run'},httpStatus:202,receipt:{}};},poll:async()=>({response:{status:'running'}}),delivery:async()=>({response:{delivery:{status:'pending'}}}),retryDelivery:async()=>{throw Error('No retry expected');},signer:async()=>({response:{}})})) as any;
 store.put('job',{id:'lost-acceptance',kind:'interview',conversationId:'conversation',projectId:'project',designId:'design',snapshotId:'snapshot-original',startingVersionId:null,context:{message:'My original interview request',snapshot:{id:'snapshot-original',document:'Original facts'},history:[]},status:'queued',attempts:0});
 const worker=startDispatcher(store,env,fake);
 try{
  await worker.ready;expect(submits).toHaveLength(1);expect(store.get('job','lost-acceptance')!.status).toBe('uncertain');expect(store.get('job','lost-acceptance')!.dispatchBinding).toEqual(pipelineBinding(original));
  for(const changed of [{...original,definitionId:'interview-v2'},{...original,installationId:'replacement-installation'},{...original,origin:'https://other-autopilot.example'}]){
   env.INTERVIEW_PIPELINE_CONFIG=JSON.stringify(changed);store.put('job',{...store.get('job','lost-acceptance')!,lastAttemptAt:0});await worker.tick();expect(submits).toHaveLength(1);const blocked=store.get('job','lost-acceptance')!;expect(blocked.error).toBe('workflow_binding_changed');expect(blocked.dispatchBinding).toEqual(pipelineBinding(original));expect(blocked.attempts).toBe(1);
  }
  accepts=true;env.INTERVIEW_PIPELINE_CONFIG=JSON.stringify(original);store.put('job',{...store.get('job','lost-acceptance')!,lastAttemptAt:0});await worker.tick();expect(submits).toHaveLength(2);expect(submits[1]).toEqual(submits[0]);expect(store.get('job','lost-acceptance')!.runId).toBe('original-accepted-run');expect(store.get('job','lost-acceptance')!.dispatchBinding).toEqual(pipelineBinding(original));
 }finally{worker.stop();store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('legacy attempted jobs without a pinned binding require reconciliation instead of submission',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'byo-legacy-binding-'));const store=new Store(join(dir,'app.sqlite'));let submissions=0;
 const cfg={origin:'https://autopilot.example',clientOrigin:'https://workshop.example',installationId:'installation',appId:'app',ownerNpub:'synthetic-owner',definitionId:'definition',callbackUrl:'https://workshop.example/api/pipeline-webhook',credentialFile:'/unused',appPubkey:'b'.repeat(64)};
 store.put('job',{id:'legacy',kind:'interview',status:'uncertain',attempts:1,lastAttemptAt:0,context:{message:'Previously attempted'}});
 const worker=startDispatcher(store,{INTERVIEW_PIPELINE_CONFIG:JSON.stringify(cfg)},(()=>({submit:async()=>{submissions++;throw Error('Must not submit');}})) as any);
 try{await worker.ready;expect(submissions).toBe(0);expect(store.get('job','legacy')!.error).toBe('workflow_binding_changed');expect(store.get('job','legacy')!.attempts).toBe(1);}finally{worker.stop();store.db.close();rmSync(dir,{recursive:true,force:true});}
});
