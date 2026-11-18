import {readFileSync} from 'node:fs';
import {readNostrProfile,verifiedProfile,newestProfile} from '../public/identity';
import {verifyPipelineCallback} from '../integration/remote-pipelines';
import {discoverOrigin} from './nstack-discovery';
import {createBrowserOperations} from './nstack-browser';
import {createNStack,type NStackTransport,type NStackFiles,type NStackConnectionHint,validateManifest,connectionInput,boundedNStackText,npub} from './nstack';
import {Store,type Row} from './store';
import {authenticate,ADMINS,HttpError,need,hash} from './auth';
import {config} from './config';
import {createSiteBuilder} from './site-builder';
import {buildBrandContext} from './brand';
import {createDesignLifecycle} from './design-lifecycle';
import {createInterviewImages} from './interview-images';
import {createInterviewImageAccess} from './interview-image-access';
import {agentStorageContext} from './agent-storage-context';
const text=(v:any,max=50000)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max,400,'Text is required or too long');return v.trim() as string;};
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function createApp(store:Store,cfg= config(),options:{nstackTransport?:NStackTransport;nstackFiles?:NStackFiles;nstackConnections?:NStackConnectionHint[]}={}){
 const browserOperations=createBrowserOperations();
 const nstack=createNStack(store,{transport:options.nstackTransport,files:options.nstackFiles,connections:options.nstackConnections});
 const siteBuilder=createSiteBuilder(store);
 const lifecycle=createDesignLifecycle(store);
 const interviewImages=createInterviewImages(store),imageAccess=createInterviewImageAccess(store,cfg.origin);
 const read=(k:string,id:string)=>{const r=store.get(k,id);need(r,404,'Not found');return r!;};
 const settings=()=>store.get('settings','global')||{id:'global',featuredProjectId:null,featuredUntil:null};
 const admin=(pk:string)=>need(ADMINS.includes(pk),403,'Admin required');
 const member=(pk:string,id:string)=>{const p=read('project',id);need(ADMINS.includes(pk)||store.get('membership',id+':'+pk),403,'Project membership required');return p;};
 const owner=(pk:string,id:string)=>{const d=read('design',id);member(pk,d.projectId);need(d.owner===pk||ADMINS.includes(pk),403,'This design interview belongs to its participant');return d;};
 const preview=(versionId:string)=>{let t=store.all('preview').find(t=>t.versionId===versionId&&t.expires>Date.now());if(!t)t=store.add('preview',{versionId,expires:Date.now()+15*60*1000});return `/preview/${t.id}/index.html`;};
 const versions=(a:Row)=>({...a,versions:store.all('version').filter(v=>v.artifactId===a.id).map(v=>({...v,dataEnabled:store.get('nstackInstallation',v.id)?.enabled===true,files:undefined,brandContext:undefined,outdatedBrand:(v.brandRevision??null)!==(siteBuilder.getDraft(a.projectId).brand.revision)||(v.designBrandRevision??v.brandContext?.designBrandRevision??null)!==(store.get('designBrand',a.designId)?.revision??0),previewUrl:preview(v.id),published:a.publishedVersionId===v.id}))});
 const artifacts=(designId:string)=>store.all('artifact').filter(a=>a.designId===designId).map(versions);
 const messages=(id:string)=>store.all('message').filter(m=>m.conversationId===id);
 const jobs=(id:string)=>store.all('job').filter(m=>m.conversationId===id).map(({context,...j})=>j);
 const snapshot=lifecycle.save;
 function enqueue(pk:string,conversation:Row,b:any,kind:string){
  need(b.content===undefined||typeof b.content==='string'&&b.content.length<=50000,400,'Text is required or too long');const content=typeof b.content==='string'?b.content.trim():'';const key=text(b.requestId,200);const old=store.all('job').find(j=>j.requestId===key&&j.owner===pk);if(old){need(old.conversationId===conversation.id,409,'Request ID belongs to another conversation');need(old.contentHash===hash(JSON.stringify(b)),409,'Request ID reused with changed input');return old;}
  need(!store.all('job').some(j=>j.conversationId===conversation.id&&['queued','running','dispatching','uncertain'].includes(j.status)),409,'A turn is already in progress');
  const d=read('design',conversation.designId);let av:Row|undefined;
  if(b.artifactVersionId){av=read('version',b.artifactVersionId);need(av.designId===d.id,400,'Artifact belongs to another design');}else if(kind==='interview')av=lifecycle.latestArtifact(d.id)||undefined;
  const pinned=kind==='implementation'?read('snapshot',conversation.snapshotId):d.currentSnapshotId?read('snapshot',d.currentSnapshotId):null;
  const priorVersions=kind==='implementation'?store.all('version').filter(v=>store.get('job',v.jobId)?.conversationId===conversation.id):[];
  const startingVersionId=kind==='implementation'?(b.startingVersionId||priorVersions.at(-1)?.id||conversation.startingVersionId||null):null;
  if(startingVersionId)need(read('version',startingVersionId).designId===d.id,400,'Starting artifact belongs to another design');
  const imageIds=b.imageIds??[];need(Array.isArray(imageIds),400,'Image IDs must be an array');
  if(imageIds.length)need(kind==='interview'&&cfg.interviewImagesEnabled,503,'Image interviews are not active yet');
  const images=interviewImages.select(pk,d.id,imageIds);need(content||images.length,400,'A message or reference image is required');
  const previousSources=store.all('job').filter(j=>j.conversationId===conversation.id&&j.status==='complete'&&j.executionProfile==='scoped-interview').flatMap(j=>(j.sourceReceipts??[]).filter((r:any)=>r.available!==false&&r.provenance==='public-source'&&typeof r.url==='string'&&typeof r.sha256==='string').map((r:any)=>({...r,observedAt:r.fetchedAt??j.completedAt,sourceJobId:j.id})));
  const priorSourceReceipts=[...new Map(previousSources.map((r:any)=>[r.url,r])).values()].slice(-20);
  const storage={...agentStorageContext(nstack.getSettings()),...(kind==='implementation'?{sdkSource:readFileSync(new URL('../public/data-sdk.ts',import.meta.url),'utf8'),publicOrigin:cfg.origin}: {})};
  const intervention=kind==='interview'&&pk!==d.owner;
  const modelContent=(message:Row)=>message.authorRole==='administrator'?`Administrative intervention by ${message.author} for participant ${d.owner}; this is not a participant confirmation:\n\n${message.content}`:message.content;
  const history=messages(conversation.id).map(m=>({...m,content:modelContent(m)}));const m=store.add('message',{conversationId:conversation.id,role:'user',content,artifactVersionId:av?.id||null,author:pk,...(intervention?{authorRole:'administrator',participantOwner:d.owner}:{}),...(images.length?{imageIds,images}:{})});
  const created=store.add('job',{owner:pk,kind,projectId:d.projectId,designId:d.id,conversationId:conversation.id,requestId:key,contentHash:hash(JSON.stringify(b)),messageId:m.id,status:'queued',attempts:0,workflowVersion:kind==='interview'?cfg.interviewWorkflowVersion:cfg.builderWorkflowVersion,promptVersion:4,expectedSnapshotId:d.currentSnapshotId||null,snapshotId:pinned?.id||null,designPin:pinned?lifecycle.pin(pinned.id):null,startingVersionId,context:{participantOwner:d.owner,submittedBy:pk,priorSourceReceipts,storage,brand:buildBrandContext(siteBuilder.getDraft(d.projectId).brand,store.get('designBrand',d.id)||{revision:0,exceptions:''}),message:modelContent(m),history,snapshot:pinned,artifactVersion:av||null,startingArtifact:startingVersionId?read('version',startingVersionId):null},progress:'Waiting for the managed agent runtime'});
  if(images.length){const pinned=imageAccess.pin(pk,d.id,created.id,m.id,imageIds);return store.put('job',{...created,context:{...created.context,...pinned}});}
  return created;
 }
 function complete(j:Row,b:any){
  need(['running','queued','dispatching','uncertain','failed'].includes(j.status),409,'Job is already complete');
  if(b.error){store.put('job',{...j,status:'failed',error:text(b.error),progress:'The agent could not complete this turn'});return {ok:true};}
  const response=text(b.response);const d=read('design',j.designId);
  if(j.kind==='interview'){
   need(b.snapshot&&typeof b.snapshot.document==='string'&&typeof b.snapshot.title==='string',422,'Every interview response requires a design snapshot');
   need(d.currentSnapshotId===j.expectedSnapshotId,409,'Design changed during interview; recover against latest snapshot');
   snapshot(d,text(b.snapshot.title,200),text(b.snapshot.document), 'interview',j.id);
  }
  store.add('message',{conversationId:j.conversationId,role:'assistant',content:response,jobId:j.id});store.put('job',{...j,status:'complete',progress:'Complete',completedAt:new Date().toISOString(),completionReceipt:b.receipt||null,executionProfile:b.executionProfile||null,sourceReceipts:b.research?.receipts??[]});return {ok:true};
 }
 async function fetch(req:Request):Promise<Response>{
  const url=new URL(req.url);let path=url.pathname;const method=req.method;
  const json=(v:any,status=200)=>Response.json(v,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
  try{
   if(path.startsWith('/app-data/')&&method==='GET'){const versionId=path.split('/')[2];const publicData=await nstack.operate(null,versionId,{operation:url.searchParams.get('operation'),collection:url.searchParams.get('collection'),scope:'live',id:url.searchParams.get('id'),limit:Number(url.searchParams.get('limit')||25),offset:Number(url.searchParams.get('offset')||0)});const response=json(publicData);response.headers.set('access-control-allow-origin','*');return response;}
   if(path==='/health')return json({ok:true});if(path==='/version')return json({version:cfg.version});
   if(path.startsWith('/sites/')){const response=siteBuilder.publicResponse(path);if(response)return response;}
   if(path.startsWith('/preview/')||path.startsWith('/sites/'))return publicSite(path);
   if(path==='/site-preview-host'&&method==='GET')return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private site preview</title><style>html,body,iframe{margin:0;border:0;width:100%;height:100%;display:block}</style></head><body><iframe title="Private draft site" sandbox="allow-scripts allow-forms allow-downloads"></iframe><script>addEventListener('message',event=>{if(event.source!==parent||event.data?.type!=='byo-site-preview'||typeof event.data.html!=='string')return;document.querySelector('iframe').srcdoc=event.data.html;});</script></body></html>`,{headers:{'content-type':'text/html; charset=utf-8','cache-control':'no-store','referrer-policy':'no-referrer','x-content-type-options':'nosniff','content-security-policy':"sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src 'unsafe-inline' data: blob:; style-src 'unsafe-inline' data:; img-src https: data: blob:; frame-src 'self' data: blob:; connect-src https: wss:; font-src data:; base-uri 'none'; form-action 'none'"}});
   if(!path.startsWith('/api/')){const file=path==='/app.js'?Bun.file('dist/app.js'):path==='/style.css'?Bun.file('public/style.css'):Bun.file('dist/index.html');return new Response(file,{headers:{'content-security-policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data:; connect-src 'self' https://blossom.primal.net wss://relay.damus.io wss://nos.lol wss://relay.primal.net; frame-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",'x-content-type-options':'nosniff','cache-control':path==='/app.js'||path==='/style.css'?'no-cache':'no-store'}});}
   if(path==='/api/pipeline-webhook'&&method==='POST'){
    need(cfg.webhookPubkey,503,'Webhook signer not configured');
    let verified;try{verified=await verifyPipelineCallback(req,{url:cfg.origin+path,pubkey:cfg.webhookPubkey});}catch{throw new HttpError(401,'Invalid pipeline callback');}
    const {envelope,eventId,fingerprint}=verified;
    return json(store.once('delivery:'+envelope.deliveryId,fingerprint,()=>{
     const found=store.all('job').find(j=>j.runId===envelope.runId);need(found,409,'Run not yet registered; retry delivery');const j=found!;
     try{store.replay(eventId,Date.now()+120000);}catch{throw new HttpError(409,'Callback replay');}
     if(!envelope.terminal){store.put('job',{...j,progress:'Agent working',pipelineStatus:envelope.status});return {ok:true};}
     const result=envelope.result as any;
     if(j.status==='superseded')return {ok:true,ignored:'superseded job'};
     if(j.kind==='interview'&&read('design',j.designId).currentSnapshotId!==j.expectedSnapshotId){store.put('job',{...j,status:'conflict',progress:'Your design changed during this turn. Review it and rebase the interview.',pendingResult:result});return {ok:true,conflict:true};}
     return complete(j,envelope.status==='ok'||envelope.status==='completed'||envelope.status==='success'?result:{error:typeof envelope.error==='string'?envelope.error:'Managed pipeline failed'});
    }));
   }
   const imageJob=path.match(/^\/api\/interview-job-images\/([a-f0-9-]+)$/);
   if(imageJob){need(cfg.interviewImagesEnabled,503,'Image interviews are not active yet');return imageAccess.response(req,imageJob[1]!);}
   need(Number(req.headers.get('content-length')||0)<=12*1024*1024,413,'Request too large');const body=await req.text();need(Buffer.byteLength(body)<=12*1024*1024,413,'Request too large');const pk=authenticate(req,body,cfg.origin,store);let b:any={};try{if(body)b=JSON.parse(body);}catch{throw new HttpError(400,'Invalid JSON');}
   const p=path.split('/').filter(Boolean);const id=p[2];
   if(p[1]==='nstack'&&p[2]==='discovery-request'&&method==='POST'){
    need(ADMINS.includes(pk),403,'Admin required');need(typeof b.endpoint==='string'&&typeof b.path==='string'&&b.path.length<=5000,400,'Bounded discovery request required');
    const descriptor=await discoverOrigin(b.endpoint);const endpoint=descriptor.origin;
    if(b.path==='/.well-known/nstack.json')return json({done:true,result:{schema:'org.wingman.nstack.services',schema_version:1,stack:{tower_npub:descriptor.towerNpub,name:descriptor.label},services:[{id:'tower',kind:'tower',endpoint,protocols:['nip-98']}]}});
    const target=new URL(b.path,endpoint);need(target.origin===endpoint&&!target.hash&&b.path===target.pathname+target.search,400,'Exact discovery path required');
    const list=target.pathname==='/api/v4/flightdeck-pg/workspaces';const match=target.pathname.match(/^\/api\/v4\/flightdeck-pg\/workspaces\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/me$/);
    need(list||match,403,'Only workspace discovery reads are supported');
    need([...target.searchParams.keys()].every(k=>list?['limit','cursor'].includes(k):false)&&(!list||target.searchParams.get('limit')==='200'),400,'Unsupported discovery query');
    const c={endpoint,serviceNpub:descriptor.towerNpub,mode:'discovery' as const,...(match?{workspaceId:match[1],workspaceAppNpub:npub(b.appNpub)}:{})};
    return json(await browserOperations.start(pk,c,async transport=>{const r=await transport(c as any,{method:'GET',path:b.path});let value:any;try{value=JSON.parse(await boundedNStackText(r,8*1024*1024))}catch{throw new HttpError(502,'Malformed workspace discovery response');}need(r.ok,r.status,value.error||'Workspace discovery denied');return value;}));
   }
   if(p[1]==='nstack'&&p[2]==='authorize'&&method==='POST')return json(await browserOperations.authorize(pk,b));
   if(p[1]==='nstack'&&p[2]==='connect'&&method==='POST'){need(ADMINS.includes(pk),403,'Admin required');const c=connectionInput(b.connection);return json(await browserOperations.start(pk,c,()=>nstack.settingsApi(pk,method,b,'connect'),()=>{need(nstack.getSettings().revision===b.expectedRevision,409,'NStack settings changed; reload before connecting');}));}
   if(p[1]==='nstack')return json(await nstack.settingsApi(pk,method,b,p[2]||''));
   if(p[1]==='installed-apps'&&p.length===3&&method==='GET'){const launch=nstack.launch(pk,id);return json({...launch,previewUrl:preview(launch.versionId)});}
   if(p[1]==='installed-apps'&&p[3]==='data'&&p.length===4&&method==='POST'){const s=nstack.getSettings();if(s.connection?.mode==='browser-user'){const binding=nstack.operationBinding(pk,id,b);return json(await browserOperations.start(pk,s.connection,()=>nstack.operate(pk,id,b),()=>{nstack.operationBinding(pk,id,b,binding);}));}return json(await nstack.operate(pk,id,b));}
   if(p[1]==='artifacts'&&p[3]==='data-installations'&&p.length===4)return json(nstack.installation(pk,id,method,b));
   if(path==='/api/me'&&method==='GET'){
    const s=settings();if(s.featuredProjectId&&Date.parse(s.featuredUntil)>Date.now()&&store.get('project',s.featuredProjectId))store.put('membership',{id:s.featuredProjectId+':'+pk,projectId:s.featuredProjectId,pubkey:pk});
    return json({pubkey:pk,admin:ADMINS.includes(pk),profile:store.get('profile',pk)||{name:'',avatar:''},settings:s,integration:{enabled:cfg.integrationEnabled,interview:cfg.integrationEnabled?(cfg.interviewImagesEnabled?'configured-scoped-agent':'configured-tool-free'):'unconfigured',interviewImages:cfg.interviewImagesEnabled,builder:cfg.builderEnabled?'configured-admin-trusted-host':'unconfigured',hostFilesystemIsolation:false,reason:cfg.integrationEnabled?null:'The tool-free interviewer has not been connected to its managed pipeline yet'}});
   }
   if(path==='/api/profile/nostr'&&method==='GET'){
    const fresh=await readNostrProfile(pk);const previous=store.get('nostrProfile',pk);const profile=newestProfile([fresh,previous?verifiedProfile(previous.event,pk):null]);
    if(profile)store.put('nostrProfile',{id:pk,...profile,checkedAt:new Date().toISOString()});
    return json({profile,appProfile:store.get('profile',pk)||{name:'',avatar:''},readOnly:true,source:fresh?'verified-relay-or-cache':profile?'verified-saved-profile':'unavailable'});
   }
   if(path==='/api/profile'&&method==='PATCH'){const name=text(b.name,100);need(!b.avatar||/^https:\/\//.test(b.avatar),400,'Avatar must use HTTPS');return json(store.put('profile',{id:pk,name,avatar:String(b.avatar||'').slice(0,2000)}));}
   if(path==='/api/settings'){admin(pk);if(method==='GET')return json(settings());if(method==='PATCH'){if(b.featuredProjectId)read('project',b.featuredProjectId);need(!b.featuredUntil||Number.isFinite(Date.parse(b.featuredUntil)));return json(store.put('settings',{id:'global',featuredProjectId:b.featuredProjectId||null,featuredUntil:b.featuredUntil||null}));}}
   if(path==='/api/projects'){
    if(method==='GET')return json({projects:store.all('project').filter(p=>ADMINS.includes(pk)||store.get('membership',p.id+':'+pk)).map(p=>({...p,joinCode:ADMINS.includes(pk)?p.joinCode:undefined})),settings:settings()});
    if(method==='POST'){admin(pk);return json(store.add('project',{title:text(b.title,150),description:String(b.description||''),joinCode:crypto.randomUUID().slice(0,8).toUpperCase()}),201);}
   }
   if(path==='/api/join'&&method==='POST'){const project=store.all('project').find(p=>p.joinCode===String(b.code).trim().toUpperCase());need(project,404,'Join code not found');store.put('membership',{id:project!.id+':'+pk,projectId:project!.id,pubkey:pk});return json(project);}
   if(p[1]==='projects'){
    const project=member(pk,id);
    if(p[3]==='site'){admin(pk);return json(siteBuilder.handleApi(pk,id,p.slice(4),method,b));}
    if(p.length===3&&method==='GET')return json({apps:nstack.projectApps(pk,id),project:{...project,joinCode:ADMINS.includes(pk)?project.joinCode:undefined},designs:store.all('design').filter(d=>d.projectId===id&&d.owner===pk),availableDesigns:ADMINS.includes(pk)?store.all('design').filter(d=>d.projectId===id):[],implementations:ADMINS.includes(pk)?store.all('implementation').filter(i=>i.projectId===id):[],artifacts:store.all('artifact').filter(a=>a.projectId===id&&(ADMINS.includes(pk)||read('design',a.designId).owner===pk)).map(versions)});
    if(p.length===3&&method==='PATCH'){admin(pk);return json(store.put('project',{...project,title:b.title?text(b.title,150):project.title,description:b.description??project.description,joinCode:b.joinCode?text(b.joinCode,100).toUpperCase():project.joinCode}));}
    if(p[3]==='memberships'){admin(pk);if(method==='GET')return json({memberships:store.all('membership').filter(m=>m.projectId===id)});}
    if(p[3]==='designs'&&method==='POST')return json(store.transaction(()=>{const d=store.add('design',{projectId:id,owner:pk,title:b.title?text(b.title,200):'A new freedom design',currentSnapshotId:null});store.put('conversation',{id:d.id,designId:d.id,kind:'interview',owner:pk});return d;}),201);
   }
   if(p[1]==='designs'){
    const d=read('design',id);
    if(p[3]==='brand'){admin(pk);member(pk,d.projectId);const current=store.get('designBrand',id)||{id,revision:0,exceptions:''};if(method==='GET')return json(current);if(method==='PATCH')return json(store.transaction(()=>{const fresh=store.get('designBrand',id)||current;need(b.expectedRevision===fresh.revision,409,'Design brand exceptions changed; reload before saving');need(typeof b.exceptions==='string'&&b.exceptions.length<=8000,400,'Brand exceptions must be text up to 8000 characters');return store.put('designBrand',{id,revision:fresh.revision+1,exceptions:b.exceptions.trim()});}));}
    if(p[3]==='snapshots'&&method==='GET'){member(pk,d.projectId);need(d.owner===pk||ADMINS.includes(pk),403,'Design access denied');return json({design:d,snapshots:store.all('snapshot').filter(s=>s.designId===id),milestones:lifecycle.history(id),artifacts:artifacts(id)});}
    if(p[3]==='implementations'&&method==='POST'){admin(pk);member(pk,d.projectId);const s=read('snapshot',b.snapshotId);need(s.designId===id,400,'Snapshot does not belong to design');if(b.startingVersionId)need(read('version',b.startingVersionId).designId===id,400,'Starting artifact belongs to another design');return json(store.add('implementation',{projectId:d.projectId,designId:id,snapshotId:s.id,startingVersionId:b.startingVersionId||null,owner:pk}),201);}
    owner(pk,id);
    if(p[3]==='images'&&p.length===4&&method==='POST'){need(cfg.interviewImagesEnabled,503,'Image interviews are not active yet');return json(interviewImages.upload(pk,id,b),201);}
    if(p[3]==='images'&&p.length===5&&method==='GET'){const image=interviewImages.context(pk,id,[p[4]!])[0]!;return json({id:image.id,mimeType:image.mimeType,base64:image.base64,sha256:image.sha256});}
    if(p.length===3&&method==='GET')return json({design:d,snapshots:store.all('snapshot').filter(s=>s.designId===id),milestones:lifecycle.history(id),messages:messages(id),artifacts:artifacts(id),jobs:jobs(id)});
    if(p.length===3&&method==='PATCH')return json(store.transaction(()=>{need((b.expectedSnapshotId||null)===(d.currentSnapshotId||null),409,'Design changed; reload before saving');return store.put('snapshot',{...snapshot(d,text(b.title,200),text(b.document),'direct-edit'),editedBy:pk});}));
    if(p[3]==='messages'&&method==='POST')return json(store.transaction(()=>enqueue(pk,read('conversation',id),b,'interview')),202);
   }
   if(p[1]==='implementations'){
    admin(pk);const i=read('implementation',id);const d=read('design',i.designId);member(pk,d.projectId);
    if(p.length===3&&method==='GET')return json({implementation:i,design:d,snapshot:read('snapshot',i.snapshotId),designPin:lifecycle.pin(i.snapshotId),messages:messages(id),artifacts:artifacts(d.id),jobs:jobs(id)});
    if(p[3]==='messages'&&method==='POST')return json(store.transaction(()=>enqueue(pk,i,b,'implementation')),202);
   }
   if(p[1]==='jobs'){
    const j=read('job',id);if(j.kind==='implementation')admin(pk);else owner(pk,j.designId);
    if(method==='GET')return json({...j,context:undefined});
    if(p[3]==='recover'&&method==='POST')return json(store.transaction(()=>{
     const action=b.action||'check';
     if(action==='check'){need(['running','uncertain','dispatching','queued'].includes(j.status),409,'Job does not need delivery recovery');return store.put('job',{...j,recoveryRequestedAt:Date.now(),lastPollAt:0,progress:'Checking managed run and delivery; original request preserved'});}
     need(action==='rebase'&&['conflict','failed','superseded'].includes(j.status),409,'Rebase is available only after a known failed or conflicted turn');
     need(j.kind==='interview',400,'Implementation lineage must be selected in a new implementation conversation');
     const requestId=text(b.requestId,200);const prior=store.all('job').find(x=>x.parentJobId===j.id&&x.requestId===requestId);if(prior)return prior;
     need(j.status!=='superseded',409,'Already rebased');store.put('job',{...j,status:'superseded',progress:'Preserved as a superseded turn'});
     const next=enqueue(pk,read('conversation',j.conversationId),{content:read('message',j.messageId).content,requestId,...(j.context.attachments?.length?{imageIds:j.context.attachments.map((a:any)=>a.id)}:{})},'interview');return store.put('job',{...next,parentJobId:j.id,recoveryReason:'explicit rebase to latest design'});
    }));
    if(p[3]==='retry'&&method==='POST'){need(j.status==='failed',409,'Only failed jobs may be retried');need(!j.context?.attachmentSource||j.context.attachmentSource.expiresAt>Date.now(),409,'Image access expired. Rebase the interview to issue fresh access; the original prompt will not be resent.');return json(store.put('job',{...j,status:'queued',error:null,progress:'Retry pending; same immutable request and lineage'}));}
   }
   if(p[1]==='artifacts'&&p[3]==='publish'&&method==='POST'){admin(pk);const a=read('artifact',id);const v=read('version',b.versionId);need(v.artifactId===a.id&&v.validation?.length,400,'Choose a tested artifact version');return json(store.put('artifact',{...a,publishedVersionId:v.id}));}
   if(p[1]==='worker'){
    need(cfg.workerPubkey&&pk===cfg.workerPubkey,403,'Scoped worker required');
    if(p[2]==='jobs'&&method==='GET'&&!p[3])return json({jobs:store.all('job').filter(j=>j.status==='queued')});
    const j=read('job',p[3]);
    if(p[4]==='context'&&method==='GET')return json(j);
    if(p[4]==='progress'&&method==='POST'){need(j.status!=='complete',409,'Already completed');return json(store.put('job',{...j,status:'running',runId:j.runId||text(b.runId,200),progress:text(b.progress,2000)}));}
    if(p[4]==='complete'&&method==='POST')return json(store.once('complete:'+j.id,hash(body),()=>complete(j,b)));
    if(p[4]==='artifacts'&&method==='POST')return json(store.once('publication:'+j.id+':'+text(b.publicationId,200),hash(body),()=>{
     need(j.kind==='implementation'&&j.status==='running',403,'Active implementation required');need(b.runId===j.runId,403,'Run mismatch');need(Array.isArray(b.validation)&&b.validation.length>0,422,'Actual test evidence required');need(b.files&&typeof b.files['index.html']==='string',422,'index.html required');const fs=Object.entries(b.files);need(fs.length<=500,413,'Too many packaged files');for(const [name,data]of fs){need(/^[a-zA-Z0-9_./-]+$/.test(name)&&!name.startsWith('/')&&!name.split('/').includes('..')&&typeof data==='string',400,'Invalid packaged file');}need(Buffer.byteLength(JSON.stringify(b.files))<=10*1024*1024,413,'Package too large');
     let a=store.all('artifact').find(a=>a.designId===j.designId);if(!a)a=store.add('artifact',{designId:j.designId,projectId:j.projectId,title:text(b.title,200),publishedVersionId:null});
     const prior=store.all('version').filter(v=>v.artifactId===a!.id);const packageHash=hash(JSON.stringify(Object.fromEntries(Object.entries(b.files).sort(([a],[b])=>a.localeCompare(b)))));const identical=[...prior].reverse().find(v=>v.packageHash===packageHash);if(identical)return {versionId:identical.id,artifactId:a.id,previewUrl:preview(identical.id),unchanged:true};let dataManifest=null;if(b.files['byo-data.json']){try{dataManifest=validateManifest(JSON.parse(b.files['byo-data.json']))}catch{throw new HttpError(422,'Invalid byo-data.json collection manifest');}}const v=store.add('version',{dataManifest,artifactId:a.id,designId:j.designId,snapshotId:j.snapshotId,startingVersionId:j.startingVersionId,jobId:j.id,runId:j.runId,number:prior.length+1,files:b.files,validation:b.validation,packageHash,brandRevision:j.context.brand?.projectBrandRevision??null,designBrandRevision:j.context.brand?.designBrandRevision??null,brandContext:j.context.brand||null,sourceDesignPin:j.designPin||null,designPin:lifecycle.pin(j.snapshotId)});lifecycle.published(v);return {versionId:v.id,artifactId:a.id,previewUrl:preview(v.id)};
    }));
   }
   throw new HttpError(404,'Unknown endpoint');
  }catch(e){if(e instanceof HttpError)return json({error:e.message},e.status);if(e instanceof Error&&e.message==='Receipt conflict')return json({error:e.message},409);console.error(e instanceof Error?e.message:'Unknown error');return json({error:'Request failed'},500);}
 }
 function publicSite(path:string):Response{
  const p=path.split('/').filter(Boolean);let v:Row|undefined;let file='index.html';let project:Row|undefined;
  if(p[0]==='preview'){const ticket=read('preview',p[1]);need(ticket.expires>Date.now(),404,'Preview expired; reload workspace');v=read('version',ticket.versionId);file=p.slice(2).join('/')||'index.html';}
  else{project=read('project',p[1]);if(p[2]){const a=read('artifact',p[2]);need(a.projectId===project.id&&a.publishedVersionId,404,'Not published');
   if(p[3]!=='_files'){
    const nav=store.all('artifact').filter(other=>other.projectId===project!.id&&other.publishedVersionId).map(other=>`<a href="/sites/${project!.id}/${other.id}/" ${other.id===a.id?'aria-current="page"':''}>${escape(other.title)}</a>`).join('');
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(a.title)} · ${escape(project.title)}</title><style>*{box-sizing:border-box}body{margin:0;font:15px system-ui;color:#292d29;background:#faf7ef}nav{padding:14px 20px;display:flex;gap:20px;overflow:auto;align-items:center;border-bottom:1px solid #ddd}a{color:inherit;white-space:nowrap}a[aria-current]{color:#a14c1a;font-weight:700}iframe{display:block;border:0;width:100%;height:calc(100dvh - 53px);background:white}</style><nav aria-label="Project navigation"><a href="/sites/${project.id}/">${escape(project.title)}</a>${nav}</nav>${store.get('nstackInstallation',a.publishedVersionId)?.enabled===true?`<p style="margin:12px 20px"><a href="/#/apps/${encodeURIComponent(a.publishedVersionId)}" target="_top">Open app to save ↗</a> · Project membership required</p>`:''}<iframe title="${escape(a.title)}" sandbox="allow-scripts allow-forms allow-downloads" src="/sites/${project.id}/${a.id}/_files/index.html"></iframe>`,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; frame-src 'self'; style-src 'unsafe-inline'; base-uri 'none'",'referrer-policy':'no-referrer'}});
   }
   v=read('version',a.publishedVersionId);file=p.slice(4).join('/')||'index.html';}}
  if(v){need(Object.hasOwn(v.files,file),404,'File not found');const type=file.endsWith('.html')?'text/html':file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/plain';return new Response(v.files[file],{headers:{'content-type':type+'; charset=utf-8','content-security-policy':"sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src 'unsafe-inline' 'self' blob:; style-src 'unsafe-inline' 'self'; img-src https: data: blob: 'self'; connect-src https: wss:; font-src 'self' data:; frame-src 'none'; base-uri 'none'; form-action 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cache-control':'no-store','access-control-allow-origin':'*'}});}
  const links=store.all('artifact').filter(a=>a.projectId===project!.id&&a.publishedVersionId).map(a=>`<a href="/sites/${project!.id}/${a.id}/">${escape(a.title)}</a>`).join('');
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(project!.title)}</title><style>body{max-width:960px;margin:60px auto;padding:24px;font:18px system-ui;background:#faf7ef;color:#292d29}a{display:block;padding:24px;margin:16px 0;border:1px solid #ddd;color:inherit}nav{font-size:14px}</style><nav>BYO Freedom · Project site</nav><h1>${escape(project!.title)}</h1><p>${escape(project!.description)}</p>${links||'<p>Contributions will appear here when an admin publishes a tested version.</p>'}`,{headers:{'content-type':'text/html; charset=utf-8','content-security-policy':"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'"}});
 }
 return {fetch,complete};
}
