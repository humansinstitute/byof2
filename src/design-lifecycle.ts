import {Store,type Row} from './store';

/** Snapshots are immutable revisions. Milestones alone supply user-visible Design numbers. */
export function createDesignLifecycle(store:Store){
 const revisions=(id:string)=>store.all('snapshot').filter(s=>s.designId===id);
 const milestones=(id:string)=>store.all('designMilestone').filter(m=>m.designId===id).sort((a,b)=>a.number-b.number);
 const meta=(id:string)=>store.get('designRevision',id);
 const add=(designId:string,number:number,parent:Row|null,versionId:string|null)=>store.add('designMilestone',{designId,number,parentMilestoneId:parent?.id||null,parentArtifactVersionId:versionId,frozenSnapshotId:null,artifactVersionIds:[],currentSnapshotId:null});
 function ensure(designId:string){return store.transaction(()=>{
  if(store.get('designLifecycle',designId))return;
  const ss=revisions(designId);const order=new Map(ss.map((s,i)=>[s.id,i]));
  const vv=store.all('version').filter(v=>v.designId===designId&&order.has(v.snapshotId));
  const boundaries=[...new Set(vv.map(v=>v.snapshotId))].sort((a,b)=>order.get(a)!-order.get(b)!);
  let parent:Row|null=null;let start=0;let number=1;
  for(const snapshotId of boundaries){const end=order.get(snapshotId)!;const built=vv.filter(v=>v.snapshotId===snapshotId);let m=add(designId,number++,parent,parent?.artifactVersionIds.at(-1)||null);m=store.put('designMilestone',{...m,frozenSnapshotId:snapshotId,currentSnapshotId:snapshotId,artifactVersionIds:built.map(v=>v.id),migrated:true});for(let i=start;i<=end;i++)store.put('designRevision',{id:ss[i].id,designId,milestoneId:m.id,ordinal:i+1});start=end+1;parent=m;}
  if(start<ss.length||!parent){const m=add(designId,number,parent,parent?.artifactVersionIds.at(-1)||null);for(let i=start;i<ss.length;i++)store.put('designRevision',{id:ss[i].id,designId,milestoneId:m.id,ordinal:i+1});store.put('designMilestone',{...m,currentSnapshotId:ss.at(-1)?.id||null});}
  store.put('designLifecycle',{id:designId,version:1});
 });}
 function latestArtifact(designId:string){ensure(designId);return store.all('version').filter(v=>v.designId===designId).sort((a,b)=>(meta(a.snapshotId)?.ordinal||0)-(meta(b.snapshotId)?.ordinal||0)||(a.number||0)-(b.number||0)).at(-1)||null;}
 function save(d:Row,title:string,document:string,source:string,jobId?:string){return store.transaction(()=>{
  ensure(d.id);let m=milestones(d.id).at(-1)!;
  if(m.frozenSnapshotId)m=add(d.id,m.number+1,m,latestArtifact(d.id)?.id||null);
  const s=store.add('snapshot',{designId:d.id,title,document,parentId:d.currentSnapshotId||null,source,jobId});
  store.put('designRevision',{id:s.id,designId:d.id,milestoneId:m.id,ordinal:revisions(d.id).length});
  store.put('designMilestone',{...m,currentSnapshotId:s.id});
  store.put('design',{...d,title,currentSnapshotId:s.id,updatedAt:new Date().toISOString()});return s;
 });}
 function published(v:Row){return store.transaction(()=>{
  ensure(v.designId);const r=meta(v.snapshotId);if(!r)return;let m=store.get('designMilestone',r.milestoneId)!;
  if(m.artifactVersionIds.includes(v.id))return;
  const first=!m.frozenSnapshotId;
  m=store.put('designMilestone',{...m,frozenSnapshotId:m.frozenSnapshotId||v.snapshotId,currentSnapshotId:m.frozenSnapshotId||v.snapshotId,artifactVersionIds:[...m.artifactVersionIds,v.id]});
  // Edits completed while this exact source was being built remain immutable and become
  // the next draft. A late older build never moves an already-created draft backwards.
  if(first){const later=revisions(v.designId).filter(s=>meta(s.id)?.milestoneId===m.id&&(meta(s.id)?.ordinal||0)>r.ordinal);if(later.length){const next=add(v.designId,m.number+1,m,v.id);for(const s of later)store.put('designRevision',{...meta(s.id)!,milestoneId:next.id});store.put('designMilestone',{...next,currentSnapshotId:later.at(-1)!.id});}}
 });}
 function history(designId:string){ensure(designId);return milestones(designId).filter(m=>m.currentSnapshotId).map(m=>{const s=store.get('snapshot',m.frozenSnapshotId||m.currentSnapshotId)!;return {...m,snapshotId:s.id,title:s.title,document:s.document,createdAt:s.createdAt,state:m.frozenSnapshotId?'built':'draft',revisionCount:revisions(designId).filter(s=>meta(s.id)?.milestoneId===m.id).length};});}
 function pin(snapshotId:string){const s=store.get('snapshot',snapshotId)!;ensure(s.designId);const r=meta(snapshotId)!;const m=store.get('designMilestone',r.milestoneId)!;return {milestoneId:m.id,designNumber:m.number,revisionOrdinal:r.ordinal};}
 return {ensure,save,published,history,pin,latestArtifact};
}
