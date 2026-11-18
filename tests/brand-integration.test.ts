import {test,expect} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {ADMINS,hash} from '../src/auth';
import {config} from '../src/config';
import {defaultBrand} from '../src/brand';

test('signed admin brand exceptions and pinned jobs survive later brand edits',async()=>{
 const store=new Store(':memory:');const key=generateSecretKey(),pk=getPublicKey(key);ADMINS.push(pk);
 const app=createApp(store,config({PUBLIC_ORIGIN:'https://test.example'}));
 const call=async(path:string,method='GET',value?:any)=>{const body=value===undefined?'':JSON.stringify(value);const event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u','https://test.example'+path],['method',method],...(body?[['payload',hash(body)]]:[])]},key);const response=await app.fetch(new Request('https://test.example'+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64')},...(body?{body}:{})}));return {status:response.status,body:await response.json() as any};};
 try{
  store.put('project',{id:'p',title:'Project'});store.put('design',{id:'d',owner:pk,projectId:'p',currentSnapshotId:null});store.put('conversation',{id:'d',designId:'d',kind:'interview',owner:pk});
  expect((await app.fetch(new Request('https://test.example/api/projects/p/site'))).status).toBe(401);
  expect((await call('/api/designs/d/brand','PATCH',{expectedRevision:0,exceptions:'Use serif headings only'})).status).toBe(200);
  expect((await call('/api/designs/d/brand','PATCH',{expectedRevision:0,exceptions:'stale'})).status).toBe(409);
  const draft=(await call('/api/projects/p/site')).body.draft;
  expect((await call('/api/projects/p/site','PUT',{expectedRevision:0,draft:{...draft,brand:{...defaultBrand(),primary:'#123456',guidance:'Use the phrase Garden Freedom'}}})).status).toBe(200);
  const queued=await call('/api/designs/d/messages','POST',{content:'I want a garden guide',requestId:'brand-proof'});expect(queued.status).toBe(202);
  const job=store.get('job',queued.body.id)!;expect(job.context.brand.projectBrandRevision).toBe(1);expect(job.context.brand.exceptions).toBe('Use serif headings only');expect(job.context.brand.styleContract.css).toContain('#123456');
  const newer=(await call('/api/projects/p/site')).body.draft;
  await call('/api/projects/p/site','PUT',{expectedRevision:1,draft:{...newer,brand:{...newer.brand,primary:'#654321'}}});
  expect(store.get('job',job.id)!.context.brand.projectBrand.primary).toBe('#123456');
  expect((await call('/api/jobs/'+job.id)).body.context).toBeUndefined();
  store.put('artifact',{id:'a',designId:'d',projectId:'p'});store.put('version',{id:'v',artifactId:'a',designId:'d',brandRevision:2,designBrandRevision:1,validation:['test'],files:{'index.html':'safe'}});
  expect((await call('/api/projects/p/site')).body.artifacts[0].versions[0].outdatedBrand).toBe(false);
  await call('/api/designs/d/brand','PATCH',{expectedRevision:1,exceptions:'Now use mono headings'});
  expect((await call('/api/projects/p/site')).body.artifacts[0].versions[0].outdatedBrand).toBe(true);
  expect((await call('/api/designs/d')).body.artifacts[0].versions[0].outdatedBrand).toBe(true);
 }finally{ADMINS.splice(ADMINS.indexOf(pk),1);store.db.close();}
});
