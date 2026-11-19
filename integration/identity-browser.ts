/** Actual Chrome processes + IndexedDB, isolated HTTP/SQLite fixture; no live accounts. */
import {chromium,expect,type Page} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateSecretKey,getPublicKey,nip19,nip44,verifyEvent,finalizeEvent} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
const evidence='tmp/docs/handoffs/identity-vault';
if(Bun.spawnSync(['git','check-ignore',evidence]).exitCode!==0||Bun.spawnSync(['git','ls-files',evidence]).stdout.length)throw Error('Evidence must be ignored and untracked');
mkdirSync(evidence,{recursive:true});
const bundle=await Bun.build({entrypoints:['integration/identity-fixture-client.ts'],target:'browser'});if(!bundle.success)throw Error('Fixture bundle failed');const client=await bundle.outputs[0]!.text();
const store=new Store(':memory:');store.put('project',{id:'vault-project',title:'Identity workshop fixture',description:'Isolated browser acceptance',joinCode:'VAULTTEST'});
let app:ReturnType<typeof createApp>;const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>new URL(r.url).pathname==='/__identity-test.js'?new Response(client,{headers:{'Content-Type':'text/javascript'}}):app.fetch(r)});const origin=server.url.origin;app=createApp(store,config({PUBLIC_ORIGIN:origin}));
const checks:string[]=[];const pass=(label:string)=>{checks.push(label);console.log('PASS '+label);};
const root=mkdtempSync(join(tmpdir(),'byof-identity-browser-'));
const launch=(name:string,phone=false)=>chromium.launchPersistentContext(join(root,name),{channel:'chrome',headless:true,viewport:phone?{width:390,height:844}:{width:1440,height:960}});
const fixture=async(page:Page,operation:string,arg?:any):Promise<any>=>page.evaluate(`(async(arg)=>{const m=await import('/__identity-test.js');${operation}})(${JSON.stringify(arg??null)})`);
async function saved(page:Page){return fixture(page,`const v=new m.IdentityVault();return v.initialize();`);}
let context=await launch('return');
try{
 let page=context.pages()[0]!;await page.goto(origin);await page.getByRole('button',{name:'Create anonymous account'}).click();await page.locator('#profile-form').waitFor();
 await page.locator('[name=name]').fill('Returning fixture member');await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.locator('#join-form').waitFor();
 const original=await saved(page);expect(typeof original).toBe('string');
 await page.locator('#join-form input').fill('VAULTTEST');await page.locator('#join-form button').click();await page.getByRole('heading',{name:'Identity workshop fixture',exact:true}).waitFor();
 await page.locator('[data-action=new-design]').first().click();await page.locator('#message-input').waitFor();const designUrl=page.url();const design=store.all('design')[0]!;expect(design.owner).toBe(original);
 // Save a real immutable design through its signed API, without a model or pipeline.
 await fixture(page,`const identity=new m.BrowserIdentity();await identity.initialize();const data=JSON.stringify({title:'Durable fixture design',document:'# Persistent design\\nRemember this exact account.',expectedSnapshotId:null});const bytes=new TextEncoder().encode(data);const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');const url=location.origin+'/api/designs/'+arg;const event=await identity.sign({kind:27235,created_at:Math.floor(Date.now()/1000),tags:[['u',url],['method','PATCH'],['nonce',crypto.randomUUID()],['payload',hash]],content:''});const r=await fetch(url,{method:'PATCH',body:data,headers:{Authorization:'Nostr '+btoa(JSON.stringify(event)),'Content-Type':'application/json'}});if(!r.ok)throw Error(await r.text());`,design.id);
 await page.reload();await page.locator('.title-edit').filter({hasText:'Durable fixture design'}).waitFor();
 const encrypted=await fixture(page,`const db=await new Promise((resolve,reject)=>{const r=indexedDB.open(m.VAULT_DB);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});const value=await new Promise(resolve=>{const r=db.transaction('identity').objectStore('identity').get('browser');r.onsuccess=()=>resolve(r.result)});const v=new m.IdentityVault();const raw=await v.use(k=>Array.from(k,b=>b.toString(16).padStart(2,'0')).join(''));let exportRejected=false;try{await crypto.subtle.exportKey('raw',value.wrappingKey)}catch{exportRejected=true}db.close();return {nonextractable:!value.wrappingKey.extractable,exportRejected,iv:value.iv.length,ciphertext:value.ciphertext.byteLength,rawAbsent:!JSON.stringify([...Object.keys(localStorage).map(k=>[k,localStorage.getItem(k)])]).includes(raw),different:!Array.from(new Uint8Array(value.ciphertext)).join(',').includes(Array.from(raw.match(/../g),s=>parseInt(s,16)).join(','))};`);
 expect(encrypted).toEqual({nonextractable:true,exportRejected:true,iv:12,ciphertext:48,rawAbsent:true,different:true});pass('Persisted nonextractable AES key and authenticated ciphertext; raw secret absent from localStorage');
 await page.screenshot({path:join(evidence,'desktop-before-close.png')});await context.close();
 context=await launch('return');page=context.pages()[0]!;await page.goto(designUrl);await page.locator('#message-input').waitFor();expect(await saved(page)).toBe(original);expect(await page.locator('.account-name').textContent()).toBe('Returning fixture member');expect(store.get('membership','vault-project:'+original)).toBeTruthy();await page.locator('.title-edit').filter({hasText:'Durable fixture design'}).waitFor();pass('Full Chrome process close/reopen restores exact pubkey, profile, membership and saved design on direct route');
 await page.reload();await page.locator('#message-input').waitFor();expect(await saved(page)).toBe(original);pass('Direct design reload preserves identity');
 await context.close();context=await launch('return',true);page=context.pages()[0]!;await page.goto(designUrl);await page.locator('#message-input').waitFor();expect(await saved(page)).toBe(original);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:join(evidence,'phone-after-process-reopen.png')});pass('Phone viewport after second process reopen automatically restores same design/account');
 await page.locator('[data-action=profile]').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Continue with saved browser identity'}).waitFor();await page.reload();await page.getByRole('button',{name:'Continue with saved browser identity'}).waitFor();expect(await page.getByRole('button',{name:'Create anonymous account'}).count()).toBe(0);pass('Explicit signout survives reload and offers continue, never create');
 await page.getByRole('button',{name:'Continue with saved browser identity'}).click();await page.locator('#profile-form').waitFor();expect(await saved(page)).toBe(original);
 await context.close();
 for(const mode of [true,false]){
  context=await launch('legacy-'+mode);page=context.pages()[0]!;await page.goto(origin);const key=generateSecretKey(),pk=getPublicKey(key);
  await page.evaluate(({hex,mode})=>{localStorage.setItem('byo-freedom.identity.v1',hex);if(mode)localStorage.setItem('byo-freedom.signer.v1','anonymous');}, {hex:Buffer.from(key).toString('hex'),mode});
  // Two tabs initialize/migrate concurrently; both must read the original key.
  const second=await context.newPage();await Promise.all([page.reload(),second.goto(origin)]);await Promise.all([page.locator('#join-form').waitFor(),second.locator('#join-form').waitFor()]);
  expect(await saved(page)).toBe(pk);expect(await saved(second)).toBe(pk);expect(await page.evaluate(()=>localStorage.getItem('byo-freedom.identity.v1'))).toBeNull();pass(`Legacy migration (${mode?'with':'without'} signer marker) preserves pubkey under concurrent tabs, verified plaintext removal`);
  const signed=await fixture(page,`const i=new m.BrowserIdentity();await i.initialize();return i.sign({kind:1,created_at:Math.floor(Date.now()/1000),tags:[],content:'Fixture signature'});`);expect(verifyEvent(signed)).toBe(true);expect(signed.pubkey).toBe(pk);
  const peer=generateSecretKey(),ciphertext=nip44.v2.encrypt('NIP44 fixture',nip44.v2.utils.getConversationKey(peer,pk));
  expect(await fixture(page,`const i=new m.BrowserIdentity();await i.initialize();return i.signer().nip44.decrypt(arg.pubkey,arg.ciphertext);`,{pubkey:getPublicKey(peer),ciphertext})).toBe('NIP44 fixture');pass('Migrated signer signs valid same-account events and decrypts NIP44');
  // Export stays within this test process; never logged or written to evidence.
  const exported=await fixture(page,`const i=new m.BrowserIdentity();await i.initialize();return i.exportRecovery();`);expect(exported===nip19.nsecEncode(key)).toBe(true);
  const clean=await context.newPage();await clean.goto(origin);await fixture(clean,`const v=new m.IdentityVault();const original=await v.initialize();try{await v.import(new Uint8Array(32).fill(1));throw Error('replacement allowed')}catch(e){if(!e.message.includes('different identity'))throw e}return original;`);expect(await saved(clean)).toBe(pk);pass('Recovery export exact; importing different key cannot overwrite saved account');
  await context.close();
 }
 context=await launch('race');page=context.pages()[0]!;await page.goto(origin);const second=await context.newPage();await second.goto(origin);const results=await Promise.all([fixture(page,`return new m.IdentityVault().create();`),fixture(second,`return new m.IdentityVault().create();`)]);expect(results[0]).toBe(results[1]);expect(await saved(page)).toBe(results[0]);pass('Concurrent first creation converges on one durable identity');await context.close();
 // Failures must preserve evidence, never create, never call /api/me as a new account.
 for(const failure of ['invalid-legacy','denied','unsupported','missing-key','corrupt','legacy-write-failure','readback-failure','localStorage-denied']){
  context=await launch(failure);page=context.pages()[0]!;let meCalls=0;await page.route('**/api/me',route=>{meCalls++;return route.continue();});await page.goto(origin);
  let expected:string|null=null;
  if(failure==='localStorage-denied')await page.addInitScript(()=>{Storage.prototype.getItem=function(){throw new DOMException('Storage denied','SecurityError')};});
  else if(failure==='readback-failure'){const key=generateSecretKey();expected=Buffer.from(key).toString('hex');await page.evaluate(hex=>localStorage.setItem('byo-freedom.identity.v1',hex!),expected);await page.addInitScript(()=>{SubtleCrypto.prototype.decrypt=async()=>{throw new DOMException('Readback failed','OperationError')};});}
  else if(failure==='invalid-legacy')await page.evaluate(()=>localStorage.setItem('byo-freedom.identity.v1','invalid-retain-me'));
  else if(failure==='denied'||failure==='legacy-write-failure'){
   if(failure==='legacy-write-failure'){const key=generateSecretKey();expected=Buffer.from(key).toString('hex');await page.evaluate(hex=>localStorage.setItem('byo-freedom.identity.v1',hex!),expected);}
   await page.addInitScript(()=>{IDBFactory.prototype.open=function(){throw new DOMException('Fixture denied','SecurityError')};});
  }else if(failure==='unsupported')await page.addInitScript(()=>{Object.defineProperty(globalThis,'crypto',{value:{}})});
  else{
   await fixture(page,`return new m.IdentityVault().create();`);
   await fixture(page,`const db=await new Promise(resolve=>{const r=indexedDB.open(m.VAULT_DB);r.onsuccess=()=>resolve(r.result)});await new Promise((resolve,reject)=>{const tx=db.transaction('identity','readwrite');const s=tx.objectStore('identity');const r=s.get('browser');r.onsuccess=()=>{const v=r.result;if(arg==='missing-key')delete v.wrappingKey;else v.ciphertext=new Uint8Array(48).buffer;s.put(v,'browser');};tx.oncomplete=resolve;tx.onerror=reject});db.close();`,failure);
  }
  await page.reload();await page.locator('[role=alert]').waitFor();expect(await page.getByRole('button',{name:'Create anonymous account'}).count()).toBe(0);expect(meCalls).toBe(0);
  if(failure==='invalid-legacy')expect(await page.evaluate(()=>localStorage.getItem('byo-freedom.identity.v1'))).toBe('invalid-retain-me');
  if(expected)expect(await page.evaluate(()=>localStorage.getItem('byo-freedom.identity.v1'))===expected).toBe(true);
  if(expected){expect(await page.getByRole('button',{name:'Export saved browser recovery key'}).count()).toBe(1);const recovered=await fixture(page,`const i=new m.BrowserIdentity();await i.initialize();return i.exportRecovery();`);expect(recovered===nip19.nsecEncode(Uint8Array.from(expected.match(/../g)!,s=>parseInt(s,16)))).toBe(true);}
 pass(`${failure}: visible recovery, preserved evidence, no replacement authentication`);await context.close();
 }
 context=await launch('late-loss');page=context.pages()[0]!;await page.goto(origin);
 expect(await fixture(page,`const v=new m.IdentityVault();await v.create();const i=new m.BrowserIdentity();await i.initialize();i.signOut();const db=await new Promise(resolve=>{const r=indexedDB.open(m.VAULT_DB);r.onsuccess=()=>resolve(r.result)});await new Promise((resolve,reject)=>{const tx=db.transaction('identity','readwrite');tx.objectStore('identity').delete('browser');tx.oncomplete=resolve;tx.onerror=reject});db.close();try{await i.connectBrowser();return false}catch{}return (await v.initialize())===null;`)).toBe(true);pass('Late durable record loss: Continue refuses to mint replacement');await context.close();
 context=await launch('without-locks');page=context.pages()[0]!;await page.goto(origin);await fixture(page,`return new m.IdentityVault().create();`);const before=await saved(page);await page.addInitScript(()=>Object.defineProperty(navigator,'locks',{value:undefined}));await page.reload();await page.locator('#join-form').waitFor();expect(await saved(page)).toBe(before);pass('Existing encrypted identity restores without Web Locks; unsupported writes stay guarded');await context.close();
 for(const extensionState of ['delayed','locked']){
  context=await launch(extensionState);page=context.pages()[0]!;const key=generateSecretKey();await page.exposeFunction('fixturePubkey',()=>getPublicKey(key));await page.exposeFunction('fixtureSign',(event:any)=>finalizeEvent(event,key));
  await page.addInitScript(state=>{localStorage.setItem('byo-freedom.signer.v1','extension');const inject=()=>{window.nostr={getPublicKey:()=>(window as any).fixturePubkey(),signEvent:event=>state==='locked'?Promise.reject(Error('Fixture signer locked')):(window as any).fixtureSign(event)}};if(state==='delayed')setTimeout(inject,300);else inject();},extensionState);
  const profile=finalizeEvent({kind:0,created_at:Math.floor(Date.now()/1000),tags:[],content:JSON.stringify({name:'Extension fixture'})},key);await page.route('**/api/profile/nostr',route=>route.fulfill({json:{profile:{event:profile}}}));await page.goto(origin);
  if(extensionState==='delayed')await page.locator('#join-form').waitFor();else await page.getByText('Fixture signer locked',{exact:true}).waitFor();expect(await saved(page)).toBeNull();expect(await page.getByRole('button',{name:'Create anonymous account'}).count()).toBe(0);pass(extensionState+' extension never creates replacement browser identity');await context.close();
 }
 context=await launch('extension');page=context.pages()[0]!;await page.goto(origin);await page.evaluate(()=>localStorage.setItem('byo-freedom.signer.v1','extension'));await page.reload();await page.getByText('Your Nostr signer is unavailable.',{exact:false}).waitFor();expect(await page.getByRole('button',{name:'Create anonymous account'}).count()).toBe(0);expect(await saved(page)).toBeNull();pass('Absent extension keeps signer choice and creates no browser identity');await context.close();
 // Exercise the reusable hosted UI runner locally, never against a deployed account.
 const runner=Bun.spawn(['bun','integration/identity-hosted-browser.ts'],{env:{...process.env,BYO_IDENTITY_ORIGIN:origin,BYO_IDENTITY_JOIN_CODE:'VAULTTEST'},stdout:'pipe',stderr:'pipe'});
 const [runnerOutput,runnerError,runnerExit]=await Promise.all([new Response(runner.stdout).text(),new Response(runner.stderr).text(),runner.exited]);if(runnerExit!==0)throw Error('Hosted runner fixture check failed: '+runnerError);console.log(runnerOutput.trim());pass('Reusable hosted acceptance runner validated against isolated local fixture only');
 await Bun.write(join(evidence,'results.json'),JSON.stringify({scope:'Local actual persistent Chrome processes and isolated in-process Bun HTTP/SQLite; no live changes. Desktop/phone viewports are Chrome emulation, not physical phone.',checks},null,2));
}finally{await context.close().catch(()=>{});server.stop();store.db.close();rmSync(root,{recursive:true,force:true});}
