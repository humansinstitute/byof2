import {chromium} from '@playwright/test';
import {generateSecretKey,getPublicKey} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {createAppBrokerNStackFiles,createAppGatewayNStackFiles,appStorageProtocol} from './nstack-app-files';
import {createNStackGateway} from '../src/nstack-gateway';
import {createManagedInterviewStorage} from '../src/interview-managed-storage';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {hash} from '../src/auth';

const binding={endpoint:'https://tower.example',serviceNpub:'fixture-service',workspaceOwnerNpub:'fixture-owner',appNpub:'fixture-backend-app',installationId:'fixture-installation'};
const ns={protocol:appStorageProtocol,workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub};
const objects=new Map<string,any>(),keys=new Map<string,string>(),rows=new Map<string,any>();let unavailable=false;
// Owned fake standard API with real HTTP at the broker boundary; no Tower or NStack account exists for the participant.
const broker=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(req){
 const r=await req.json() as any;if(unavailable)return Response.json({}, {status:503});
 if(r.installationId!==binding.installationId)throw Error('Foreign installation');
 if(r.path==='/descriptor')return Response.json({...ns,private_only:true,max_object_bytes:8388608,operations:['prepare','upload','complete','metadata','content','head']});
 if(r.path==='/prepare'){let id=keys.get(r.body.idempotency_key);if(!id){id=crypto.randomUUID();keys.set(r.body.idempotency_key,id);objects.set(id,{...ns,object_id:id,...r.body,is_public:false,completed_at:null});}const {bytes,...meta}=objects.get(id);return Response.json(meta);}
 const id=r.path.split('/')[2],o=objects.get(id);if(!o)return Response.json({}, {status:404});
 if(r.method==='PUT'){const bytes=Buffer.from(r.body.base64_data,'base64');if(hash(bytes)!==o.sha256_hex||bytes.length!==o.size_bytes)throw Error('Fixture integrity');o.bytes=r.body.base64_data;}
 if(r.path.endsWith('/complete'))o.completed_at=new Date().toISOString();
 const {bytes,...meta}=o;return Response.json(r.path.endsWith('/content')?{...ns,object_id:id,content_type:o.content_type,size_bytes:o.size_bytes,sha256_hex:o.sha256_hex,bytes_base64:bytes}:meta);
}});
const files=createAppBrokerNStackFiles({bindings:[binding],control:(installationId,r)=>fetch(`http://127.0.0.1:${broker.port}`,{method:'POST',body:JSON.stringify({installationId,...r})})});
const gateway=createNStackGateway({bindings:[binding],token:()=> 'x'.repeat(43),appImageFiles:files,broker:async(_,r)=>{if(r.method==='GET')return Response.json({...ns,row:rows.get(r.path.split('/').at(-1)!)});const b=r.body as any;if(rows.has(b.id))return Response.json({}, {status:409});rows.set(b.id,b.data);return Response.json({...ns,row:b.data});}});
const tokenDir=mkdtempSync(join(tmpdir(),'byof-app-image-browser-')),tokenPath=join(tokenDir,'token');writeFileSync(tokenPath,'x'.repeat(43),{mode:0o600});
const gatewayFiles=createAppGatewayNStackFiles({BYO_NSTACK_GATEWAY_URL:'https://gateway.example/v1/data',BYO_NSTACK_GATEWAY_TOKEN_FILE:tokenPath},(async(url,init)=>{if(String(url)!=='https://gateway.example/v1/app-images')throw Error('Unexpected target');return gateway.fetch(new Request(url,init));}) as typeof fetch);

// Local owned fixture: real signer, browser image decoder, upload API and saved message. No native/model claim.
const store=new Store(':memory:'),key=generateSecretKey(),owner=getPublicKey(key);
store.put('project',{id:'p',title:'Image acceptance'});store.put('membership',{id:'p:'+owner,projectId:'p',pubkey:owner});
store.put('nstack',{id:'global',revision:7,connection:{...binding,appNpub:'separate-browser-app',mode:'browser-user',workspaceId:'browser-workspace'},state:'ready',capabilities:{json:true,files:false}});
const savedSettings=JSON.stringify(store.get('nstack','global'));
store.put('design',{id:'d',owner,projectId:'p',title:'Image-only design',currentSnapshotId:null});store.put('conversation',{id:'d',designId:'d',kind:'interview',owner});
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
const origin=`http://127.0.0.1:${server.port}`;
app=createApp(store,config({PUBLIC_ORIGIN:origin,INTERVIEW_PIPELINE_CONFIG:'local-ui-fixture-only',INTERVIEW_WORKFLOW_VERSION:'interview-v5',INTERVIEW_SCOPED_TOOLS:'1'}),{interviewStorage:createManagedInterviewStorage(store,binding,gatewayFiles)});
const browser=await chromium.launch({channel:'chrome',headless:true});
const evidence=process.env.BYO_BROWSER_EVIDENCE||'tmp/docs/handoffs';
const checks:string[]=[];const pass=(ok:boolean,label:string)=>{if(!ok)throw Error(label);checks.push(label);};
try{
 const page=await browser.newPage({viewport:{width:1280,height:900}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(keyHex=>{localStorage.setItem('byo-freedom.identity.v1',keyHex);localStorage.setItem('byo-freedom.signer.v1','anonymous');},Buffer.from(key).toString('hex'));
 await page.goto(origin+'/#/designs/d');await page.locator('[data-image-upload]').waitFor({state:'attached'});
 const webp=await page.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=160;const ctx=canvas.getContext('2d')!;ctx.fillStyle='#6847a1';ctx.fillRect(0,0,320,160);ctx.fillStyle='white';ctx.font='24px sans-serif';ctx.fillText('Reference 42',30,80);return canvas.toDataURL('image/webp').split(',')[1]!;});
 pass(await page.locator('[data-select-image]').count()===0&&await page.getByText('Paste an image here',{exact:false}).count()===0,'No visible image picker or paste instruction');
 const paste=()=>page.locator('#message-input').evaluate((el,b64)=>{const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));const transfer=new DataTransfer();transfer.items.add(new File([bytes],'reference.webp',{type:'image/webp'}));el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,cancelable:true}));},webp);
 let releaseUpload:()=>void=()=>{};const uploadGate=new Promise<void>(resolve=>releaseUpload=resolve);
 await page.route('**/api/designs/d/images',async route=>{if(route.request().method()!=='POST')return route.continue();await uploadGate;await route.continue();});
 await page.locator('#message-input').fill('Unsaved participant text');await paste();await page.getByText('Uploading image…',{exact:true}).waitFor();pass(await page.locator('[data-image-drafts] [aria-busy=true]').count()===1,'Uploading placeholder occupies pending attachment position');pass(await page.locator('#message-input').inputValue()==='Unsaved participant text','Pasting preserves participant text');await page.screenshot({path:evidence+'/standard-app-uploading-desktop.png'});releaseUpload();
 await page.getByText('Images ready. Send your message when you are ready.').waitFor();
 await page.unroute('**/api/designs/d/images');await page.locator('#message-input').fill('');
 const staged=store.all('interviewImage')[0]!;pass(staged.mimeType==='image/png'&&staged.width===320,'WebP visual pixels normalised and privately uploaded as PNG');
 pass(store.all('interviewImageStorage').length===1&&objects.size===1,'Nonmember participant upload completes standard app byte lifecycle');
 pass(await page.locator('[aria-busy=true]').count()===0,'Confirmed private thumbnail replaces uploading placeholder');await page.reload();await page.locator('[data-remove-image]').waitFor();pass(await page.locator('#message-input').getAttribute('required')===null,'staged ID survives refresh and permits image-only send');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-remove-image]').click();unavailable=true;await paste();await page.getByText('Private interview storage is not active',{exact:true}).waitFor();pass(await page.locator('.image-upload-placeholder').count()===0,'Failed upload removes pending placeholder and retains retry error');unavailable=false;await paste();await page.getByText('Images ready. Send your message when you are ready.').waitFor();await page.locator('[data-preview-image] img').waitFor();await page.screenshot({path:evidence+'/standard-app-ready-mobile.png'});pass(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone paste and private thumbnail fit viewport');
 await page.route('**/api/designs/d/messages',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Fixture send unavailable'})}));
 await page.locator('#message-form [type=submit]').click();await page.getByText('Fixture send unavailable',{exact:true}).waitFor();
 const pending=await page.evaluate(()=>JSON.parse(localStorage.getItem('byo-freedom.pending.design.d')!));pass(pending.content===''&&pending.imageIds[0]===staged.id,'failed image-only send retains exact request identity and staged image');
 await page.reload();await page.locator('[data-remove-image]').waitFor();await page.unroute('**/api/designs/d/messages');await page.locator('#message-form [type=submit]').click();
 await page.waitForFunction(()=>document.querySelector('[data-view-image]'));
 const message=store.all('message')[0]!,job=store.all('job')[0]!;
 pass(message.content===''&&message.imageIds[0]===staged.id&&job.requestId===pending.requestId,'retry saves actual empty participant text with the same request and image IDs');
 pass(job.context.attachments[0].sha256===staged.sha256&&!job.context.attachments[0].base64,'pipeline context contains immutable metadata and exact-job ticket, without image bytes');
 pass(await page.evaluate(()=>localStorage.getItem('byo-freedom.images.d')===null),'successful send clears only the sent attachment draft');
 await page.locator('[data-view-image]').click();await page.locator('.modal img').waitFor();pass(await page.locator('.modal img').evaluate((image:HTMLImageElement)=>image.complete&&image.naturalWidth===320),'saved participant reference opens through owner-authenticated image read');
 pass(store.all('artifact').length===0&&store.all('version').length===0,'image interview does not build or publish an artefact');pass(errors.length===0,'browser has no runtime errors');pass(JSON.stringify(store.get('nstack','global'))===savedSettings,'Existing browser app identity and saved settings remain unchanged');
 await Bun.write(evidence+'/standard-app-acceptance.json',JSON.stringify({status:'passed',checks,scope:'Real Chrome and HTTP against isolated fake standard app API; no live NStack activation claim'},null,2));console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await browser.close();await server.stop(true);store.db.close();await broker.stop(true);rmSync(tokenDir,{recursive:true,force:true});}
