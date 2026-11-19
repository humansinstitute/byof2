// Isolated interaction acceptance for secondary controls, recovery and profile fallback.
import {chromium,expect} from '@playwright/test';
import {generateSecretKey,getPublicKey} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {ADMINS} from '../src/auth';
import {mkdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
const evidence='tmp/docs/handoffs/ui-cleanup';
execFileSync('git',['check-ignore',evidence+'/acceptance.json']);
if(execFileSync('git',['ls-files',evidence]).length)throw Error('Evidence must be untracked');
await mkdir(evidence,{recursive:true});
const store=new Store(':memory:'),adminKey=generateSecretKey(),memberKey=generateSecretKey();
const admin=getPublicKey(adminKey),member=getPublicKey(memberKey);ADMINS.push(admin);
store.put('project',{id:'cleanup',title:'Cleanup workshop',joinCode:'CLEANUP'});
store.put('membership',{id:'cleanup:'+member,projectId:'cleanup',pubkey:member});
for(const [owner,id] of [[member,'member-design'],[admin,'admin-design']]){
 store.put('profile',{id:owner,name:owner===admin?'Organiser':'Participant',avatar:''});
 store.put('design',{id,owner,projectId:'cleanup',title:'A useful counter',currentSnapshotId:id+'-snapshot'});
 store.put('snapshot',{id:id+'-snapshot',designId:id,title:'A useful counter',document:'# Counter\nA useful accessible counter.',createdAt:new Date().toISOString()});
 store.put('conversation',{id,designId:id,kind:'interview',owner});
}
store.put('artifact',{id:'counter',designId:'admin-design',projectId:'cleanup',title:'Fixture counter',publishedVersionId:null});
store.put('version',{id:'counter-v1',artifactId:'counter',designId:'admin-design',number:1,snapshotId:'admin-design-snapshot',validation:['Isolated browser fixture'],files:{'index.html':'<!doctype html><button id="count">0</button><script>count.onclick=()=>count.textContent=Number(count.textContent)+1</script>'}});
let app:ReturnType<typeof createApp>;
const server=Bun.serve({hostname:'127.0.0.1',port:0,fetch:r=>app.fetch(r)}),origin=server.url.origin;
app=createApp(store,config({PUBLIC_ORIGIN:origin,INTERVIEW_PIPELINE_CONFIG:'isolated-fixture-no-dispatch'}));
const browser=await chromium.launch({channel:'chrome',headless:true}),checks:string[]=[],errors:string[]=[];
function pass(ok:any,label:string){if(!ok)throw Error(label);checks.push(label);console.log('PASS',label)}
try{
 for(const width of [1440,390]){
  const guest=await browser.newContext({viewport:{width,height:900}}),entry=await guest.newPage();entry.on('pageerror',e=>errors.push(e.message));
  await entry.goto(origin);await entry.getByRole('button',{name:'Create account',exact:true}).waitFor();
  pass(await entry.getByRole('button',{name:'Log in with Nostr extension'}).count()===1,`${width}: Nostr auth remains available`);
  pass((await entry.locator('body').innerText()).includes('recovery key'),`${width}: signed-out entry retains recovery explanation`);
  await entry.getByRole('button',{name:'Restore a recovery key',exact:true}).click();await entry.getByLabel('Recovery key',{exact:true}).fill('invalid');await entry.getByRole('button',{name:'Restore account'}).click();await expect(entry.locator('.modal .error-box')).toBeVisible();
  pass(await entry.getByRole('dialog').isVisible(),`${width}: invalid recovery stays in durable actionable dialog`);await entry.getByRole('button',{name:'Close dialog'}).press('Escape');
  await entry.screenshot({path:`${evidence}/entry-${width}.png`});await guest.close();
  for(const [role,key] of [['participant',memberKey],['admin',adminKey]] as const){
   const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
   await page.addInitScript(secret=>{if(window===top){localStorage.setItem('byo-freedom.identity.v1',secret);localStorage.setItem('byo-freedom.signer.v1','anonymous');}},Buffer.from(key).toString('hex'));
   await page.goto(origin+'/#/projects');await page.getByRole('heading',{name:'My Projects',exact:true}).waitFor();
   pass(await page.getByLabel('Project code',{exact:true}).count()===1,`${width}/${role}: join field has associated accessible label`);
   if(role==='admin'){
    const more=page.locator('details.admin-more').first(),summary=more.locator('summary');await summary.focus();await summary.press('Enter');await expect(more).toHaveAttribute('open','');
    await summary.press('Escape');pass(!(await more.evaluate(el=>(el as HTMLDetailsElement).open))&&await summary.evaluate(el=>el===document.activeElement),`${width}: More Escape closes and restores focus`);
    await summary.click();await page.getByRole('heading',{name:'My Projects',exact:true}).click();pass(!(await more.evaluate(el=>(el as HTMLDetailsElement).open)),`${width}: outside click dismisses More`);
    await summary.click();await more.locator('[data-action="nstack-settings"]').click();await page.getByRole('dialog').waitFor();await page.locator('#nstack-origin').waitFor();pass(await page.locator('#nstack-origin').isVisible(),`${width}: data connection remains discoverable and usable`);await page.getByRole('button',{name:'Close dialog'}).click();
    pass(await summary.evaluate(el=>el===document.activeElement),`${width}: secondary action dialog returns focus to More summary`);
   }else pass(await page.locator('details.admin-more').count()===0,`${width}: participant has no admin More controls`);
   await page.locator('[data-project="cleanup"]').click();await page.getByRole('heading',{name:'Cleanup workshop',exact:true}).waitFor();
   await expect(page.locator('.project-heading .intro')).toHaveText('Bring a question, a tool you wish existed, or a trick worth sharing.');pass(true,`${width}/${role}: requested project introduction remains`);
   await page.screenshot({path:`${evidence}/${role}-project-${width}.png`});
   if(role==='admin'){
    await page.locator('.admin-more summary').click();
    await page.evaluate(()=>{const original=HTMLCanvasElement.prototype.getContext;(window as any).restoreFixtureCanvas=()=>HTMLCanvasElement.prototype.getContext=original;HTMLCanvasElement.prototype.getContext=(()=>{throw Error('Fixture QR rendering interrupted')}) as any;});
    await page.getByRole('button',{name:'Share',exact:true}).click();const error=page.locator('.modal form .action-error');await expect(error).toBeVisible();
    pass(await error.evaluate(el=>el===document.activeElement),`${width}: action error inside open dialog receives focus`);
    const box=await error.boundingBox();pass(!!box&&box.y>=0&&box.y+box.height<=900,`${width}: modal action error is visible inside viewport`);
    await error.getByRole('button',{name:'Dismiss'}).click();pass(await page.getByRole('button',{name:'Close dialog'}).evaluate(el=>el===document.activeElement),`${width}: dismissing modal action error restores useful focus`);
    await page.evaluate(()=>(window as any).restoreFixtureCanvas());await page.getByRole('button',{name:'Close dialog'}).click();
   }

   await page.getByRole('button',{name:'Open your profile'}).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
   await page.route('https://blossom.primal.net/**',r=>r.abort());
   await page.locator('#avatar-file').setInputFiles({name:'avatar.png',mimeType:'image/png',buffer:Buffer.from([137,80,78,71])});await expect(page.locator('#upload-status')).toContainText('Couldn’t upload');
   await expect(page.getByLabel('Avatar URL',{exact:true})).toBeVisible();await page.getByLabel('Avatar URL',{exact:true}).fill('not-a-url');await page.locator('#avatar-link summary').click();await page.getByRole('button',{name:'Save profile'}).click();await expect(page.getByLabel('Avatar URL',{exact:true})).toBeVisible();pass(await page.getByLabel('Avatar URL',{exact:true}).evaluate(el=>el===document.activeElement),`${width}/${role}: invalid hidden avatar link opens its disclosure and receives native validation focus`);await page.getByLabel('Avatar URL',{exact:true}).fill('https://example.org/avatar.png');
   await page.getByRole('button',{name:'Save profile'}).click();await page.getByRole('heading',{name:'My Projects',exact:true}).waitFor();
   pass(store.get('profile',role==='admin'?admin:member)!.avatar==='https://example.org/avatar.png',`${width}/${role}: failed upload reveals usable image-link fallback and profile save works`);
   await page.getByRole('button',{name:'Open your profile'}).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();
   pass((await page.locator('body').innerText()).includes('recovery key'),`${width}/${role}: recovery guidance remains beside account controls`);
   await page.getByRole('button',{name:'Export recovery key',exact:true}).click();await page.getByRole('dialog',{name:'Save your recovery key'}).waitFor();pass((await page.locator('.modal').innerText()).includes('Anyone with this key can act as you'),`${width}/${role}: export keeps key-authority warning`);
   // Never screenshot exported private key. Close first.
   await page.getByRole('button',{name:'Close dialog'}).click();await page.screenshot({path:`${evidence}/${role}-profile-${width}.png`});
   await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('heading',{name:'Your profile',exact:true}).waitFor();await page.getByRole('link',{name:'My Projects',exact:true}).click();await page.getByRole('heading',{name:'My Projects',exact:true}).waitFor();
   pass(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}/${role}: account/project flow fits viewport`);
   if(role==='participant'){
    const jobId='recovery-'+width,messageId=jobId+'-message';
    store.put('message',{id:messageId,conversationId:'member-design',role:'user',content:'Keep my saved request'});
    store.put('job',{id:jobId,kind:'interview',owner:member,projectId:'cleanup',designId:'member-design',conversationId:'member-design',messageId,status:'failed',error:'Fixture interruption',expectedSnapshotId:'member-design-snapshot',context:{attachments:[]}});
    await page.route('**/api/projects/cleanup',r=>r.fulfill({status:503,json:{error:'Fixture title lookup failed'}}));await page.goto(origin+'/#/designs/member-design');await page.locator('#message-input').waitFor();pass(await page.getByRole('navigation',{name:'Breadcrumb'}).getByRole('link',{name:'Project',exact:true}).isVisible(),`${width}: failed secondary title lookup preserves working conversation with fallback breadcrumb`);await page.unroute('**/api/projects/cleanup');await page.getByRole('button',{name:'Retry',exact:true}).click();
    await expect.poll(()=>store.get('job',jobId)?.status).toBe('queued');await expect(page.locator('#build-readiness')).toContainText('current conversation');pass(await page.getByRole('button',{name:'Build this now',exact:true}).getAttribute('aria-describedby')==='build-readiness',`${width}: busy build has a visible accessible reason`);
    pass(store.get('job',jobId)!.messageId===messageId,`${width}: Retry preserves original saved message and job`);
    store.put('job',{...store.get('job',jobId)!,status:'uncertain',progress:'Waiting for delivery'});await page.reload();
    await page.getByRole('button',{name:'Check for reply',exact:true}).click();await expect.poll(()=>store.get('job',jobId)?.recoveryRequestedAt||0).toBeGreaterThan(0);
    pass(!(await page.locator('.progress').innerText()).includes('(uncertain)'),`${width}: Check for reply works without raw status enum`);
    store.put('job',{...store.get('job',jobId)!,status:'conflict',error:'Newer saved design exists'});await page.reload();
    await page.getByRole('button',{name:'Update to latest design',exact:true}).click();await expect.poll(()=>store.get('job',jobId)?.status).toBe('superseded');
    const next=store.all('job').find(j=>j.parentJobId===jobId)!;pass(!!next&&store.get('message',next.messageId)!.content==='Keep my saved request',`${width}: conflict recovery keeps lineage and reuses saved request`);
    store.put('job',{...next,status:'complete'});await page.screenshot({path:`${evidence}/recovery-${width}.png`});
   }else{
    await page.goto(origin+'/#/designs/admin-design');await page.locator('#message-input').waitFor();if(width===390)await page.getByRole('tab',{name:'Preview',exact:true}).click();await expect(page.locator('#build-readiness')).toContainText('not connected');await page.getByRole('button',{name:'Edit design',exact:true}).click();await expect(page.locator('#build-readiness')).toContainText('Save or cancel');pass(await page.getByRole('button',{name:'Build this now',exact:true}).isDisabled(),`${width}: editing has an explicit build blocker`);await page.getByRole('button',{name:'Cancel',exact:true}).click();await page.locator('.workspace-heading .admin-more summary').click();await page.getByRole('button',{name:'Brand exceptions',exact:true}).click();
    await page.getByRole('textbox',{name:'Explicit exceptions',exact:true}).fill('Use a readable counter label.');await page.getByRole('button',{name:'Save exceptions',exact:true}).click();
    await expect.poll(()=>store.get('designBrand','admin-design')?.exceptions).toBe('Use a readable counter label.');pass(true,`${width}: admin More opens and saves brand exceptions`);
    if(width===390)await page.getByRole('tab',{name:'Preview',exact:true}).click();
    await page.locator('[data-version-select="counter-v1"]').click();await page.getByRole('button',{name:'Open saved app',exact:true}).waitFor();
    pass(await page.getByRole('link',{name:'Test preview',exact:false}).count()===1,`${width}: live saved app and test preview remain separate actions`);
    await page.locator('.workspace-heading .admin-more summary').click();await page.getByRole('button',{name:'Data permissions',exact:true}).click();
    await expect(page.getByRole('textbox',{name:'Collection manifest',exact:true})).toBeVisible();await page.getByRole('button',{name:'Close dialog'}).click();pass(true,`${width}: exact-version data permissions remain discoverable`);
    await page.getByRole('button',{name:'Open saved app',exact:true}).click();await page.getByRole('dialog',{name:'Saved app data',exact:true}).waitFor();
    pass((await page.locator('.modal').innerText()).includes('Test previews use separate data.'),`${width}: saved-app dialog explains test-data separation`);
    await page.getByRole('button',{name:'Close dialog'}).click();
   }
   await page.goto(origin+'/#/projects/missing-fixture');await page.getByRole('heading',{name:'We couldn’t open this page.',exact:true}).waitFor();
   await page.getByText('Error details',{exact:true}).click();pass(await page.locator('.standalone-error details p').isVisible(),`${width}/${role}: page failure keeps durable helpful message and optional diagnostics`);
   await page.screenshot({path:`${evidence}/${role}-error-${width}.png`});
   await context.close();
  }
 }
 pass(errors.length===0,'No browser runtime errors');
 await Bun.write(evidence+'/acceptance.json',JSON.stringify({status:'passed',scope:'Isolated in-memory SQLite and Chrome; no live writes/model execution',checks,errors},null,2));
}finally{await browser.close();await server.stop(true);store.db.close();ADMINS.splice(ADMINS.indexOf(admin),1);}
