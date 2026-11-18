import {afterEach,expect,test} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {hash} from '../src/auth';

const origin='https://byo.example',png={name:'reference.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='};
const stores:Store[]=[];afterEach(()=>{for(const s of stores.splice(0))s.db.close();});
function fixture(enabled=true){
 const store=new Store(':memory:');stores.push(store);const key=generateSecretKey(),other=generateSecretKey(),owner=getPublicKey(key);
 store.put('project',{id:'p',title:'Acceptance'});store.put('design',{id:'d',owner,projectId:'p',currentSnapshotId:null});store.put('conversation',{id:'d',designId:'d',kind:'interview',owner});
 for(const k of [key,other])store.put('membership',{id:'p:'+getPublicKey(k),projectId:'p',pubkey:getPublicKey(k)});
 const app=createApp(store,config({PUBLIC_ORIGIN:origin,INTERVIEW_PIPELINE_CONFIG:'configured-fixture',INTERVIEW_WORKFLOW_VERSION:enabled?'interview-v5':'interview-v4',INTERVIEW_SCOPED_TOOLS:'1'}));
 async function call(path:string,method='GET',data?:unknown,signer=key){const body=data===undefined?'':JSON.stringify(data),event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(body?[['payload',hash(body)]]:[])]},signer);const response=await app.fetch(new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64'),'content-type':'application/json'},...(body?{body}:{})}));return {status:response.status,body:await response.json() as any};}
 return {store,app,key,other,call};
}
test('image upload stays disabled with tool-free interview; authenticated participant-only images stay private',async()=>{
 const off=fixture(false);expect((await off.call('/api/designs/d/images','POST',png)).status).toBe(503);
 const {call,other,app}=fixture();const uploaded=await call('/api/designs/d/images','POST',png);expect(uploaded.status).toBe(201);expect(uploaded.body.base64).toBeUndefined();
 expect((await call('/api/designs/d/images','POST',png,other)).status).toBe(403);
 expect((await call(`/api/designs/d/images/${uploaded.body.id}`,'GET',undefined,other)).status).toBe(403);
 expect((await app.fetch(new Request(origin+`/api/designs/d/images/${uploaded.body.id}`))).status).toBe(401);
 expect((await call(`/api/designs/d/images/${uploaded.body.id}`)).body.base64).toBe(png.base64);
});
test('exact signed message pins metadata and image ticket; actual run reads bytes, retries preserve immutable job',async()=>{
 const {store,app,call}=fixture();const image=(await call('/api/designs/d/images','POST',png)).body;
 const payload={content:'Inspect the attached layout and keep my exclusions.',requestId:'request',imageIds:[image.id]};
 const first=await call('/api/designs/d/messages','POST',payload);expect(first.status).toBe(202);
 const job=first.body;expect(job.context.attachments[0].id).toBe(image.id);expect(job.context.attachments[0].base64).toBeUndefined();
 const message=store.get('message',job.messageId)!;expect(message.images[0].sha256).toBe(image.sha256);expect(message.imageIds).toEqual([image.id]);
 expect((await call('/api/designs/d/messages','POST',payload)).body.id).toBe(job.id);
 expect((await call('/api/designs/d/messages','POST',{...payload,imageIds:[]})).status).toBe(409);
 const source=job.context.attachmentSource,request=(run='run',imageId=image.id)=>new Request(source.url,{headers:{'x-byo-image-ticket':source.ticket,'x-wingman-run-id':run,'x-byo-image-id':imageId}});
 expect((await app.fetch(request())).status).toBe(409);
 store.put('job',{...store.get('job',job.id)!,runId:'run',status:'running'});
 const bytes=await app.fetch(request());expect(bytes.status).toBe(200);expect(Buffer.from(await bytes.arrayBuffer()).toString('base64')).toBe(png.base64);
 expect((await app.fetch(request('wrong'))).status).toBe(403);expect((await app.fetch(request('run','wrong'))).status).toBe(403);
 const state=await call('/api/designs/d');expect(state.body.messages[0].images[0].id).toBe(image.id);expect(state.body.jobs[0].context).toBeUndefined();
 expect(store.all('artifact')).toHaveLength(0);expect(store.all('version')).toHaveLength(0);
 store.put('job',{...store.get('job',job.id)!,status:'failed'});
 const rebased=await call(`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'explicit-rebase'});expect(rebased.status).toBe(200);expect(rebased.body.context.attachments[0].id).toBe(image.id);expect(rebased.body.context.attachmentSource.ticket).not.toBe(source.ticket);
 expect((await app.fetch(request())).status).toBe(403);
});
test('image-only send keeps true empty participant text; blank sends fail and expired known failures require explicit rebase',async()=>{
 const {store,call}=fixture();expect((await call('/api/designs/d/messages','POST',{content:'',requestId:'empty'})).status).toBe(400);
 const image=(await call('/api/designs/d/images','POST',png)).body;
 const payload={content:'',imageIds:[image.id],requestId:'image-only'};const created=await call('/api/designs/d/messages','POST',payload);expect(created.status).toBe(202);
 const job=created.body;expect(job.context.message).toBe('');expect(store.get('message',job.messageId)!.content).toBe('');expect((await call('/api/designs/d/messages','POST',payload)).body.id).toBe(job.id);
 store.put('job',{...store.get('job',job.id)!,status:'failed',context:{...job.context,attachmentSource:{...job.context.attachmentSource,expiresAt:1}}});
 const retry=await call(`/api/jobs/${job.id}/retry`,'POST',{});expect(retry.status).toBe(409);expect(retry.body.error).toContain('Rebase');expect(store.get('job',job.id)!.status).toBe('failed');
 const next=await call(`/api/jobs/${job.id}/recover`,'POST',{action:'rebase',requestId:'image-rebase'});expect(next.status).toBe(200);expect(next.body.context.message).toBe('');expect(next.body.context.attachments[0].id).toBe(image.id);
});
test('followup source provenance comes only from completed scoped jobs; participant history links cannot grant verification',async()=>{
 const {store,call}=fixture();store.put('job',{id:'trusted-prior',conversationId:'d',status:'complete',executionProfile:'scoped-interview',completedAt:'2026-11-18T04:00:00Z',sourceReceipts:[{provenance:'public-source',url:'https://bitcoinbushbash.info/house-prices',sha256:'a'.repeat(64)}]});
 store.put('job',{id:'not-completed',conversationId:'d',status:'failed',executionProfile:'scoped-interview',sourceReceipts:[{provenance:'public-source',url:'https://unverified.example',sha256:'b'.repeat(64)}]});
 const created=await call('/api/designs/d/messages','POST',{content:'Use blue. The earlier source should remain.',requestId:'followup',priorSourceReceipts:[{url:'https://forged.example',sha256:'c'.repeat(64)}]});
 expect(created.status).toBe(202);expect(created.body.context.priorSourceReceipts).toHaveLength(1);expect(created.body.context.priorSourceReceipts[0].sourceJobId).toBe('trusted-prior');expect(created.body.context.priorSourceReceipts[0].observedAt).toBe('2026-11-18T04:00:00Z');
});
