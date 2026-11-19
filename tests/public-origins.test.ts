import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {config,MAX_PUBLIC_ORIGIN_ALIASES} from '../src/config';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {hash,ADMINS} from '../src/auth';
import {pipelineBinding,pipelineJobInput,startDispatcher} from '../src/dispatcher';
import {createInterviewImages} from '../src/interview-images';
import {createRemotePipelines} from '../integration/remote-pipelines';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const canonical='https://new.example',legacy='https://previous.example',evil='https://unconfigured.example';
const key=generateSecretKey(),owner=getPublicKey(key),worker=generateSecretKey();
const env={NODE_ENV:'production',PUBLIC_ORIGIN:canonical,PUBLIC_ORIGIN_ALIASES:legacy,AUTOPILOT_WEBHOOK_PUBKEY:getPublicKey(worker),INTERVIEW_PIPELINE_CONFIG:'fixture',INTERVIEW_WORKFLOW_VERSION:'interview-v6',INTERVIEW_SCOPED_TOOLS:'1'};
let store:Store,app:ReturnType<typeof createApp>;
function signed(origin:string,path='/api/me',method='GET',body='',options:{signedPath?:string;signedOrigin?:string;tags?:string[][];time?:number;badSignature?:boolean;signer?:Uint8Array}={}){
 const event=finalizeEvent({kind:27235,created_at:options.time??Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:options.tags??[['u',(options.signedOrigin??origin)+(options.signedPath??path)],['method',method],...(['PATCH','POST','PUT','DELETE'].includes(method)||body?[['payload',hash(body)]]:[])]},options.signer??key);
 if(options.badSignature)event.sig='0'.repeat(128);
 return new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64'),'content-type':'application/json'},...(body?{body}:{})});
}
function callback(origin:string,envelope:any,options:Parameters<typeof signed>[4]={}){
 const body=JSON.stringify(envelope),path='/api/pipeline-webhook';
 const req=signed(origin,path,'POST',body,{signer:worker,tags:[['u',origin+path],['method','POST'],['payload',hash(body)],['delivery',envelope.deliveryId],['run',envelope.runId]],...options});
 req.headers.set('x-wingman-run-id',envelope.runId);req.headers.set('x-wingman-delivery-id',envelope.deliveryId);return req;
}
beforeEach(()=>{store=new Store(':memory:');app=createApp(store,config(env));store.put('project',{id:'p',title:'Migration fixture',joinCode:'TEST'});store.put('membership',{id:'p:'+owner,projectId:'p',pubkey:owner});store.put('design',{id:'d',projectId:'p',owner,currentSnapshotId:null});store.put('conversation',{id:'d',designId:'d',owner,kind:'interview'});});
afterEach(()=>store.db.close());

describe('explicit public origin configuration',()=>{
 test('single origin remains the default and aliases are bounded and deduplicated',()=>{
  expect(config({PUBLIC_ORIGIN:canonical}).origins).toEqual([canonical]);
  expect(config({...env,PUBLIC_ORIGIN_ALIASES:`${legacy}, ${canonical},${legacy}`}).origins).toEqual([canonical,legacy]);
  expect(()=>config({...env,PUBLIC_ORIGIN_ALIASES:Array(MAX_PUBLIC_ORIGIN_ALIASES+1).fill(legacy).join(',')})).toThrow();
 });
 test('canonical and aliases reject non-origins and non-HTTPS production settings',()=>{
  const invalid=['https://*.example','https://user:password@example.org','https://example.org/','https://example.org/path','https://example.org?x=1','https://example.org#x','https://example.org?','https://example.org#','https://example.org\\path','https://example.org\n','https://example.org:443','https://EXAMPLE.org','http://example.org','ftp://example.org','null','garbage'];
  for(const value of invalid){expect(()=>config({...env,PUBLIC_ORIGIN:value})).toThrow();expect(()=>config({...env,PUBLIC_ORIGIN_ALIASES:value})).toThrow();}
  for(const value of [',',legacy+',',','+legacy,' '.repeat(9000),'https://'+'a'.repeat(2048)+'.example'])expect(()=>config({...env,PUBLIC_ORIGIN_ALIASES:value})).toThrow();
  expect(()=>config({NODE_ENV:'production'})).toThrow();expect(config({PUBLIC_ORIGIN:'http://localhost:3344'}).origins).toEqual(['http://localhost:3344']);
 });
});

describe('NIP-98 origin migration',()=>{
 test('old and new exact signed GET and exact-body mutation work; replay is shared',async()=>{
  for(const origin of [canonical,legacy]){
   const req=signed(origin,'/api/me?exact=%2F&n=1'),duplicate=req.clone();const response=await app.fetch(req);expect(response.status).toBe(200);expect((await response.json()).publicOrigin).toBe(canonical);expect((await app.fetch(duplicate)).status).toBe(409);
   const body='{ "name" : "Exact body" }';expect((await app.fetch(signed(origin,'/api/profile','PATCH',body))).status).toBe(200);expect(store.get('profile',owner)!.name).toBe('Exact body');
  }
  // A proxy may use an internal transport URL. Only the configured signed origin is authority.
  const req=signed(legacy);expect((await app.fetch(new Request('http://internal:3000/api/me',{headers:req.headers}))).status).toBe(200);
  app=createApp(store,config({PUBLIC_ORIGIN:canonical}));expect((await app.fetch(signed(legacy))).status).toBe(401);
 });
 test('unconfigured origins and spoofed host headers cannot authorize requests',async()=>{
  for(const origin of [canonical,legacy]){
   const valid=signed(origin);valid.headers.set('host','evil.example');valid.headers.set('forwarded','host=evil.example;proto=http');valid.headers.set('x-forwarded-host','evil.example');valid.headers.set('x-forwarded-proto','http');expect((await app.fetch(valid)).status).toBe(200);
   const bad=signed(origin,'/api/me','GET','',{signedOrigin:evil});bad.headers.set('host','unconfigured.example');bad.headers.set('x-forwarded-host','unconfigured.example');expect((await app.fetch(bad)).status).toBe(401);
  }
  expect((await app.fetch(signed(evil))).status).toBe(401);
 });
 test('path, query, method, body bytes, signature, timestamp and duplicate URL tags remain exact',async()=>{
  for(const origin of [canonical,legacy]){
   for(const signedPath of ['/api/projects','/api/me?q=other','/api/me?q=%2f','/api/me?q=%2F&extra=1'])expect((await app.fetch(signed(origin,'/api/me?q=%2F','GET','',{signedPath}))).status).toBe(401);
   for(const options of [{badSignature:true},{time:1},{time:Math.floor(Date.now()/1000)+120},{tags:[['u',origin+'/api/me'],['u',origin+'/api/me'],['method','GET']]},{tags:[['u',origin+'/api/me'],['method','POST']]}])expect((await app.fetch(signed(origin,'/api/me','GET','',options))).status).toBe(401);
   const req=signed(origin,'/api/profile','PATCH','{"name":"Exact body"}');expect((await app.fetch(new Request(req.url,{method:'PATCH',headers:req.headers,body:'{ "name": "Exact body" }'}))).status).toBe(401);
  }
  expect(store.get('profile',owner)).toBeUndefined();
 });
});

describe('callback migration',()=>{
 const envelope=(deliveryId:string)=>({deliveryId,runId:'original-run',status:'ok',terminal:true,result:{response:'An original result',snapshot:{title:'Original',document:'Preserved requirements'}},error:null});
 function pending(){store.put('job',{id:'j',designId:'d',projectId:'p',conversationId:'d',kind:'interview',owner,status:'running',runId:'original-run',expectedSnapshotId:null});}
 test('canonical and explicit legacy callbacks retain full body/run verification and idempotence',async()=>{
  pending();const body=envelope('one');const req=callback(legacy,body),duplicate=req.clone();expect((await app.fetch(req)).status).toBe(200);expect((await app.fetch(duplicate)).status).toBe(200);expect((await app.fetch(callback(canonical,body))).status).toBe(200);expect(store.all('snapshot')).toHaveLength(1);expect(store.get('job','j')!.status).toBe('complete');
  expect((await app.fetch(callback(legacy,{...body,result:{...body.result,response:'Changed'}}))).status).toBe(409);
 });
 test('new canonical callback can independently complete its registered run',async()=>{pending();expect((await app.fetch(callback(canonical,envelope('new')))).status).toBe(200);expect(store.all('snapshot')).toHaveLength(1);});
 test('unconfigured URL, changed query/body, signature, age, run or correlation cannot apply results',async()=>{
  pending();const body=envelope('denied');
  for(const req of [callback(evil,body),callback(legacy,body,{signer:key}),callback(legacy,body,{badSignature:true}),callback(legacy,body,{time:1})]){req.headers.set('x-forwarded-host','unconfigured.example');expect((await app.fetch(req)).status).toBe(401);}
  for(const origin of [canonical,legacy]){
   const req=callback(origin,body);expect((await app.fetch(new Request(req.url,{method:'POST',headers:req.headers,body:JSON.stringify({...body,status:'error'})}))).status).toBe(401);
   const query=callback(origin,body);expect((await app.fetch(new Request(query.url+'?extra=1',{method:'POST',headers:query.headers,body:await query.text()}))).status).toBe(401);
   const queryPath='/api/pipeline-webhook?extra=1',serialized=JSON.stringify(body);
   const signedQuery=signed(origin,queryPath,'POST',serialized,{signer:worker,tags:[['u',origin+queryPath],['method','POST'],['payload',hash(serialized)],['delivery',body.deliveryId],['run',body.runId]]});signedQuery.headers.set('x-wingman-run-id',body.runId);signedQuery.headers.set('x-wingman-delivery-id',body.deliveryId);expect((await app.fetch(signedQuery)).status).toBe(401);
   const badRun=callback(origin,body);badRun.headers.set('x-wingman-run-id','foreign');expect((await app.fetch(badRun)).status).toBe(401);
   expect((await app.fetch(callback(origin,{...body,runId:'foreign'}))).status).toBe(409);
  }
  expect(store.all('snapshot')).toHaveLength(0);expect(store.get('job','j')!.status).toBe('running');
 });
});

test('origin migration preserves old v6 binding, immutable native image URL, uncertain retry and original run recovery',async()=>{
 const cfg={origin:'https://autopilot.example',clientOrigin:legacy,installationId:'original-installation',appId:'original-app',ownerNpub:'fixture-owner',definitionId:'interview-v6',callbackUrl:legacy+'/api/pipeline-webhook',credentialFile:'/unused-synthetic-grant',appPubkey:'a'.repeat(64)};
 const raw=JSON.stringify(cfg),dispatchEnv={...env,INTERVIEW_PIPELINE_CONFIG:raw};
 const image=createInterviewImages(store).upload(owner,'d',{name:'ref.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='});
 store.put('message',{id:'m',conversationId:'d',author:owner,imageIds:[image.id]});
 store.put('job',{id:'abcd',kind:'interview',owner,designId:'d',conversationId:'d',projectId:'p',messageId:'m',status:'queued',attempts:0,context:{attachments:[{id:image.id}],message:'Original input',history:[]}});
 const calls:any[]=[];let accepted=false;const clientFactory=((actual:any)=>{expect(actual).toEqual(cfg);return {submit:async(input:any,id:string)=>{calls.push({input:structuredClone(input),id});if(!accepted)throw Error('Acceptance response lost');return {response:{runId:'original-run'},receipt:{}};},poll:async(id:string)=>{calls.push({poll:id});return {response:{status:'running'}};},delivery:async(id:string)=>{calls.push({delivery:id});return {response:{delivery:{status:'failed'}}};},retryDelivery:async(id:string)=>{calls.push({retry:id});}};}) as any;
 const dispatcher=startDispatcher(store,dispatchEnv,clientFactory);
 try{
  await dispatcher.ready;const uncertain=store.get('job','abcd')!,input=pipelineJobInput(uncertain);expect(uncertain.status).toBe('uncertain');expect(uncertain.dispatchBinding).toEqual(pipelineBinding(cfg));expect(uncertain.context.attachmentSource.url).toBe(legacy+'/api/interview-job-images/abcd');
  app=createApp(store,config(dispatchEnv));accepted=true;store.put('job',{...uncertain,lastAttemptAt:0});await dispatcher.tick();expect(calls[1]).toEqual(calls[0]);expect(store.get('job','abcd')!.runId).toBe('original-run');expect(pipelineJobInput(store.get('job','abcd')!)).toEqual(input);
  const source=uncertain.context.attachmentSource;const response=await app.fetch(new Request(source.url,{headers:{'x-byo-image-ticket':source.ticket,'x-byo-image-id':image.id,'x-wingman-run-id':'original-run'}}));expect(response.status).toBe(200);expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(await createInterviewImages(store).response(owner,'d',image.id).arrayBuffer()));
  const recovery=await app.fetch(signed(canonical,'/api/jobs/abcd/recover','POST','{"action":"check"}'));expect(recovery.status).toBe(200);await dispatcher.tick();expect(calls).toContainEqual({retry:'original-run'});expect(calls.filter(c=>c.input)).toHaveLength(2);expect(pipelineJobInput(store.get('job','abcd')!)).toEqual(input);expect(dispatchEnv.INTERVIEW_PIPELINE_CONFIG).toBe(raw);expect(store.get('job','abcd')!.dispatchBinding).toEqual(pipelineBinding(cfg));
 }finally{dispatcher.stop();}
});

test('new preview URLs, library CSP and SDK context use canonical origin while managed storage stays absent',async()=>{
 ADMINS.push(owner);
 try{
  store.put('snapshot',{id:'s',designId:'d',title:'Fixture',document:'Original requirements'});store.put('design',{...store.get('design','d')!,currentSnapshotId:'s'});
  store.put('artifact',{id:'a',designId:'d',projectId:'p',title:'Fixture'});store.put('version',{id:'v',artifactId:'a',designId:'d',number:1,validation:['fixture'],files:{'index.html':'<script src="asset.js"></script>','asset.js':'document.body.dataset.ok="true"'}});
  const data=await (await app.fetch(signed(legacy,'/api/designs/d'))).json();expect(data.artifacts[0].versions[0].previewUrl).toStartWith(canonical+'/preview/');
  const library=await (await app.fetch(signed(legacy,'/api/projects/p/library/local%3Av/preview','POST','{}'))).json();expect(library.previewUrl).toStartWith(canonical+'/library-preview/');const response=await app.fetch(new Request(library.previewUrl));expect(response.status).toBe(200);expect(response.headers.get('content-security-policy')).toContain(canonical+'/library-preview/');expect((await app.fetch(new Request(library.previewUrl.replace('index.html','asset.js')))).status).toBe(200);
  const implementation=await (await app.fetch(signed(legacy,'/api/designs/d/implementations','POST','{"snapshotId":"s"}'))).json();
  // Enqueue through the established implementation conversation route.
  const id=implementation.id;expect(typeof id).toBe('string');const result=await app.fetch(signed(legacy,`/api/implementations/${id}/messages`,'POST','{"content":"Build the fixture","requestId":"build"}'));expect(result.status).toBe(202);const job=await result.json();expect(job.context.storage.publicOrigin).toBe(canonical);expect(job.context.storage.mode).toBe('unconfigured');expect(job.context.storage.capabilities.files).toBe(false);expect(store.all('nstack')).toHaveLength(0);
 }finally{ADMINS.splice(ADMINS.indexOf(owner),1);}
});


test('existing interview and builder clients submit the exact old-origin callback and grant after app origin migration',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'byo-origin-grant-'));
 try{
  const credentialFile=join(directory,'synthetic.capability'),grant='synthetic-opaque-fixture-only';writeFileSync(credentialFile,grant,{mode:0o600});
  for(const definitionId of ['interview-v6','builder-v6']){
   const cfg={origin:'https://autopilot.example',clientOrigin:legacy,installationId:'original-installation',appId:'original-app',ownerNpub:'fixture-owner',definitionId,callbackUrl:legacy+'/api/pipeline-webhook',credentialFile,appPubkey:getPublicKey(worker)};
   const raw=JSON.stringify(cfg),input={id:'original-job',context:{storage:{publicOrigin:canonical}}};let captured:any;
   const transport=(async(_url:any,init:any)=>{
    captured=JSON.parse(init.body);expect(init.headers.authorization).toBe('Bearer '+grant);
    const request=captured.request,url=cfg.origin+request.path,bodyHash=hash(request.serializedBody);
    const event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags:[['u',url],['method',request.method],['payload',bodyHash]]},worker);
    return Response.json({response:{runId:'original-run'},httpStatus:202,receipt:{url,method:request.method,event,bodyHash}},{status:202});
   }) as typeof fetch;
   config({...env,INTERVIEW_PIPELINE_CONFIG:raw,BUILDER_PIPELINE_CONFIG:raw});
   const result=await createRemotePipelines(cfg,transport).submit(input,'original-job');expect(result.response.runId).toBe('original-run');expect(captured.clientOrigin).toBe(legacy);expect(captured.installationId).toBe(cfg.installationId);expect(JSON.parse(captured.request.serializedBody)).toEqual({mode:'webhook',idempotencyKey:'original-job',input:{job:input},webhook:{url:legacy+'/api/pipeline-webhook'}});expect(JSON.stringify(cfg)).toBe(raw);expect(readFileSync(credentialFile,'utf8')).toBe(grant);
  }
 }finally{rmSync(directory,{recursive:true,force:true});}
});
