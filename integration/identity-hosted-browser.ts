/** Opt-in activation check: writes only a NEW fixture account in an explicitly owned project.
 * BYO_IDENTITY_ORIGIN=https://... BYO_IDENTITY_JOIN_CODE=<owned isolated fixture code>
 * bun integration/identity-hosted-browser.ts
 * Run separately for each deployed origin. Never supplies a personal Chrome profile.
 */
import {chromium,expect} from '@playwright/test';
import {mkdtempSync,rmSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const origin=process.env.BYO_IDENTITY_ORIGIN,code=process.env.BYO_IDENTITY_JOIN_CODE;
if(!origin||new URL(origin).origin!==origin||!code)throw Error('Supply an exact BYO_IDENTITY_ORIGIN and authorized isolated project BYO_IDENTITY_JOIN_CODE.');
const evidence='tmp/docs/handoffs/identity-hosted';
if(Bun.spawnSync(['git','check-ignore',evidence]).exitCode!==0||Bun.spawnSync(['git','ls-files',evidence]).stdout.length)throw Error('Evidence must be ignored/untracked');
mkdirSync(evidence,{recursive:true});const directory=mkdtempSync(join(tmpdir(),'byof-hosted-identity-'));
const name='Identity acceptance '+crypto.randomUUID().slice(0,8),title=name+' design';
const launch=(phone=false)=>chromium.launchPersistentContext(directory,{channel:'chrome',headless:true,viewport:phone?{width:390,height:844}:{width:1440,height:960}});
let context=await launch();let exactPubkey='';let designUrl='';
// Capture only public identity and design data. Do not capture auth headers/recovery exports.
const observe=(page:any)=>{page.on('response',async(response:any)=>{if(new URL(response.url()).pathname==='/api/me'&&response.ok()){const account=await response.json();if(exactPubkey)expect(account.pubkey).toBe(exactPubkey);else exactPubkey=account.pubkey;}});};
try{
 let page=context.pages()[0]!;observe(page);await page.goto(origin);await page.getByRole('button',{name:'Create anonymous account'}).click();await page.locator('#profile-form').waitFor();await page.locator('[name=name]').fill(name);await page.getByRole('button',{name:'Save profile',exact:true}).click();await page.locator('#join-form').waitFor();
 await page.locator('#join-form input').fill(code);await page.locator('#join-form button').click();await page.locator('[data-action=new-design]').first().click();await page.locator('#message-input').waitFor();
 await page.locator('[data-action=rename]').click();await page.getByLabel('Design title',{exact:true}).fill(title);await page.getByRole('button',{name:'Save title',exact:true}).click();await expect(page.locator('.title-edit')).toContainText(title);designUrl=page.url();expect(exactPubkey).toMatch(/^[a-f0-9]{64}$/);
 await page.screenshot({path:join(evidence,new URL(origin).hostname+'-created.png')});await context.close();
 for(const phone of [false,true]){
  context=await launch(phone);page=context.pages()[0]!;observe(page);await page.goto(designUrl);await page.locator('#message-input').waitFor();await expect(page.locator('.title-edit')).toContainText(title);await expect(page.locator('.account-name')).toHaveText(name);
  await page.reload();await page.locator('#message-input').waitFor();await expect(page.locator('.title-edit')).toContainText(title);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.screenshot({path:join(evidence,new URL(origin).hostname+(phone?'-phone':'-desktop')+'-restored.png')});await context.close();
 }
 await Bun.write(join(evidence,new URL(origin).hostname+'.json'),JSON.stringify({origin,scope:'Hosted NEW fixture account, authorized isolated project; real Chrome process close/reopen twice, same userDataDir, phone viewport emulation',pubkey:exactPubkey,designUrl,profile:name,checks:['UI creation, profile, join and saved immutable design','Desktop process reopen/direct route/reload preserves account/profile/design/access','Phone viewport process reopen/direct route/reload preserves account/profile/design/access'],cleanup:'Temporary local Chrome profile removed; server fixture account/design retained for manager review.'},null,2));
 console.log('PASS hosted same-origin identity process-restart acceptance: '+origin);
}finally{await context.close().catch(()=>{});rmSync(directory,{recursive:true,force:true});}
