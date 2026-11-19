import {Store} from './store';
import {ADMINS,need,hash} from './auth';
import {createArtifactSharing} from './artifact-sharing';

export const WORKSHOP_IDEAS=[
 {id:'retirement',title:'Retirement calculator',description:'Explore an idea for a retirement planning tool.'},
 {id:'bitcoin-will',title:'Bitcoin will guide',description:'Plan an educational guide. Jurisdiction and qualified legal review still need to be agreed.'},
 {id:'inflation',title:'Inflation and your savings',description:'Explore how to explain inflation and savings, with assumptions you choose.'},
 {id:'hair',title:'Hair price calculator',description:'Shape a calculator around the services and prices you provide.'},
];
export function createWorkshop(store:Store,sharing:ReturnType<typeof createArtifactSharing>){
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
  let d=starter?.entry?sharing.importDesign(actor,projectId,{libraryEntryId:starter.entry.id,requestId:input.requestId}):store.add('design',{projectId,owner:actor,title:starter?.title||'Your idea',currentSnapshotId:null});
  store.put('conversation',{id:d.id,designId:d.id,kind:'interview',owner:actor});
  if(starter?.startingDocument){const s=store.add('snapshot',{designId:d.id,title:d.title,document:starter.startingDocument,source:'workshop-reference'});d=store.put('design',{...d,currentSnapshotId:s.id});}
  d=store.put('design',{...d,workshop:true,starterId:input.starterId,starterTitle:starter?.title||null});store.put('workshopStart',{id:receiptId,projectId,starterId:input.starterId,designId:d.id});return d;
 });}
 return {list,select,start};
}
