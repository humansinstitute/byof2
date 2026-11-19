import {chromium} from '@playwright/test';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {ADMINS} from '../src/auth';

// All browser network requests are fulfilled locally or aborted, including these HTTPS names.
// This exercises the real bundle and signatures; it never reaches a hosted app or pipeline.
const canonical=process.env.BYO_FIXTURE_ORIGIN||'https://new.example';
const legacy=process.env.BYO_FIXTURE_ALIAS||'https://previous.example';
const evidence=process.env.BYO_BROWSER_EVIDENCE||'tmp/docs/handoffs/origin-migration';
const key=generateSecretKey(),owner=getPublicKey(key),store=new Store(':memory:');ADMINS.push(owner);
store.put('project',{id:'p',title:'Origin migration fixture',description:'Isolated extension login and site builder.',joinCode:'FIXTURE'});
store.put('design',{id:'d',projectId:'p',title:'Fixture design',owner,currentSnapshotId:'s'});
store.put('snapshot',{id:'s',designId:'d',title:'Fixture design',document:'Build an isolated counter.'});
store.put('conversation',{id:'d',designId:'d',owner,kind:'interview'});
store.put('artifact',{id:'a',projectId:'p',designId:'d',title:'Fixture counter'});
store.put('version',{id:'v',artifactId:'a',designId:'d',number:1,snapshotId:'s',validation:['isolated fixture'],files:{'index.html':'<!doctype html><button id="counter">0</button><script src="asset.js"></script>','asset.js':'counter.onclick=()=>counter.textContent=Number(counter.textContent)+1;'}});
const app=createApp(store,config({NODE_ENV:'production',PUBLIC_ORIGIN:canonical,PUBLIC_ORIGIN_ALIASES:legacy}));
const profile=finalizeEvent({kind:0,created_at:Math.floor(Date.now()/1000),content:JSON.stringify({name:'Fixture extension'}),tags:[]},key);
const browser=await chromium.launch({channel:'chrome',headless:true}),checks:string[]=[],requests:{origin:string;path:string;method:string;status:number}[]=[],signedUrls:string[]=[];
function pass(value:unknown,label:string){if(!value)throw Error(label);checks.push(label);console.log(label);}
try{
 for(const origin of [canonical,legacy]){
  const context=await browser.newContext({viewport:{width:1440,height:1000}});const errors:string[]=[];
  await context.route('**/*',async route=>{
   const r=route.request(),url=new URL(r.url());if(![canonical,legacy].includes(url.origin)){await route.abort();return;}
   const response=url.pathname==='/api/profile/nostr'?Response.json({profile:{event:profile}}):await app.fetch(new Request(r.url(),{method:r.method(),headers:r.headers(),...(r.postDataBuffer()?{body:new Uint8Array(r.postDataBuffer()!)}:{})}));
   requests.push({origin:url.origin,path:url.pathname,method:r.method(),status:response.status});
   await route.fulfill({status:response.status,headers:Object.fromEntries(response.headers),body:Buffer.from(await response.arrayBuffer())});
  });
  await context.routeWebSocket('**/*',ws=>ws.close());
  await context.exposeBinding('fixturePublicKey',()=>owner);
  await context.exposeBinding('fixtureSign',(_source,event:any)=>{if(event.kind!==27235)throw Error('Signer only permits NIP-98');signedUrls.push(event.tags.find((t:string[])=>t[0]==='u')[1]);return finalizeEvent(event,key);});
  await context.addInitScript(()=>{Object.assign(window,{nostr:{getPublicKey:()=>(window as any).fixturePublicKey(),signEvent:(event:any)=>(window as any).fixtureSign(event)}});});
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(origin);await page.getByRole('button',{name:'Log in with Nostr extension',exact:true}).click();await page.getByRole('heading',{name:'My Projects',exact:true}).waitFor();
  pass(await page.evaluate(()=>localStorage.getItem('byo-freedom.signer.v1'))==='extension',`${origin}: explicit extension login succeeds`);
  pass(await page.evaluate(()=>localStorage.getItem('byo-freedom.identity.v1'))===null,`${origin}: extension identity never copied into browser storage`);
  await page.getByRole('heading',{name:'Origin migration fixture',exact:true}).click();await page.getByRole('link',{name:'View project site',exact:false}).waitFor();
  pass((await page.getByRole('link',{name:'View project site',exact:false}).getAttribute('href'))?.startsWith(canonical+'/sites/'),`${origin}: project public link is canonical`);
  await page.getByRole('link',{name:'Project Builder',exact:true}).click();await page.getByRole('button',{name:'Share',exact:true}).click();pass((await page.locator('#invite-url').inputValue()).startsWith(canonical+'/ic='),`${origin}: new share URL is canonical`);await page.getByRole('button',{name:'Close dialog',exact:true}).click();await page.getByRole('link',{name:'Design conversations',exact:true}).click();
  // Library preview must load its real packaged JS under the canonical CSP from either browser origin.
  await page.locator('[data-library-preview]').first().click();await page.locator('.library-preview').waitFor();pass((await page.locator('.library-preview').getAttribute('src'))?.startsWith(canonical+'/library-preview/'),`${origin}: library preview URL is canonical`);await page.frameLocator('.library-preview').locator('#counter').click();await page.frameLocator('.library-preview').getByRole('button',{name:'1',exact:true}).waitFor();pass(true,`${origin}: library preview executes canonical packaged subresource`);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.getByRole('link',{name:'Project Builder',exact:false}).click();await page.getByRole('tab',{name:'Site details',exact:true}).waitFor();
  await page.getByLabel('Site title',{exact:true}).fill('Fixture saved on '+new URL(origin).hostname);await page.getByRole('button',{name:'Save draft',exact:true}).click();await page.getByText('All changes saved',{exact:true}).waitFor();pass(true,`${origin}: exact-body signed builder save succeeds`);
  await page.getByRole('tab',{name:'Artefact toolbox',exact:true}).click();await page.frameLocator('[data-tool-artifact="a"] iframe').getByRole('button',{name:'0',exact:true}).waitFor();pass((await page.locator('[data-tool-artifact="a"] iframe').getAttribute('src'))?.startsWith(canonical+'/preview/'),`${origin}: builder preview is canonical and loads`);
  if(await page.getByRole('button',{name:'Add to site',exact:true}).count())await page.getByRole('button',{name:'Add to site',exact:true}).click();await page.getByRole('tab',{name:'Pages & navigation',exact:false}).click();pass(await page.locator('.site-page').count()===1,`${origin}: builder toolbox placement and navigation remain usable`);
  await page.getByRole('button',{name:'Private preview',exact:true}).click();await page.getByRole('heading',{name:'Private site preview',exact:true}).waitFor();
  const privateHost=page.frameLocator('.modal iframe');await privateHost.frameLocator('iframe').frameLocator('iframe').locator('#counter').click();await privateHost.frameLocator('iframe').frameLocator('iframe').getByRole('button',{name:'1',exact:true}).waitFor();
  pass((await page.locator('.modal iframe').getAttribute('src'))===canonical+'/site-preview-host',`${origin}: canonical private preview host and nested packaged JS execute`);await page.getByRole('button',{name:'Close dialog',exact:true}).click();
  await page.setViewportSize({width:390,height:844});for(const tab of ['Site details','Artefact toolbox','Pages & navigation']){await page.getByRole('tab',{name:tab,exact:false}).click();pass(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${origin}: mobile ${tab} fits viewport`);}
  await page.screenshot({path:evidence+'/'+(origin===canonical?'canonical':'alias')+'-builder-mobile.png',fullPage:true});
  await page.reload();await page.getByRole('tab',{name:'Site details',exact:true}).waitFor();pass(await page.getByRole('heading',{name:'Project Builder',exact:true}).isVisible(),`${origin}: extension re-login on reload and mobile builder succeed`);
  pass(errors.length===0,`${origin}: no browser runtime errors`);await context.close();
 }
 pass(requests.filter(r=>r.path==='/api/me'&&r.status===200).some(r=>r.origin===canonical)&&requests.filter(r=>r.path==='/api/me'&&r.status===200).some(r=>r.origin===legacy),'Real signed GET /api/me succeeds on both configured browser origins');
 pass(signedUrls.some(u=>u.startsWith(canonical+'/'))&&signedUrls.some(u=>u.startsWith(legacy+'/')),'Browser signer signs exact current-origin URLs for canonical and alias');
 pass(!requests.some(r=>r.path.startsWith('/api/')&&r.status>=400),'No fixture API request failed');
 pass(store.all('job').length===0&&store.all('nstack').length===0,'No pipeline job or managed storage activation');
 await Bun.write(evidence+'/browser.json',JSON.stringify({status:'passed',scope:'Chrome with NIP-07-shaped fixture signer, exact HTTPS browser origins, all traffic intercepted locally; no production reads/writes',canonical,legacy,checks,requests},null,2));
}finally{await browser.close();ADMINS.splice(ADMINS.indexOf(owner),1);store.db.close();}
