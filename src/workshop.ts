import {Store} from './store';
import {ADMINS,need,hash} from './auth';
import {createDesignLifecycle} from './design-lifecycle';
import {workshopCatalog,catalogMetadata} from './workshop-catalog';
import {createArtifactSharing} from './artifact-sharing';

export const WORKSHOP_IDEAS=[
 {id:'retirement',title:'Retirement calculator',description:'Try the organiser’s selected retirement planning example.'},
 {id:'bitcoin-will',title:'Bitcoin inheritance guide',description:'Read a fictional example about legal intent and practical access. General education only.'},
 {id:'inflation',title:'Inflation and your savings',description:'Try hypothetical amounts, time and rates to explore purchasing power.'},
 {id:'hair',title:'Hair price calculator',description:'Explore an editable fictional service menu and selected extras.'},
];
export function createWorkshop(store:Store,sharing:ReturnType<typeof createArtifactSharing>){
 const lifecycle=createDesignLifecycle(store);
 function list(actor:string,projectId:string){const entries=sharing.list(actor,projectId);return WORKSHOP_IDEAS.map(idea=>{const selected=store.get('workshopStarter',projectId+':'+idea.id);const entry=selected&&entries.find(e=>e.id===selected.shareId);return {...idea,revision:selected?.revision||0,...(entry?{entry,startingDocument:selected!.document}:{} )};});}
 function select(actor:string,projectId:string,input:any){
  need(ADMINS.includes(actor),403,'Admin required');need(WORKSHOP_IDEAS.some(s=>s.id===input.starterId),400,'Unknown starter');need(typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=200,400,'Selection request ID required');
  const id=projectId+':'+input.starterId,digest=hash(JSON.stringify({projectId,starterId:input.starterId,versionId:input.versionId||null,document:input.document||'',confirmPackage:input.confirmPackage===true,expectedRevision:input.expectedRevision}));
  return store.transaction(()=>{const receiptId='workshop-selection:'+actor+':'+input.requestId,receipt=store.get('workshopSelection',receiptId);if(receipt){need(receipt.hash===digest,409,'Selection request changed');return receipt.result;}
   const previous=store.get('workshopStarter',id),revision=previous?.revision||0;need(input.expectedRevision===revision,409,'Starter changed; reload before selecting an example');
   let shareId:string|null=null;
   if(input.versionId){need(typeof input.document==='string'&&input.document.trim()&&input.document.length<=100000,400,'Review and approve a starting document');const share=sharing.approve(actor,projectId,{versionId:input.versionId,approvedContext:'Workshop starting document (reference only):\n'+input.document.slice(0,7800),confirmPackage:input.confirmPackage});shareId=share.id;}
   store.put('workshopStarter',{id,projectId,shareId,document:shareId?input.document.trim():null,revision:revision+1});
   const result={ok:true,revision:revision+1};store.put('workshopSelection',{id:receiptId,hash:digest,result});return result;
  });
 }
 function start(actor:string,projectId:string,input:any){const starter=list(actor,projectId).find(s=>s.id===input.starterId);need(starter||['own','help'].includes(input.starterId),400,'Unknown starter');need(typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=200,400,'Request ID required');return store.transaction(()=>{
  const receiptId='workshop-start:'+actor+':'+input.requestId,receipt=store.get('workshopStart',receiptId);if(receipt){need(receipt.projectId===projectId&&receipt.starterId===input.starterId,409,'Request changed');return store.get('design',receipt.designId)!;}
  need(!starter||starter.entry,409,'This example is unavailable. Ask the organiser or start with your own idea.');
  let d=starter?.entry?sharing.importDesign(actor,projectId,{libraryEntryId:starter.entry.id,requestId:input.requestId}):store.add('design',{projectId,owner:actor,title:starter?.title||'Your idea',currentSnapshotId:null});
  store.put('conversation',{id:d.id,designId:d.id,kind:'interview',owner:actor});
  if(starter?.startingDocument){lifecycle.save(d,d.title,starter.startingDocument,'workshop-reference');d=store.get('design',d.id)!;}
  d=store.put('design',{...d,workshop:true,starterId:input.starterId,starterTitle:starter?.title||null});store.put('workshopStart',{id:receiptId,projectId,starterId:input.starterId,designId:d.id});return d;
 });}
 function install(actor:string,projectId:string,input:any){
  need(ADMINS.includes(actor),403,'Admin required');list(actor,projectId);
  need(Object.keys(input).every(k=>['starterId','catalogVersion','catalogHash','packageHash','expectedRevision','confirmPackage','requestId'].includes(k)),400,'Unknown installation field');
  const example=workshopCatalog().find(e=>e.id===input.starterId);need(example,400,'Unknown built-in example');
  need(input.catalogVersion===example!.catalogVersion&&input.catalogHash===example!.catalogHash&&input.packageHash===example!.packageHash,409,'Catalog changed; review exact version and hashes');
  need(input.confirmPackage===true,400,'Review the exact package before installing');need(typeof input.requestId==='string'&&input.requestId.length>0&&input.requestId.length<=200,400,'Request ID required');
  const digest=hash(JSON.stringify({projectId,starterId:input.starterId,catalogVersion:input.catalogVersion,catalogHash:input.catalogHash,packageHash:input.packageHash,expectedRevision:input.expectedRevision}));
  return store.transaction(()=>{
   const receiptId='workshop-install:'+actor+':'+input.requestId,receipt=store.get('workshopInstall',receiptId);if(receipt){need(receipt.hash===digest,409,'Installation request changed');return receipt.result;}
   const selected=store.get('workshopStarter',projectId+':'+example!.id);need((selected?.revision||0)===input.expectedRevision,409,'Starter changed; reload');
   // Installing never selects or replaces an organiser's existing selection. Selection is a separate reviewed PATCH.
   const catalogId=projectId+':'+example!.id+':'+example!.catalogHash;let installed=store.get('workshopCatalogInstall',catalogId);
   if(installed){const v=store.get('version',installed.versionId),d=v&&store.get('design',v.designId),a=v&&store.get('artifact',v.artifactId);need(v&&!v.deletedAt&&!v.archivedAt&&d&&!d.deletedAt&&!d.archivedAt&&a&&!a.deletedAt&&!a.archivedAt,409,'Installed example unavailable; restore or review a new catalog version');need(hash(JSON.stringify(sharing.packageFiles(v!)))===example!.packageHash,409,'Installed package changed');}
   else {
    const files=sharing.packageFiles({id:'catalog',files:example!.files});
    const d=store.add('design',{projectId,owner:actor,title:example!.title,currentSnapshotId:null,provenance:'app-supplied-release-tested-example'});
    store.put('conversation',{id:d.id,designId:d.id,kind:'interview',owner:actor});const snapshot=lifecycle.save(d,example!.title,example!.document,'app-supplied-example');
    const a=store.add('artifact',{projectId,designId:d.id,title:example!.title,publishedVersionId:null});
    const v=store.add('version',{artifactId:a.id,designId:d.id,snapshotId:snapshot.id,number:1,files,packageHash:example!.packageHash,validation:['App-supplied release-tested static example; isolated browser controls and source checks. Not a native-model build.'],provenance:'app-supplied-release-tested-example',catalogId:example!.id,catalogVersion:example!.catalogVersion,catalogHash:example!.catalogHash,sourceLinks:example!.sourceLinks,designPin:lifecycle.pin(snapshot.id)});lifecycle.published(v);
    installed=store.put('workshopCatalogInstall',{id:catalogId,projectId,versionId:v.id,catalogHash:example!.catalogHash,actor});
   }
   const result={ok:true,versionId:installed.versionId,catalogVersion:example!.catalogVersion,catalogHash:example!.catalogHash,packageHash:example!.packageHash,document:example!.document,selected:false};store.put('workshopInstall',{id:receiptId,hash:digest,result});return result;
  });
 }
 function recovery(actor:string,d:any){if(!d.workshop||!d.starterId||sharing.reference(d.id))return null;const starters=list(actor,d.projectId).filter(s=>s.entry);return starters.length?{starters}:null;}
 function attach(actor:string,d:any,input:any){need(d.owner===actor||ADMINS.includes(actor),403,'Design access denied');list(actor,d.projectId);return store.transaction(()=>{const prior=store.get('workshopAttachment',d.id);if(prior){need(prior.entryId===input.entryId&&prior.revision===input.expectedRevision,409,'Reference attachment changed');return {ok:true};}const starter=recovery(actor,d)?.starters.find(s=>s.entry?.id===input.entryId);need(starter?.entry&&starter.entry.id===input.entryId&&starter.revision===input.expectedRevision,409,'Example changed; reload before using it');need(!store.all('job').some(j=>j.designId===d.id&&['queued','running','dispatching','uncertain'].includes(j.status)),409,'Wait for the current turn before attaching an example');sharing.attachReference(actor,d.id,starter!.entry!.id);store.put('workshopAttachment',{id:d.id,entryId:input.entryId,revision:input.expectedRevision,starterId:starter!.id});return {ok:true};});}
 return {list,select,start,install,recovery,attach,catalog:catalogMetadata};
}
