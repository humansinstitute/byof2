import {test,expect} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey,verifyEvent} from 'nostr-tools';
import {BYO_APP_NPUB,runBrowserOperation,validateBrowserChallenge} from '../public/nstack-browser';
const connection={endpoint:'https://stack.example',workspaceId:'11111111-1111-4111-8111-111111111111',appNpub:BYO_APP_NPUB};
const base=`${connection.endpoint}/api/v4/flightdeck-pg/workspaces/${connection.workspaceId}/apps/${BYO_APP_NPUB}`;
const challenge={id:'first',url:base+'/registration',method:'POST',body:JSON.stringify({app_name:'BYO Freedom',capabilities:['app_rows.private_only']})};
const signer=()=>{const key=generateSecretKey();return {getPublicKey:async()=>getPublicKey(key),signEvent:async(template:any)=>finalizeEvent(template,key)};};
test('browser authorizes exact private registration and rows only inside selected workspace',()=>{
 expect(validateBrowserChallenge(connection,challenge)).toBe(challenge);
 expect(validateBrowserChallenge(connection,{id:'read',url:base+'/db/byo_schema/rows?limit=1&visibility=private',method:'GET'}).id).toBe('read');
 for(const altered of [
  {...challenge,url:challenge.url.replace('stack.example','other.example')},
  {...challenge,url:challenge.url.replace(connection.workspaceId,'22222222-2222-4222-8222-222222222222')},
  {...challenge,url:challenge.url+'?unexpected=1'},
  {...challenge,method:'DELETE'},
  {...challenge,body:JSON.stringify({app_name:'BYO Freedom',capabilities:['arbitrary.signer']})},
  {...challenge,url:connection.endpoint+'/api/v4/workspaces/owner/apps'},
  {...challenge,url:base+'/db/byo_schema/rows',body:JSON.stringify({row_id:'one',visibility:'workspace',data:{}})},
  {...challenge,method:'GET',body:undefined,url:base+'/db/byo_schema/rows?visibility=workspace'},
  {...challenge,url:base+'/db/byo_schema/rows/existing',body:JSON.stringify({row_id:'one',visibility:'private',data:{}})},
 ])expect(()=>validateBrowserChallenge(connection,altered)).toThrow();
});
test('browser challenge loop hashes exact bytes and signs fresh exact user events',async()=>{
 const user=signer(),events:any[]=[];
 let step=0;
 const api=async(path:string,method?:string,body?:any)=>{
  expect(method).toBe('POST');
  if(step++===0){expect(path).toBe('/api/nstack/connect');return {operationId:'op',connection,challenge};}
  expect(path).toBe('/api/nstack/authorize');expect(body.operationId).toBe('op');events.push(body.event);expect(verifyEvent(body.event)).toBe(true);
  if(events.length===1){expect(body.challengeId).toBe('first');expect(body.event.tags).toEqual([['u',challenge.url],['method','POST'],['byo-challenge','first'],['payload',new Bun.CryptoHasher('sha256').update(challenge.body).digest('hex')]]);return {operationId:'op',connection,challenge:{id:'second',url:base+'/registration',method:'GET'}};}
  expect(body.event.tags).toEqual([['u',base+'/registration'],['method','GET'],['byo-challenge','second']]);return {done:true,result:{state:'saved'}};
 };
 expect(await runBrowserOperation(api,user,'/api/nstack/connect',{connection})).toEqual({state:'saved'});expect(events[0].id).not.toBe(events[1].id);expect(events.every(e=>e.pubkey===events[0].pubkey)).toBe(true);
});
test('changed actor, changed connection and forged signer replies cannot be submitted',async()=>{
 const user=signer();let calls=0;
 const api=async()=>{calls++;return {operationId:'op',connection,challenge};};
 const bad={...user,signEvent:async(t:any)=>user.signEvent({...t,content:'tampered'})};
 await expect(runBrowserOperation(api,bad,'/api/nstack/connect',{connection})).rejects.toThrow('different or invalid');expect(calls).toBe(1);
 const cached={...user,signEvent:async(t:any)=>{const signed=await user.signEvent(t);signed.sig='00'.repeat(64);return signed;}};
 await expect(runBrowserOperation(api,cached,'/api/nstack/connect',{connection})).rejects.toThrow('different or invalid');
 let count=0;const changed={...user,getPublicKey:async()=>++count===1?await user.getPublicKey():'00'.repeat(32)};
 await expect(runBrowserOperation(api,changed,'/api/nstack/connect',{connection})).rejects.toThrow('signer changed');
 let turn=0;const shifted=async()=>turn++===0?{operationId:'op',connection,challenge}:{operationId:'op',connection:{...connection,workspaceId:'22222222-2222-4222-8222-222222222222'},challenge};
 await expect(runBrowserOperation(shifted,user,'/api/nstack/connect',{connection})).rejects.toThrow('connection changed');
 await expect(runBrowserOperation(api,user,'/api/arbitrary/sign',{})).rejects.toThrow('Unsupported');
});
test('browser preserves ordinary managed mode results and propagates visible denied/retry errors',async()=>{
 expect(await runBrowserOperation(async()=>({rows:[]}),signer(),'/api/installed-apps/version-1/data',{})).toEqual({rows:[]});
 await expect(runBrowserOperation(async()=>{throw new Error('Membership denied; retry after access is granted')},signer(),'/api/nstack/connect',{connection})).rejects.toThrow('Membership denied');
});
test('discovery signing permits bounded fresh list and exact workspace membership only',()=>{
 const discovery={endpoint:connection.endpoint,mode:'discovery'};
 expect(validateBrowserChallenge(discovery,{id:'list',method:'GET',url:connection.endpoint+'/api/v4/flightdeck-pg/workspaces?limit=200'}).id).toBe('list');
 expect(validateBrowserChallenge({...discovery,workspaceId:connection.workspaceId},{id:'me',method:'GET',url:connection.endpoint+`/api/v4/flightdeck-pg/workspaces/${connection.workspaceId}/me`}).id).toBe('me');
 for(const url of [connection.endpoint+'/api/v4/flightdeck-pg/workspaces?limit=9999',connection.endpoint+'/api/v4/flightdeck-pg/workspaces?limit=200&owner=foreign',base+'/registration',connection.endpoint+`/api/v4/flightdeck-pg/workspaces/${connection.workspaceId}/me`])expect(()=>validateBrowserChallenge(discovery,{id:'bad',method:'GET',url})).toThrow();
});
test('bounded broker nonce and session binding may accompany the exact requested authorization',async()=>{
 const key=generateSecretKey(),user={getPublicKey:async()=>getPublicKey(key),signEvent:async(t:any)=>finalizeEvent({...t,created_at:t.created_at+1,tags:[...t.tags.slice().reverse(),['nonce','broker-nonce'],['wm-session-capability','cap','session','mac']]},key)};
 let started=false;
 const api=async()=>{if(!started){started=true;return {operationId:'op',connection,challenge};}return {done:true,result:'saved'};};
 expect(await runBrowserOperation(api,user,'/api/nstack/connect',{connection})).toBe('saved');
 for(const extras of [[['nonce','one'],['nonce','two']],[['arbitrary','sign']],[['wm-session-capability','badshape']]]){
  const bad={...user,signEvent:async(t:any)=>finalizeEvent({...t,tags:[...t.tags,...extras]},key)};started=false;
  await expect(runBrowserOperation(api,bad,'/api/nstack/connect',{connection})).rejects.toThrow('different or invalid');
 }
 const stale={...user,signEvent:async(t:any)=>finalizeEvent({...t,created_at:t.created_at-61},key)};started=false;
 await expect(runBrowserOperation(api,stale,'/api/nstack/connect',{connection})).rejects.toThrow('different or invalid');
});
test('first setup and discovery replies cannot replace the requested authority',async()=>{
 const user=signer();
 await expect(runBrowserOperation(async()=>({operationId:'op',connection:{...connection,workspaceId:'22222222-2222-4222-8222-222222222222'},challenge}),user,'/api/nstack/connect',{connection})).rejects.toThrow('selected connection');
 const discovery={endpoint:connection.endpoint,mode:'discovery'};
 const request={endpoint:connection.endpoint,path:'/api/v4/flightdeck-pg/workspaces?limit=200'};
 await expect(runBrowserOperation(async()=>({operationId:'op',connection:discovery,challenge:{id:'discovery',method:'GET',url:connection.endpoint+'/api/v4/flightdeck-pg/workspaces?limit=1'}}),user,'/api/nstack/discovery-request',request)).rejects.toThrow('requested endpoint or path');
});
test('timeout bounds a never resolving signer without starting any request',async()=>{
 let requests=0;
 await expect(runBrowserOperation(async()=>{requests++;},{getPublicKey:()=>new Promise(()=>{}),signEvent:()=>new Promise(()=>{})},'/api/nstack/connect',{connection},{timeoutMs:10})).rejects.toThrow('Outcome unknown');
 expect(requests).toBe(0);
});
test('cancelled exact signature cannot advance to authorize even after a new attempt',async()=>{
 const user=signer(),controller=new AbortController();let release:()=>void=()=>{},requests=0;
 const slow={...user,signEvent:async(t:any)=>{await new Promise<void>(r=>release=r);return user.signEvent(t);}};
 const pending=runBrowserOperation(async()=>{requests++;return {operationId:'op',connection,challenge};},slow,'/api/nstack/connect',{connection},{signal:controller.signal});
 await Bun.sleep(10);controller.abort();await expect(pending).rejects.toThrow('Outcome unknown');
 expect(await runBrowserOperation(async()=>({done:true,result:'fresh'}),user,'/api/nstack/connect',{connection})).toBe('fresh');
 release();await Bun.sleep(10);expect(requests).toBe(1);
});
test('committed operation with missing response is unknown and is never replayed',async()=>{
 let committed=0;
 await expect(runBrowserOperation(async()=>{committed++;return new Promise(()=>{});},signer(),'/api/nstack/connect',{connection},{timeoutMs:10})).rejects.toThrow('Outcome unknown');
 expect(committed).toBe(1);
});
