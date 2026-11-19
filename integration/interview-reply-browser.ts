import {chromium} from '@playwright/test';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {hash} from '../src/auth';
import finish from '../pipelines/functions/finish-interview.v5';
// Isolated in-memory app only; real browser rendering and signed HTTP callbacks.
const store=new Store(':memory:'),key=generateSecretKey(),owner=getPublicKey(key),worker=generateSecretKey(),workerPk=getPublicKey(worker);
store.put('project',{id:'project',title:'Interview reply acceptance',joinCode:'FIXTURE'});
store.put('membership',{id:'project:'+owner,projectId:'project',pubkey:owner});
store.put('design',{id:'design',projectId:'project',owner,title:'Original design',currentSnapshotId:'original'});
store.put('snapshot',{id:'original',designId:'design',title:'Original design',document:'Previous participant design.'});
store.put('conversation',{id:'design',designId:'design',kind:'interview',owner});
let app:ReturnType<typeof createApp>;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app.fetch(r)}),origin=`http://127.0.0.1:${server.port}`;
app=createApp(store,config({PUBLIC_ORIGIN:origin,AUTOPILOT_WEBHOOK_PUBKEY:workerPk}));
const browser=await chromium.launch({channel:'chrome',headless:true}),checks:string[]=[];
const pass=(value:boolean,label:string)=>{if(!value)throw Error(label);checks.push(label);};
const evidence=process.env.BYO_BROWSER_EVIDENCE||'tmp/docs/handoffs';
async function deliver(id:string,reply:string,expectedSnapshotId:string){
 store.put('job',{id,kind:'interview',owner,projectId:'project',designId:'design',conversationId:'design',runId:id,status:'running',expectedSnapshotId});
 const result=await finish({turn:{status:'completed',reply,sessionId:'session',nativeSessionId:'native',receiptId:id,output:{executionProfile:'scoped-interview',sourceReceipts:[]}}});
 const body=JSON.stringify({deliveryId:id,runId:id,status:'ok',terminal:true,result,error:null});
 const event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags:[['u',origin+'/api/pipeline-webhook'],['method','POST'],['payload',hash(body)],['delivery',id],['run',id]]},worker);
 const headers={authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64'),'x-wingman-delivery-id':id,'x-wingman-run-id':id,'content-type':'application/json'};
 const response=await fetch(origin+'/api/pipeline-webhook',{method:'POST',headers,body});pass(response.ok,`${id}: signed completion accepted`);
 const duplicate=await fetch(origin+'/api/pipeline-webhook',{method:'POST',headers,body});pass(duplicate.ok,`${id}: duplicate delivery acknowledged`);
}
try{
 const page=await browser.newPage({viewport:{width:1440,height:900}}),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(secret=>{if(window===top){localStorage.setItem('byo-freedom.identity.v1',secret);localStorage.setItem('byo-freedom.signer.v1','anonymous');}},Buffer.from(key).toString('hex'));
 await deliver('normal',JSON.stringify({title:'Updated design',document:'Research notes\nPlain URL https://example.org/source',response:'Here is your completed reply. **A useful next question?**',extra:'accepted'}),'original');
 await page.goto(origin+'/#/designs/design');await page.getByText('Here is your completed reply.',{exact:false}).waitFor();
 pass(await page.locator('.message strong').filter({hasText:'A useful next question?'}).count()===1,'Normal replies retain safe Markdown');
 pass(await page.locator('.design-save-warning').count()===0,'Accepted design has no save warning');
 const saved=store.get('design','design')!.currentSnapshotId;
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});await page.screenshot({path:`${evidence}/interview-reply-normal-${width}.png`});}
 const raw='Your answer remains available. <script>globalThis.replyInjected=true</script>';
 await deliver('reply-only',raw,saved);await page.reload();await page.getByText('Reply delivered · Design not saved',{exact:true}).waitFor();
 pass(await page.locator('.plain-reply').textContent()===raw,'Plain native output is displayed as escaped text');
 pass(await page.evaluate(()=>!(globalThis as any).replyInjected),'Native HTML cannot execute');
 pass(store.get('design','design')!.currentSnapshotId===saved&&store.all('snapshot').length===2,'Reply-only completion preserves previous immutable design');
 pass(store.all('message').filter(m=>m.role==='assistant').length===2,'Duplicate callbacks create no duplicate replies');
 for(const width of [1440,390]){await page.setViewportSize({width,height:900});pass(await page.locator('.design-save-warning').isVisible(),`${width}: separate save warning visible`);pass(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}: no horizontal overflow`);await page.screenshot({path:`${evidence}/interview-reply-warning-${width}.png`});}
 await page.reload();await page.getByText('Reply delivered · Design not saved',{exact:true}).waitFor();pass(await page.locator('.plain-reply').textContent()===raw,'Reply and warning survive reload');pass(errors.length===0,'No browser runtime errors');
 await Bun.write(`${evidence}/interview-reply-browser.json`,JSON.stringify({status:'passed',scope:'Isolated in-memory app, real Chrome desktop/mobile, signed callbacks; no live/native writes',checks},null,2));console.log(JSON.stringify({status:'passed',checks},null,2));
}finally{await browser.close();await server.stop(true);store.db.close();}
