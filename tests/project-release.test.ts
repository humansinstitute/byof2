import {test,expect} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {ADMINS,hash} from '../src/auth';

function fixture(){
 const store=new Store(':memory:'),admin=generateSecretKey(),participant=generateSecretKey(),worker=generateSecretKey();ADMINS.push(getPublicKey(admin));
 const origin='https://release.example',app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:getPublicKey(worker),BUILDER_PIPELINE_CONFIG:'fixture'}));
 const call=async(path:string,method='GET',data?:any,key=admin)=>{const body=data===undefined?'':JSON.stringify(data);const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(method!=='GET'?[['payload',hash(body)]]:[])]},key);return app.fetch(new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(e)).toString('base64')},...(body?{body}:{})}));};
 const json=async(path:string,method='GET',data?:any,key=admin)=>{const r=await call(path,method,data,key);expect(r.status).toBeLessThan(300);return r.json() as any;};
 const publicGet=(path:string)=>app.fetch(new Request(origin+path));
 const close=()=>{ADMINS.splice(ADMINS.indexOf(getPublicKey(admin)),1);store.db.close();};return {store,admin,participant,worker,call,json,publicGet,close};
}
test('signed design/build/publication adds missing item to released website and keeps prior release, draft and source lineage',async()=>{
 const f=fixture();try{
  const p=await f.json('/api/projects','POST',{title:'Resource workshop'});
  const d=await f.json(`/api/projects/${p.id}/designs`,'POST',{title:'Bitcoin house prices'});
  const snapshot=await f.json(`/api/designs/${d.id}`,'PATCH',{title:d.title,document:'Build a counter with no accounts.',expectedSnapshotId:null});
  const impl=await f.json(`/api/designs/${d.id}/implementations`,'POST',{snapshotId:snapshot.id});
  const job=await f.json(`/api/implementations/${impl.id}/messages`,'POST',{requestId:'build-1',content:'Implement this.'});
  await f.json(`/api/worker/jobs/${job.id}/progress`,'POST',{runId:'fixture-run',progress:'Validated package'},f.worker);
  const v=await f.json(`/api/worker/jobs/${job.id}/artifacts`,'POST',{publicationId:'tested-package',runId:'fixture-run',title:d.title,validation:['Button increments in real browser acceptance'],files:{'index.html':'<button id="counter">0</button><script>counter.onclick=()=>counter.textContent=Number(counter.textContent)+1</script>'}},f.worker);
  const originalVersion=f.store.get('version',v.versionId)!;
  f.store.put('artifact',{id:'old',projectId:p.id,designId:'old-design',title:'Earlier contribution',publishedVersionId:'old-v'});
  f.store.put('version',{id:'old-v',artifactId:'old',designId:'old-design',validation:['tested'],files:{'index.html':'Earlier contribution bytes'}});
  const initial=await f.json(`/api/projects/${p.id}/site`);const draft={...initial.draft,layout:'resource-library',pages:[{id:'old-page',artifactVersionId:'old-v',slug:'earlier',label:'Earlier contribution',visible:true}],homePageId:'old-page'};
  await f.json(`/api/projects/${p.id}/site`,'PUT',{expectedRevision:0,draft});
  const first=await f.json(`/api/projects/${p.id}/site/publish`,'POST',{expectedRevision:1,requestId:'initial'});
  const unsaved={...first.draft,title:'Private unpublished change'};await f.json(`/api/projects/${p.id}/site`,'PUT',{expectedRevision:1,draft:unsaved});
  expect(await (await f.publicGet(`/sites/${p.id}/`)).text()).not.toContain(d.title);
  expect((await f.call(`/api/artifacts/${v.artifactId}/publish`,'POST',{versionId:v.versionId},f.participant)).status).toBe(403);
  const published=await f.json(`/api/artifacts/${v.artifactId}/publish`,'POST',{versionId:v.versionId});
  const html=await (await f.publicGet(`/sites/${p.id}/`)).text();expect(html).toContain(d.title);expect(html).toContain('Earlier contribution');expect(html).toContain('data-site-layout="resource-library"');expect(html).not.toContain('Private unpublished change');
  const successor=f.store.get('siteRelease',published.siteReleaseId)!;expect(successor.previousReleaseId).toBe(first.publishedReleaseId);expect(successor.pages[0]).toEqual(draft.pages[0]);
  const newPage=successor.pages[1];expect(await (await f.publicGet(`/sites/${p.id}/page/${newPage.slug}/_files/index.html`)).text()).toContain('counter.onclick');
  expect(f.store.get('version',v.versionId)).toEqual(originalVersion);expect(originalVersion.snapshotId).toBe(snapshot.id);expect(f.store.get('snapshot',snapshot.id)!.document).toBe('Build a counter with no accounts.');
  expect((await f.json(`/api/projects/${p.id}/site`)).draft.title).toBe('Private unpublished change');
  const count=f.store.all('siteRelease').length;await f.json(`/api/artifacts/${v.artifactId}/publish`,'POST',{versionId:v.versionId});expect(f.store.all('siteRelease')).toHaveLength(count);
  await f.json(`/api/projects/${p.id}/site/rollback`,'POST',{releaseId:first.publishedReleaseId,requestId:'rollback'});expect(await (await f.publicGet(`/sites/${p.id}/`)).text()).not.toContain(d.title);
  expect(await (await f.publicGet(`/sites/${p.id}/releases/${published.siteReleaseId}/page/${newPage.slug}/_files/index.html`)).text()).toContain('counter.onclick');
 }finally{f.close();}
});
test('confirmed admin project deletion revokes lists, invites, public bytes, private previews, apps and all history routes without destroying records',async()=>{
 const f=fixture();try{
  const p=await f.json('/api/projects','POST',{title:'Delete isolated fixture'});f.store.put('membership',{id:p.id+':'+getPublicKey(f.participant),projectId:p.id,pubkey:getPublicKey(f.participant)});
  const d=await f.json(`/api/projects/${p.id}/designs`,'POST',{title:'Private interview'});
  f.store.put('artifact',{id:'a',projectId:p.id,designId:d.id,title:'Public fixture',publishedVersionId:'v'});f.store.put('version',{id:'v',designId:d.id,artifactId:'a',files:{'index.html':'PRIVATE FIXTURE BYTES'},validation:['fixture']});f.store.put('preview',{id:'ticket',versionId:'v',expires:Date.now()+60000});f.store.put('nstackInstallation',{id:'v',versionId:'v',artifactId:'a',projectId:p.id,enabled:true});
  const site=await f.json(`/api/projects/${p.id}/site`);await f.json(`/api/projects/${p.id}/site`,'PUT',{expectedRevision:0,draft:{...site.draft,pages:[{id:'page',artifactVersionId:'v',slug:'fixture',label:'Fixture',visible:true}],homePageId:'page'}});const release=await f.json(`/api/projects/${p.id}/site/publish`,'POST',{expectedRevision:1,requestId:'publish'});
  const publicPaths=[`/sites/${p.id}/`,`/sites/${p.id}/a/`,`/sites/${p.id}/a/_files/index.html`,`/sites/${p.id}/page/fixture/`,`/sites/${p.id}/page/fixture/_files/index.html`,`/sites/${p.id}/releases/${release.publishedReleaseId}/page/fixture/_files/index.html`,'/preview/ticket/index.html'];
  for(const path of publicPaths)expect((await f.publicGet(path)).status).toBe(200);
  expect((await f.call(`/api/projects/${p.id}`,'DELETE',{confirmTitle:p.title},f.participant)).status).toBe(403);
  expect((await f.publicGet(`/api/projects/${p.id}`)).status).toBe(401);
  expect((await f.call(`/api/projects/${p.id}`,'DELETE',{confirmTitle:'wrong'})).status).toBe(400);
  f.store.put('job',{id:'active',projectId:p.id,status:'running'});expect((await f.call(`/api/projects/${p.id}`,'DELETE',{confirmTitle:p.title})).status).toBe(409);f.store.put('job',{id:'active',projectId:p.id,status:'complete'});
  await f.json('/api/settings','PATCH',{featuredProjectId:p.id,featuredUntil:new Date(Date.now()+60000).toISOString()});
  await f.json(`/api/projects/${p.id}`,'DELETE',{confirmTitle:p.title});
  for(const path of publicPaths)expect((await f.publicGet(path)).status).toBe(404);
  for(const path of [`/api/projects/${p.id}`,`/api/projects/${p.id}/site`,`/api/designs/${d.id}`,'/api/installed-apps/v'])expect((await f.call(path)).status).toBe(404);
  expect((await f.call('/api/artifacts/a/publish','POST',{versionId:'v'})).status).toBe(404);expect((await f.call('/api/artifacts/a/data-installations')).status).toBe(404);
  expect((await f.call('/api/join','POST',{code:p.joinCode},f.participant)).status).toBe(404);
  expect((await f.json('/api/projects')).projects).toHaveLength(0);expect((await f.json('/api/settings')).featuredProjectId).toBeNull();
  expect(f.store.get('project',p.id)!.deletedBy).toBe(getPublicKey(f.admin));expect(f.store.get('version','v')!.files['index.html']).toBe('PRIVATE FIXTURE BYTES');expect(f.store.get('siteRelease',release.publishedReleaseId)).toBeDefined();
 }finally{f.close();}
});
