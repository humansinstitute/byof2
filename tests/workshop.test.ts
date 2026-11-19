import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {createWorkshop} from '../src/workshop';
import {createArtifactSharing} from '../src/artifact-sharing';
import {ADMINS} from '../src/auth';

test('workshop starters copy only explicitly approved material and retain idempotency and access boundaries',()=>{
 const store=new Store(':memory:');ADMINS.push('workshop-admin');
 try{
 store.put('project',{id:'event',title:'Workshop'});store.put('project',{id:'private-source',title:'Private source'});
 store.put('membership',{id:'event:participant',projectId:'event',pubkey:'participant'});
 store.put('design',{id:'source',projectId:'private-source',owner:'source-owner',currentSnapshotId:'secret'});
 store.put('snapshot',{id:'secret',designId:'source',document:'Private original design, never approved',title:'Original'});
 store.put('artifact',{id:'a',designId:'source',projectId:'private-source',title:'Counter',publishedVersionId:null});
 store.put('version',{id:'v',designId:'source',artifactId:'a',files:{'index.html':'<h1>Counter</h1>'},validation:['Fixture'],number:1});
 const sharing=createArtifactSharing(store),workshop=createWorkshop(store,sharing),before=JSON.stringify(store.get('design','source'));
 expect(()=>workshop.select('participant','event',{starterId:'retirement',requestId:'select-one',expectedRevision:0,versionId:'v'})).toThrow('Admin required');
 expect(()=>workshop.select('workshop-admin','event',{starterId:'retirement',requestId:'select-one',expectedRevision:0,versionId:'v',document:'Approved'})).toThrow('Review the exact package');
 workshop.select('workshop-admin','event',{starterId:'retirement',requestId:'select-one',expectedRevision:0,versionId:'v',document:'# Approved starting document',confirmPackage:true});
 workshop.select('workshop-admin','event',{starterId:'retirement',requestId:'select-one',expectedRevision:0,versionId:'v',document:'# Approved starting document',confirmPackage:true});
 expect(store.all('artifactShare')).toHaveLength(1);
 expect(()=>workshop.select('workshop-admin','event',{starterId:'retirement',requestId:'stale',expectedRevision:0,versionId:'v',document:'Stale update',confirmPackage:true})).toThrow('Starter changed');
 expect(store.all('artifactShare')).toHaveLength(1);
 expect(()=>workshop.list('outsider','event')).toThrow('Project membership required');
 const input={starterId:'retirement',requestId:'one'},d=workshop.start('participant','event',input);
 expect(workshop.start('participant','event',input).id).toBe(d.id);
 expect(()=>workshop.start('participant','event',{...input,starterId:'hair'})).toThrow('Request changed');
 expect(store.get('snapshot',d.currentSnapshotId)!.document).toBe('# Approved starting document');
 expect(JSON.stringify(store.get('design','source'))).toBe(before);
 expect(sharing.reference(d.id)!.participantConfirmed).toBe(false);
 expect(store.all('job')).toHaveLength(0);
 expect(workshop.list('participant','event').filter(s=>s.entry)).toHaveLength(1);
 const own=workshop.start('participant','event',{starterId:'own',requestId:'two'});expect(own.currentSnapshotId).toBeNull();
 const idea=workshop.start('participant','event',{starterId:'bitcoin-will',requestId:'three'});expect(idea.currentSnapshotId).toBeNull();
 const share=workshop.list('participant','event')[0]!.entry!;sharing.revoke('workshop-admin','event',share.id,share.revision);
 expect(workshop.list('participant','event')[0]!.entry).toBeUndefined();
 expect(store.get('snapshot',d.currentSnapshotId)!.document).toBe('# Approved starting document');
 }finally{store.db.close();ADMINS.splice(ADMINS.indexOf('workshop-admin'),1);}
});

test('installed preparation envelope forwards workshop reply style without truncating the saved design',async()=>{
 const {default:prepare}=await import('../pipelines/functions/prepare-interview.v8');
 const document='# Complete design\nConfirmed requirement and exclusions stay here.\nhttps://example.org/source';
 const turn=await prepare({job:{id:'job',kind:'interview',projectId:'event',conversationId:'conversation',context:{storage:{contractVersion:1,backend:'nstack'},workshop:{version:1,starter:true,firstTurn:true},message:'Make the label clearer',snapshot:{title:'Counter',document}}}});
 expect(turn.prompt).toContain('Ask one useful question at a time');
 expect(turn.prompt).toContain(JSON.stringify(document));
 expect(turn.executionProfile).toBe('scoped-interview');
});
