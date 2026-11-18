import {afterEach,beforeEach,expect,test} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey,nip19} from 'nostr-tools';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {ADMINS,hash} from '../src/auth';
import {config} from '../src/config';

const origin='https://workshop.example';
let dir:string,store:Store,app:ReturnType<typeof createApp>,admin:Uint8Array,user:Uint8Array;
const connection=()=>({endpoint:'https://nstack.example',serviceNpub:nip19.npubEncode(getPublicKey(generateSecretKey())),workspaceOwnerNpub:nip19.npubEncode(getPublicKey(generateSecretKey())),appNpub:nip19.npubEncode(getPublicKey(generateSecretKey()))});
function request(key:Uint8Array,path:string,method='GET',value?:any){const body=value===undefined?undefined:JSON.stringify(value);const e=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(body===undefined?[]:[['payload',hash(body)]])]},key);return new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(e)).toString('base64'),...(body===undefined?{}:{'content-type':'application/json'})},body});}
async function call(key:Uint8Array,path:string,method='GET',value?:any){const r=await app.fetch(request(key,path,method,value));return {status:r.status,body:await r.json() as any};}
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'byo-nstack-auth-'));store=new Store(join(dir,'app.sqlite'));admin=generateSecretKey();user=generateSecretKey();ADMINS.push(getPublicKey(admin));app=createApp(store,config({PUBLIC_ORIGIN:origin}));store.put('project',{id:'preserved-project',title:'Existing production record',joinCode:'unchanged'});});
afterEach(()=>{ADMINS.splice(ADMINS.indexOf(getPublicKey(admin)),1);store.db.close();rmSync(dir,{recursive:true,force:true});});

test('NStack settings require real signed admin and retain core records',async()=>{
 expect((await app.fetch(new Request(origin+'/api/nstack'))).status).toBe(401);
 expect((await call(user,'/api/nstack')).status).toBe(403);
 expect((await call(user,'/api/nstack','PUT',{expectedRevision:0,connection:connection(),admin:true})).status).toBe(403);
 expect(store.get('nstack','global')).toBeUndefined();
 const signed=request(admin,'/api/nstack','PUT',{expectedRevision:0,connection:connection()});const replay=signed.clone();
 expect((await app.fetch(signed)).status).toBe(200);expect((await app.fetch(replay)).status).toBe(409);
 const state=(await call(admin,'/api/nstack')).body;expect(state.state).toBe('untested');expect(state.capabilities.json).toBe(false);expect(state.coreStorage).toBe('existing-sqlite-preserved');
 expect(store.get('project','preserved-project')).toEqual({id:'preserved-project',title:'Existing production record',joinCode:'unchanged'});
 expect((await call(admin,'/api/nstack','PUT',{expectedRevision:0,connection:connection()})).status).toBe(409);
});

test('uninstalled or unready exact artefacts cannot masquerade as NStack storage',async()=>{
 await call(admin,'/api/nstack','PUT',{expectedRevision:0,connection:connection()});
 store.put('artifact',{id:'own-app',projectId:'preserved-project',designId:'design'});
 store.put('artifact',{id:'foreign-app',projectId:'other-project',designId:'other-design'});
 store.put('version',{id:'own-version',artifactId:'own-app',designId:'design',files:{'index.html':'<h1>One</h1>'}});
 store.put('version',{id:'foreign-version',artifactId:'foreign-app',designId:'other-design',files:{'index.html':'<h1>Other</h1>'}});
 const manifest={version:1,collections:[{name:'items',policy:'private',maxRecords:10,maxBytes:1024}]};
 expect((await call(user,'/api/artifacts/own-app/data-installations','PUT',{versionId:'own-version',expectedRevision:0,enabled:true,manifest})).status).toBe(403);
 expect((await call(admin,'/api/artifacts/own-app/data-installations','PUT',{versionId:'foreign-version',expectedRevision:0,enabled:true,manifest})).status).toBe(400);
 expect((await call(admin,'/api/installed-apps/foreign-version/data','POST',{operation:'list',collection:'items',scope:'live'})).status).toBe(403);
 expect((await call(admin,'/api/artifacts/own-app/data-installations','PUT',{versionId:'own-version',expectedRevision:0,enabled:true,manifest})).status).toBe(200);
 const attempt=await call(admin,'/api/installed-apps/own-version/data','POST',{operation:'put',collection:'items',scope:'live',id:'item',expectedRevision:0,value:{saved:true}});
 expect(attempt.status).toBe(503);expect(attempt.body.error).toBe('Chosen NStack is not ready');
 const publicAttempt=await app.fetch(new Request(origin+'/app-data/own-version?operation=list&collection=items'));expect(publicAttempt.status).toBe(503);
});
