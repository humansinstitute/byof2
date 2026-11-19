import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {ADMINS} from '../src/auth';
import {createArtifactSharing} from '../src/artifact-sharing';
import {createWorkshop} from '../src/workshop';
import {workshopCatalog} from '../src/workshop-catalog';
import {jobProgress} from '../public/job-progress';
import prepare from '../pipelines/functions/prepare-interview.v9';

test('catalog installation is admin-only, pinned, idempotent, lifecycle-aware and never selects or overwrites existing work',()=>{
 const store=new Store(':memory:');ADMINS.push('catalog-admin');try{
 store.put('project',{id:'event',title:'Event'});store.put('membership',{id:'event:person',projectId:'event',pubkey:'person'});
 store.put('workshopStarter',{id:'event:retirement',revision:7,shareId:'existing',document:'Do not touch'});
 const sharing=createArtifactSharing(store),w=createWorkshop(store,sharing),before=JSON.stringify(store.get('workshopStarter','event:retirement'));
 for(const e of workshopCatalog()){
  const payload={starterId:e.id,catalogVersion:1,catalogHash:e.catalogHash,packageHash:e.packageHash,expectedRevision:0,requestId:e.id,confirmPackage:true};
  expect(()=>w.install('catalog-admin','event',{...payload,files:{'index.html':'unreviewed'}})).toThrow('Unknown installation field');expect(()=>w.install('person','event',payload)).toThrow('Admin required');expect(()=>w.install('catalog-admin','event',{...payload,catalogHash:'wrong'})).toThrow('Catalog changed');expect(()=>w.install('catalog-admin','event',{...payload,expectedRevision:99})).toThrow('Starter changed');
  const r=w.install('catalog-admin','event',payload);expect(w.install('catalog-admin','event',payload)).toEqual(r);expect(w.install('catalog-admin','event',{...payload,requestId:'second-'+e.id}).versionId).toBe(r.versionId);
  expect(store.get('version',r.versionId)!.jobId).toBeUndefined();expect(store.get('version',r.versionId)!.provenance).toBe('app-supplied-release-tested-example');expect(store.all('designMilestone').find(m=>m.artifactVersionIds.includes(r.versionId))?.frozenSnapshotId).toBeTruthy();
  expect(w.list('person','event').find(s=>s.id===e.id)?.entry).toBeUndefined();
  w.select('catalog-admin','event',{starterId:e.id,versionId:r.versionId,document:r.document,requestId:'select-'+e.id,expectedRevision:0,confirmPackage:true});
  const entry=w.list('person','event').find(s=>s.id===e.id)!.entry!;const d=w.start('person','event',{starterId:e.id,requestId:'start-'+e.id});expect(sharing.startingArtifact(d.id)!.files).toEqual(e.files);expect(sharing.reference(d.id)!.participantConfirmed).toBe(false);expect(entry.sourceLinks).toEqual(e.sourceLinks);
 }
 expect(JSON.stringify(store.get('workshopStarter','event:retirement'))).toBe(before);expect(store.all('job')).toHaveLength(0);expect(store.all('nstackInstallation')).toHaveLength(0);
 const original=store.put('design',{id:'legacy',projectId:'event',owner:'person',title:'Bitcoin gotchas',workshop:true,starterId:'inflation',currentSnapshotId:'old'});store.put('snapshot',{id:'old',designId:'legacy',title:'Bitcoin gotchas',document:'Participant edits'});store.put('message',{id:'message',conversationId:'legacy',role:'user',content:'My current topic is Bitcoin'});
 const records=JSON.stringify([original,store.get('snapshot','old'),store.get('message','message')]);const choices=w.recovery('person',original)!.starters;const chosen=choices.find(s=>s.id==='bitcoin-will')!;
 expect(()=>sharing.attachReference('outsider','legacy',chosen.entry!.id)).toThrow();expect(()=>w.attach('person',original,{entryId:chosen.entry!.id,expectedRevision:999})).toThrow('Example changed');
 const attach={entryId:chosen.entry!.id,expectedRevision:chosen.revision};w.attach('person',original,attach);w.attach('person',original,attach);expect(store.get('workshopAttachment','legacy')!.starterId).toBe('bitcoin-will');expect(JSON.stringify([store.get('design','legacy'),store.get('snapshot','old'),store.get('message','message')])).toBe(records);expect(w.recovery('person',original)).toBeNull();expect(sharing.reference('legacy')!.title).toContain('Bitcoin');
 }finally{store.db.close();ADMINS.splice(ADMINS.indexOf('catalog-admin'),1);}
});

test('normal historical running strings map exactly; actionable diagnostics are not erased',()=>{
 for(const kind of ['interview','implementation'])for(const progress of ['Agent run checked; waiting for its signed result','Agent working',''])expect(jobProgress({kind,status:'running',progress})).toBe(kind==='interview'?'Your designer is working on that now':'Your builder is working on that now');
 for(const status of ['queued','dispatching','uncertain','failed'])expect(jobProgress({status,progress:'Delivery needs recovery'})).toBe('Delivery needs recovery');
 expect(jobProgress({status:'running',progress:'Signed result delivery requeued; original run preserved'})).toBe('Signed result delivery requeued; original run preserved');
 expect(jobProgress({status:'running',progress:'Image unavailable; retry required'})).toBe('Image unavailable; retry required');
});

test('v10 preparation is reference-first, preserves source/design evidence and native scope, and honours current topics',async()=>{
 for(const starterId of ['bitcoin-will','inflation','hair','retirement']){
 const document='Complete participant edits and exclusions https://example.org/source';const context={storage:{contractVersion:1,backend:'nstack'},workshop:{version:2,starterId,hasReference:true,firstTurn:true},message:'My family',snapshot:{document},artifactVersion:{importedSource:{title:'Reference',participantConfirmed:false}},priorSourceReceipts:[{url:'https://example.org/observed',sha256:'abc'}]};
 const r=await prepare({job:{id:'j',kind:'interview',projectId:'p',conversationId:'same-native-conversation',context}});expect(r.conversationKey).toBe('byofreedom:interview:scoped-v1:same-native-conversation');expect(r.scopedInterview.sources).toHaveLength(1);expect(r.prompt).toContain(document);expect(r.prompt).toContain('observed');expect(r.prompt).toContain('Reference');expect(r.prompt).not.toContain('otherwise ask what they would change');expect(r.executionProfile).toBe('scoped-interview');
 const later=await prepare({job:{id:'j',kind:'interview',projectId:'p',conversationId:'same-native-conversation',context:{...context,workshop:{...context.workshop,firstTurn:false}}}});expect(later.prompt).toContain('current participant topic');expect(later.prompt).not.toContain('Ask what they would like to explore: a hypothetical amount');
 }
});

test('v10 retains scoped private-image authority, immutable v9 and reply-first completion',async()=>{
 const definition=await Bun.file('pipelines/interview.v10.json').json();const previous=await Bun.file('pipelines/interview.v9.json').json();
 expect(definition.steps.map((s:any)=>s.function)).toEqual(['byofreedom.prepareInterview.v9','session.scopedInterviewTurn.v1','byofreedom.finishInterview.v5']);expect(previous.steps[0].function).toBe('byofreedom.prepareInterview.v8');expect(definition.steps[1].activityWebhook.correlation.conversationId).toBe('$.job.conversationId');
 const base={id:'j',kind:'interview',projectId:'p',conversationId:'c',context:{storage:{contractVersion:1,backend:'nstack'},message:'Read this image',attachments:[{id:'image',mimeType:'image/png',sha256:'a'.repeat(64),bytes:100}],attachmentSource:{url:'https://app.example/image',ticket:'PRIVATE_TICKET'}}};
 const r=await prepare({job:base});expect(r.scopedInterview.attachmentSource?.ticket).toBe('PRIVATE_TICKET');expect(r.prompt).not.toContain('PRIVATE_TICKET');expect(r).not.toHaveProperty('directory');expect(r).not.toHaveProperty('agentTools');
 await expect(prepare({job:{...base,context:{...base.context,attachmentSource:null}}})).rejects.toThrow('image read authority');
 const {default:finish}=await import('../pipelines/functions/finish-interview.v5');const reply=await finish({turn:{status:'completed',receiptId:'r',sessionId:'s',nativeSessionId:'n',reply:'Which audience would this guide help?',output:{executionProfile:'scoped-interview',sourceReceipts:[]}}});expect(reply.response).toBe('Which audience would this guide help?');expect(reply.snapshot).toBeUndefined();
});
