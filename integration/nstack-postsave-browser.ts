/** Actual Chrome UI regression; all settings and Tower responses are isolated fixtures. */
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
const baseline=process.env.BYO_POSTSAVE_BASELINE==='1';
const build=await Bun.build({entrypoints:['public/nstack.ts'],target:'browser',format:'esm',plugins:baseline?[{name:'baseline',setup(b){b.onLoad({filter:/public\/nstack(?:-browser)?\.ts$/},({path})=>({contents:execFileSync('git',['show',`63d6b33:${path.slice(process.cwd().length+1)}`],{encoding:'utf8'}),loader:'ts'}));}}]:[]});
if(!build.success)throw Error(String(build.logs));const js=await build.outputs[0].text();
const appSource=baseline?execFileSync('git',['show','63d6b33:public/app.ts'],{encoding:'utf8'}):await Bun.file('public/app.ts').text();
const apiSource=new Bun.Transpiler({loader:'ts'}).transformSync(appSource.slice(appSource.indexOf('async function api('),appSource.indexOf('\n',appSource.indexOf('async function api('))));
const cryptoBuild=await Bun.build({stdin:undefined,entrypoints:['node_modules/nostr-tools/lib/esm/index.js'],target:'browser',format:'esm'} as any);
if(!cryptoBuild.success)throw Error(String(cryptoBuild.logs));const cryptoJs=await cryptoBuild.outputs[0].text();
const server=Bun.serve({port:0,fetch(req){const p=new URL(req.url).pathname;return new Response(p==='/ui.js'?js:p==='/crypto.js'?cryptoJs:'<html><body></body></html>',{headers:{'content-type':p.endsWith('.js')?'text/javascript':'text/html'}});}});
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
const pass=(ok:any,text:string)=>{if(!ok)throw Error(text);console.log('PASS',text);};
try{for(const scenario of baseline?['saved']:['initial-cancel','initial-timeout','saved','cancel','close','timeout','late-api','lost-response','denial','conflict']){
 const page=await browser.newPage({viewport:{width:390,height:844}});const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));await page.goto(server.url.href);
 await page.evaluate(async({scenario,apiSource})=>{
  const {nstackSettings}=await import(String('/ui.js')),m=await import(String('/crypto.js'));const key=m.generateSecretKey(),pub=m.nip19.npubEncode(m.getPublicKey(key));
  const saved:any={revision:2,state:'ready',connection:{endpoint:'https://fixture.example',workspaceId:'11111111-1111-4111-8111-111111111111',workspaceName:'Workshop',mode:'browser-user'},appNpub:'npub1uzczf3p5c9j36hqlyqj5gzl47th3kp4yqz03y5tswkd0y7ucemhs7rf22j',canDisconnect:true,capabilities:{json:true,files:false}};
  const t:any={gets:0,posts:0,authorizes:0,committed:false,release:null,signing:false};(window as any).t=t;
  const nativeSetTimeout=window.setTimeout.bind(window);if(scenario.endsWith('timeout'))window.setTimeout=((fn:any,ms:any,...args:any[])=>nativeSetTimeout(fn,ms===120000?150:ms,...args)) as any;
  const sign=async(e:any)=>{const path=new URL(e.tags.find((t:any)=>t[0]==='u')[1]).pathname;if((scenario==='late-api'&&path==='/api/nstack/connect'||scenario.startsWith('initial-')&&path==='/api/nstack')){t.signing=true;await new Promise(r=>t.release=r);}return m.finalizeEvent(e,key);};
  const sha=async(b:any)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',b))].map(x=>x.toString(16).padStart(2,'0')).join('');
  const api=new Function('sign','sha',apiSource+';return api;')(sign,sha);
  const signer={getPublicKey:async()=>m.getPublicKey(key),signEvent:async(e:any)=>{t.signing=true;if(['cancel','close','timeout'].includes(scenario))await new Promise(r=>t.release=r);if(scenario==='denial')throw Error('Signer denied');return m.finalizeEvent(e,key);}};
  window.fetch=(async(input:any,init:any)=>{const url=new URL(String(input)),path=url.pathname,body=init?.body?JSON.parse(String(init.body)):null;
   if(path==='/api/nstack'){t.gets++;if(t.committed)return new Promise(()=>{});return Response.json(saved);}
   if(path==='/.well-known/nstack.json')return Response.json({schema:'org.wingman.nstack.services',schema_version:1,stack:{name:'Fixture',tower_npub:pub},services:[{kind:'tower',id:'tower',endpoint:url.origin,protocols:['nip-98']}]});
   if(path==='/api/nstack/discovery-request'&&body.path==='/.well-known/nstack.json')return Response.json({done:true,result:{schema:'org.wingman.nstack.services',schema_version:1,stack:{name:'Fixture',tower_npub:pub},services:[{kind:'tower',id:'tower',endpoint:body.endpoint,protocols:['nip-98']}]}});
   if(path==='/api/nstack/discovery-request')return Response.json({done:true,result:{complete:true,workspaces:[{label:'Workshop',identity:{workspace_id:saved.connection.workspaceId,tower_service_npub:pub,workspace_owner_npub:pub,workspace_service_npub:pub,app_npub:pub}}]}});
   if(path==='/api/nstack/connect'){t.posts++;t.connection=body.connection;if(scenario==='conflict')return Response.json({error:'NStack settings changed; reload'},{status:409});
    if(['saved','lost-response'].includes(scenario)){t.committed=true;saved.revision++;const result={...saved,connection:body.connection};delete result.appNpub;delete result.canDisconnect;if(scenario==='lost-response')return new Promise(()=>{});return Response.json({done:true,result});}
    return Response.json({operationId:'op',connection:body.connection,challenge:{id:'one',method:'POST',url:body.connection.endpoint+'/api/v4/flightdeck-pg/workspaces/'+body.connection.workspaceId+'/apps/'+saved.appNpub+'/registration',body:JSON.stringify({app_name:'BYO Freedom',capabilities:['app_rows.private_only']})}});
   }if(path==='/api/nstack/authorize'){t.authorizes++;throw Error('Mutation should not run');}throw Error('Unexpected '+path);
  }) as typeof window.fetch;
  const modal=(title:string,html:string)=>{document.querySelector('.modal-backdrop')?.remove();const box=document.createElement('div');box.className='modal-backdrop';box.innerHTML=`<section class="modal"><button data-close type="button">Close dialog</button><form>${html}</form></section>`;box.querySelector('[data-close]')!.addEventListener('click',()=>box.remove());document.body.append(box);return box;};
  void nstackSettings(api,modal,signer);
 },{scenario,apiSource});
 if(scenario.startsWith('initial-')){await page.locator('#nstack-cancel').waitFor();if(scenario==='initial-cancel')await page.locator('#nstack-cancel').click();await page.locator('#nstack-error').filter({hasText:'Outcome unknown'}).waitFor();pass(await page.locator('#nstack-refresh').isVisible(),scenario+' recovery and close available');await page.evaluate(()=>(window as any).t.release?.());await page.waitForTimeout(50);pass(await page.evaluate(()=>(window as any).t.gets===0),scenario+' late initial signature sends no request');await page.close();continue;}
 await page.locator('#nstack-load').click();await page.locator('#nstack-workspaces button').click();await page.locator('#nstack-connect').click();
 if(scenario==='saved'){
  if(baseline){await page.waitForFunction(()=>(window as any).t.gets===2);pass(await page.locator('[aria-busy=true]').count()===1,'baseline reproduces committed save followed by hanging extra GET');}
  else{await page.getByText('Saved · Workshop · Ready',{exact:true}).waitFor();pass(await page.evaluate(()=>(window as any).t.gets===1),'saved result shown immediately; no post-save GET');pass(await page.locator('#nstack-disconnect').count()===1,'initial disconnect policy preserved');await page.locator('#nstack-load').click();await page.locator('#nstack-workspaces button').click();await page.locator('#nstack-connect').click();await page.getByText('Saved · Workshop · Ready',{exact:true}).waitFor();pass(await page.evaluate(()=>(window as any).t.connection.appNpub==='npub1uzczf3p5c9j36hqlyqj5gzl47th3kp4yqz03y5tswkd0y7ucemhs7rf22j'),'static app namespace preserved on subsequent save');}
 }else if(['cancel','close','timeout','late-api','lost-response'].includes(scenario)){
  await page.waitForFunction(()=>{const t=(window as any).t;return t.signing||t.committed;});
  if(scenario==='close')await page.getByText('Close dialog',{exact:true}).click();else if(scenario!=='timeout')await page.locator('#nstack-cancel').click();
  if(scenario!=='close'){await page.locator('#nstack-error').filter({hasText:'Outcome unknown'}).waitFor();pass(await page.locator('#nstack-refresh').isEnabled(),scenario+' recovery enabled');pass(await page.locator('#nstack-connect').isDisabled(),scenario+' requires fresh selection');await page.getByText('Close dialog',{exact:true}).click();}
  await page.evaluate(()=>{(window as any).t.release?.();});await page.waitForTimeout(100);
  pass(await page.evaluate(()=>{const t=(window as any).t;return t.authorizes===0&&(t.signing?t.posts<=1:true);}),scenario+' late completion never authorizes mutation');
  if(scenario==='late-api')pass(await page.evaluate(()=>(window as any).t.posts===0),'late API-auth signature never sends start POST');
  if(scenario==='lost-response')pass(await page.evaluate(()=>(window as any).t.posts===1),'uncertain committed request never replayed');
 }else{await page.locator('#nstack-error').filter({hasText:scenario==='denial'?'Signer denied':'settings changed'}).waitFor();pass(!(await page.locator('#nstack-feedback').innerText()).includes('has not been replaced'),scenario+' visible without false unchanged claim');}
 pass(errors.length===0,scenario+' no uncaught browser errors');await page.close();
}}finally{await browser.close();server.stop();}
