import {chromium} from '@playwright/test';
import {generateSecretKey,getPublicKey} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';

// Local owned fixture: real signer, browser image decoder, upload API and saved message. No native/model claim.
const store=new Store(':memory:'),key=generateSecretKey(),owner=getPublicKey(key);
store.put('project',{id:'p',title:'Image acceptance'});store.put('membership',{id:'p:'+owner,projectId:'p',pubkey:owner});
store.put('design',{id:'d',owner,projectId:'p',title:'Image-only design',currentSnapshotId:null});store.put('conversation',{id:'d',designId:'d',kind:'interview',owner});
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:request=>app.fetch(request)});
const origin=`http://127.0.0.1:${server.port}`;
app=createApp(store,config({PUBLIC_ORIGIN:origin,INTERVIEW_PIPELINE_CONFIG:'local-ui-fixture-only',INTERVIEW_WORKFLOW_VERSION:'interview-v5',INTERVIEW_SCOPED_TOOLS:'1'}));
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
 await page.locator('#message-input').fill('Unsaved participant text');await paste();await page.getByText('Uploading image…',{exact:true}).waitFor();pass(await page.locator('[data-image-drafts] [aria-busy=true]').count()===1,'Uploading placeholder occupies pending attachment position');pass(await page.locator('#message-input').inputValue()==='Unsaved participant text','Pasting preserves participant text');await page.screenshot({path:evidence+'/paste-uploading-desktop.png'});releaseUpload();
 await page.getByText('Images ready. Send your message when you are ready.').waitFor();
 await page.unroute('**/api/designs/d/images');await page.locator('#message-input').fill('');
 const staged=store.all('interviewImage')[0]!;pass(staged.mimeType==='image/png'&&staged.width===320,'WebP visual pixels normalised and privately uploaded as PNG');
 pass(await page.locator('[aria-busy=true]').count()===0,'Confirmed private thumbnail replaces uploading placeholder');await page.reload();await page.locator('[data-remove-image]').waitFor();pass(await page.locator('#message-input').getAttribute('required')===null,'staged ID survives refresh and permits image-only send');
 await page.setViewportSize({width:390,height:844});await page.locator('[data-remove-image]').click();await page.route('**/api/designs/d/images',route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"Upload unavailable; retry paste"}'}));await paste();await page.getByText('Upload unavailable; retry paste',{exact:true}).waitFor();pass(await page.locator('.image-upload-placeholder').count()===0,'Failed upload removes pending placeholder and retains retry error');await page.unroute('**/api/designs/d/images');await paste();await page.getByText('Images ready. Send your message when you are ready.').waitFor();await page.locator('[data-preview-image] img').waitFor();await page.screenshot({path:evidence+'/paste-ready-mobile.png'});pass(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Phone paste and private thumbnail fit viewport');
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
 pass(store.all('artifact').length===0&&store.all('version').length===0,'image interview does not build or publish an artefact');pass(errors.length===0,'browser has no runtime errors');
 await Bun.write(evidence+'/paste-acceptance.json',JSON.stringify({status:'passed',checks,scope:'Local isolated storage fixture, no managed NStack activation claim'},null,2));console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await browser.close();await server.stop(true);store.db.close();}
