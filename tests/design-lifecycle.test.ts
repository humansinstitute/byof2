import {afterEach,beforeEach,describe,expect,test} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent,nip19} from 'nostr-tools';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {ADMINS,hash} from '../src/auth';
import {config} from '../src/config';

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

async function turn(id:string,n:number){const j=(await call(user,`/api/designs/${id}/messages`,'POST',{content:'Turn '+n,requestId:'turn-'+n})).body;expect((await call(worker,`/api/worker/jobs/${j.id}/complete`,'POST',{response:'Question '+n,snapshot:{title:'Freedom',document:'Requirements '+n}})).status).toBe(200);return j;}
async function build(id:string,snapshotId:string,n:string){const i=(await call(admin,`/api/designs/${id}/implementations`,'POST',{snapshotId})).body;const j=(await call(admin,`/api/implementations/${i.id}/messages`,'POST',{content:'Build',requestId:'build-'+n})).body;await call(worker,`/api/worker/jobs/${j.id}/progress`,'POST',{runId:'run-'+n,progress:'Testing'});return j;}
async function publish(j:any,n:string,html:string){return call(worker,`/api/worker/jobs/${j.id}/artifacts`,'POST',{publicationId:n,runId:j.runId||'run-'+n,title:'Tool',files:{'index.html':html},validation:['Synthetic API lifecycle fixture, not hosted proof']});}
const history=async(id:string)=>(await call(user,`/api/designs/${id}`)).body;

test('ten turns evolve one visible Design1; registration freezes exact source and next ten turns evolve Design2',async()=>{
 const d=await design();for(let n=0;n<10;n++)await turn(d.id,n);
 let h=await history(d.id);expect(h.snapshots).toHaveLength(10);expect(h.milestones).toHaveLength(1);expect(h.milestones[0].number).toBe(1);expect(h.milestones[0].snapshotId).toBe(h.design.currentSnapshotId);
 const source=h.snapshots.at(-1);const j=await build(d.id,source.id,'one');const p=await publish({...j,runId:'run-one'},'one','<h1>One</h1>');expect(p.status).toBe(200);
 h=await history(d.id);expect(h.milestones).toHaveLength(1);expect(h.milestones[0].frozenSnapshotId).toBe(source.id);
 const next=await turn(d.id,10);expect(next.context.artifactVersion.id).toBe(p.body.versionId);for(let n=11;n<20;n++)await turn(d.id,n);
 h=await history(d.id);expect(h.snapshots).toHaveLength(20);expect(h.milestones.map((m:any)=>m.number)).toEqual([1,2]);expect(h.milestones[0].snapshotId).toBe(source.id);expect(h.milestones[1].parentMilestoneId).toBe(h.milestones[0].id);expect(h.milestones[1].parentArtifactVersionId).toBe(p.body.versionId);expect(h.milestones[1].revisionCount).toBe(10);expect(store.get('snapshot',source.id)).toEqual(source);
 // Reopening SQLite retains exact grouping and parentage.
 store.db.close();store=new Store(join(dir,'test.sqlite'));app=createApp(store,config({PUBLIC_ORIGIN:origin,WORKER_PUBKEY:workerPk}));expect((await history(d.id)).milestones).toEqual(h.milestones);
});

test('out-of-order builds and concurrent edits preserve source, frozen milestones and relevant interviewer base',async()=>{
 const d=await design();const first=(await save(d.id)).body;const older=await build(d.id,first.id,'old');
 const edits=await Promise.all([save(d.id,first.id,'New source A'),save(d.id,first.id,'New source B')]);expect(edits.map(r=>r.status).sort()).toEqual([200,409]);const second=edits.find(r=>r.status===200)!.body;const newer=await build(d.id,second.id,'new');
 const newerP=await publish({...newer,runId:'run-new'},'new','<h1>New source</h1>');expect(newerP.status).toBe(200);const third=(await save(d.id,second.id,'Third source')).body;
 const olderP=await publish({...older,runId:'run-old'},'old','<h1>Old source</h1>');expect(olderP.status).toBe(200);
 const h=await history(d.id);expect(h.milestones.map((m:any)=>m.number)).toEqual([1,2]);expect(h.milestones[0].snapshotId).toBe(second.id);expect(h.milestones[1].snapshotId).toBe(third.id);expect(store.get('version',olderP.body.versionId)!.snapshotId).toBe(first.id);expect(store.get('job',older.id)!.context.snapshot.document).toBe(first.document);expect(store.get('snapshot',first.id)).toEqual(first);
 const next=await turn(d.id,1);expect(next.context.artifactVersion.id).toBe(newerP.body.versionId);expect(next.context.snapshot.id).toBe(third.id);
});

test('edits during build move into next draft, while nochange and failed/discussion builds create no boundary',async()=>{
 const d=await design();const first=(await save(d.id)).body;const j=await build(d.id,first.id,'a');const second=(await save(d.id,first.id,'Already edited while building')).body;
 const published=await publish({...j,runId:'run-a'},'a','<h1>Same</h1>');expect(published.status).toBe(200);let h=await history(d.id);expect(h.milestones.map((m:any)=>m.snapshotId)).toEqual([first.id,second.id]);
 const same=await build(d.id,second.id,'b');const unchanged=await publish({...same,runId:'run-b'},'b','<h1>Same</h1>');expect(unchanged.body.unchanged).toBe(true);expect((await history(d.id)).milestones[1].state).toBe('draft');await call(worker,`/api/worker/jobs/${same.id}/complete`,'POST',{response:'Already identical'});
 const failed=await build(d.id,second.id,'c');await call(worker,`/api/worker/jobs/${failed.id}/complete`,'POST',{error:'Validation failed'});const discussion=await build(d.id,second.id,'d');await call(worker,`/api/worker/jobs/${discussion.id}/complete`,'POST',{response:'Discussion only'});
 const next=(await save(d.id,second.id,'Still Design2')).body;h=await history(d.id);expect(h.milestones).toHaveLength(2);expect(h.milestones[1].snapshotId).toBe(next.id);expect(h.milestones[1].state).toBe('draft');
});

test('legacy history groups without replacing any old snapshot or build source IDs',async()=>{
 const d=await design();const snapshots:any[]=[];for(let n=1;n<=7;n++)snapshots.push(store.add('snapshot',{designId:d.id,title:'Legacy '+n,document:'Exact original '+n,parentId:snapshots.at(-1)?.id||null}));store.put('design',{...d,currentSnapshotId:snapshots[6].id});
 const a=store.add('artifact',{designId:d.id,projectId:'p',title:'Legacy',publishedVersionId:null});const vv=[2,5].map((n,i)=>store.add('version',{artifactId:a.id,designId:d.id,snapshotId:snapshots[n].id,number:i+1,files:{'index.html':'<h1>Legacy</h1>'},validation:['Historical fixture']}));
 const h=await history(d.id);expect(h.snapshots).toEqual(snapshots);expect(h.milestones.map((m:any)=>m.snapshotId)).toEqual([snapshots[2].id,snapshots[5].id,snapshots[6].id]);expect(h.milestones.map((m:any)=>m.revisionCount)).toEqual([3,3,1]);for(const v of vv)expect(store.get('version',v.id)).toEqual(v);
 const old=await build(d.id,snapshots[0].id,'legacy-old');expect(old.context.snapshot.document).toBe('Exact original 1');expect(old.designPin.designNumber).toBe(1);
});

test('older source first reclassifies later pending build without mutating either pinned request',async()=>{
 const d=await design();const first=(await save(d.id)).body;const older=await build(d.id,first.id,'first');const second=(await save(d.id,first.id,'Second source')).body;const newer=await build(d.id,second.id,'second');const frozenRequest=store.get('job',newer.id)!;
 const v1=await publish({...older,runId:'run-first'},'first','<h1>First</h1>');const v2=await publish({...newer,runId:'run-second'},'second','<h1>Second</h1>');expect(v1.status).toBe(200);expect(v2.status).toBe(200);expect(store.get('job',newer.id)).toEqual(frozenRequest);
 const built=store.get('version',v2.body.versionId)!;expect(built.sourceDesignPin.designNumber).toBe(1);expect(built.designPin.designNumber).toBe(2);expect(built.snapshotId).toBe(second.id);
 const third=(await save(d.id,second.id,'Third source')).body;const h=await history(d.id);expect(h.milestones.map((m:any)=>m.number)).toEqual([1,2,3]);expect(h.milestones[2].parentArtifactVersionId).toBe(v2.body.versionId);
 const archived=await build(d.id,first.id,'archived');await publish({...archived,runId:'run-archived'},'archived','<h1>New package from old revision</h1>');const latest=(await save(d.id,third.id,'Still Design3')).body;const after=await history(d.id);expect(after.milestones).toHaveLength(3);expect(after.milestones[2].snapshotId).toBe(latest.id);expect(after.milestones[2].parentArtifactVersionId).toBe(v2.body.versionId);expect((await turn(d.id,42)).context.artifactVersion.id).toBe(v2.body.versionId);
});
