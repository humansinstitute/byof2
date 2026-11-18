import {verifyEvent} from 'nostr-tools';
import type {BrowserSigner} from './nstack-discovery';

/** A public namespace label, never a service principal or signing identity. */
export const BYO_APP_NPUB='npub1uzczf3p5c9j36hqlyqj5gzl47th3kp4yqz03y5tswkd0y7ucemhs7rf22j';
type Api=(path:string,method?:string,body?:any,options?:{signal?:AbortSignal})=>Promise<any>;
export type BrowserConnection={endpoint:string;workspaceId?:string;appNpub?:string;mode?:string};
export type BrowserChallenge={id:string;url:string;method:string;body?:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const requireValue=(ok:unknown,message:string)=>{if(!ok)throw new Error(message);};
const sha256=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
function sameAuthorizationTags(actual:unknown,expected:string[][]){
 if(!Array.isArray(actual)||actual.length>expected.length+2)return false;
 const core=actual.filter(t=>!['nonce','wm-session-capability'].includes(t?.[0]));
 if(core.length!==expected.length||expected.some(tag=>core.filter(t=>JSON.stringify(t)===JSON.stringify(tag)).length!==1))return false;
 for(const name of ['nonce','wm-session-capability']){
  const tags=actual.filter(t=>t?.[0]===name);
  if(tags.length>1||tags.some(t=>!Array.isArray(t)||(name==='nonce'?t.length!==2:t.length!==4)||t.slice(1).some((v:unknown)=>typeof v!=='string'||!v.length||v.length>256)))return false;
 }
 return true;
}

/** One bounded client attempt. Stopping never retries or rolls back remote work. */
export function browserAttempt(options:{signal?:AbortSignal;timeoutMs?:number;progress?:(text:string)=>void}={}){
 const controller=new AbortController();
 const stop=()=>controller.abort(new Error('Operation cancelled. Outcome unknown; reload saved state before trying again.'));
 const timer=setTimeout(()=>controller.abort(new Error('Operation timed out. Outcome unknown; reload saved state before trying again.')),options.timeoutMs??120000);
 options.signal?.addEventListener('abort',stop,{once:true});if(options.signal?.aborted)stop();
 const check=()=>{if(controller.signal.aborted)throw controller.signal.reason;};
 const wait=async<T>(label:string,work:()=>Promise<T>):Promise<T>=>{
  check();options.progress?.(label);
  return new Promise<T>((resolve,reject)=>{
   const abort=()=>reject(controller.signal.reason);controller.signal.addEventListener('abort',abort,{once:true});
   Promise.resolve().then(()=>{check();return work();}).then(value=>{check();resolve(value);},reject).catch(reject).finally(()=>controller.signal.removeEventListener('abort',abort));
  });
 };
 return {signal:controller.signal,check,wait,stop,dispose:()=>{clearTimeout(timer);options.signal?.removeEventListener('abort',stop);}};
}

/** The trusted parent signs only a bounded Tower plan. Children never receive this helper or a signer. */
export function validateBrowserChallenge(connection:BrowserConnection,challenge:BrowserChallenge){
 const origin=new URL(connection.endpoint);
 requireValue(origin.protocol==='https:'&&!origin.username&&!origin.password&&origin.origin===connection.endpoint,'Invalid selected Tower origin');
 const url=new URL(challenge.url);
 requireValue(url.origin===connection.endpoint&&!url.username&&!url.password&&!url.hash,'Signing request changed Tower origin');
 requireValue(typeof challenge.id==='string'&&challenge.id.length>0&&challenge.id.length<=128,'Invalid signing challenge');
 requireValue(challenge.method==='GET'||challenge.method==='POST','Unsupported Tower signing method');
 requireValue(challenge.body===undefined||typeof challenge.body==='string'&&challenge.body.length<=262144,'Invalid signing payload');
 if(connection.mode==='discovery'){
  requireValue(challenge.method==='GET'&&!challenge.body,'Discovery only permits signed reads');
  if(url.pathname==='/api/v4/flightdeck-pg/workspaces'){
   requireValue([...url.searchParams.keys()].every(k=>['limit','cursor'].includes(k)),'Unexpected workspace listing parameter');
   const limit=Number(url.searchParams.get('limit'));requireValue(Number.isInteger(limit)&&limit>=1&&limit<=200,'Invalid workspace list bound');
   requireValue((url.searchParams.get('cursor')||'').length<=2048,'Workspace cursor exceeds bounds');
  }else requireValue(connection.workspaceId&&uuid.test(connection.workspaceId)&&url.pathname===`/api/v4/flightdeck-pg/workspaces/${connection.workspaceId}/me`&&!url.search,'Discovery request is outside the selected workspace');
  return challenge;
 }
 requireValue(connection.workspaceId&&uuid.test(connection.workspaceId)&&connection.appNpub===BYO_APP_NPUB,'Invalid selected BYO workspace namespace');
 const base=`/api/v4/flightdeck-pg/workspaces/${connection.workspaceId}`;
 const app=`${base}/apps/${BYO_APP_NPUB}`;
 const p=url.pathname;
 const workspaceRead=challenge.method==='GET'&&[base+'/me',base+'/connection-proof','/api/v4/flightdeck-pg/workspaces'].includes(p);
 const registration=p===app+'/registration'&&!url.search;
 const row=p.match(new RegExp('^'+app+'/db/(byo_[a-zA-Z0-9_-]{1,60})/rows(?:/([a-zA-Z0-9._:-]{1,256}))?$'));
 requireValue(workspaceRead||registration||row,'Tower signing request is outside the selected app plan');
 if(challenge.method==='GET'){
  requireValue(!challenge.body,'GET signing requests cannot carry a payload');
  const allowed=p.endsWith('/connection-proof')?['nonce']:row?['limit','offset','visibility','owner_npub']:['limit','offset'];
  requireValue([...url.searchParams.keys()].every(k=>allowed.includes(k)),'Unexpected Tower query parameter');
  if(url.searchParams.has('visibility'))requireValue(url.searchParams.get('visibility')==='private','Only private browser rows are supported');
 }else{
  requireValue(!url.search&&!!challenge.body,'Tower write requires an exact payload');
  let body:any;try{body=JSON.parse(challenge.body!)}catch{throw new Error('Invalid Tower JSON payload');}
  requireValue(body&&typeof body==='object'&&!Array.isArray(body),'Invalid Tower write shape');
  if(registration)requireValue(Object.keys(body).every(k=>['app_name','capabilities'].includes(k))&&body.app_name==='BYO Freedom'&&JSON.stringify(body.capabilities)===JSON.stringify(['app_rows.private_only']),'Unexpected BYO registration payload');
  else requireValue(row&&!row[2]&&body.visibility==='private'&&typeof body.row_id==='string'&&/^[a-zA-Z0-9._:-]{1,256}$/.test(body.row_id)&&Object.keys(body).every(k=>['row_id','visibility','data','metadata'].includes(k)),'Unexpected private row payload');
 }
 return challenge;
}

/** Executes a server-authorized operation through fresh, exact user NIP-98 signatures. No raw proxy or key export. */
export async function runBrowserOperation(api:Api,signer:BrowserSigner,startPath:string,startBody:any,options:{signal?:AbortSignal;timeoutMs?:number;progress?:(text:string)=>void}={}){
 const attempt=browserAttempt(options);
 const originalApi=api,originalSigner=signer;
 api=(path,method,body)=>attempt.wait('Waiting for request authorization and NStack response…',()=>originalApi(path,method,body,{signal:attempt.signal}));
 signer={...signer,getPublicKey:()=>attempt.wait('Waiting for signer identity…',()=>originalSigner.getPublicKey()),signEvent:event=>attempt.wait('Approve the exact NStack request in your signer…',()=>originalSigner.signEvent(event))};
 try{
 requireValue(['/api/nstack/connect','/api/nstack/discovery-request'].includes(startPath)||/^\/api\/installed-apps\/[a-zA-Z0-9-]+\/data$/.test(startPath),'Unsupported browser storage operation');
 const actor=await signer.getPublicKey();requireValue(/^[0-9a-f]{64}$/.test(actor),'Invalid current signer');
 let response=await api(startPath,'POST',startBody);
 if(response?.done===true)return response.result;
 // Managed transport operations return their ordinary result without a signing challenge.
 if(!response?.challenge)return response;
 const operationId=response.operationId,connection:BrowserConnection=response.connection;
 requireValue(typeof operationId==='string'&&operationId.length>0&&operationId.length<=128,'Invalid browser operation');
 if(startPath==='/api/nstack/connect'){
  const expected=startBody?.connection;
  requireValue(expected&&['endpoint','workspaceId','appNpub','serviceNpub','workspaceOwnerNpub','workspaceServiceNpub','workspaceAppNpub','mode'].every(k=>(connection as any)?.[k]===expected[k]),'Setup response changed the selected connection');
 }
 if(startPath==='/api/nstack/discovery-request')requireValue(connection?.mode==='discovery'&&connection.endpoint===startBody?.endpoint&&response.challenge?.url===startBody.endpoint+startBody.path,'Discovery response changed the requested endpoint or path');
 const pinnedConnection=JSON.stringify(connection);
 for(let step=0;step<64;step++){
  requireValue(response.operationId===operationId&&JSON.stringify(response.connection)===pinnedConnection,'Browser operation connection changed');
  const challenge=validateBrowserChallenge(connection,response.challenge);
  requireValue(await signer.getPublicKey()===actor,'Browser signer changed during operation');
  const tags=[['u',challenge.url],['method',challenge.method],['byo-challenge',challenge.id],...(challenge.body?[['payload',await sha256(challenge.body)]]:[])];
  const template={kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags};
  const event=JSON.parse(JSON.stringify(await signer.signEvent(template)));
  requireValue(event.pubkey===actor&&verifyEvent(event)&&event.kind===template.kind&&Number.isSafeInteger(event.created_at)&&Math.abs(event.created_at-template.created_at)<=5&&Math.abs(Date.now()/1000-event.created_at)<=60&&event.content===template.content&&sameAuthorizationTags(event.tags,tags),'Signer returned a different or invalid authorization');
  requireValue(await signer.getPublicKey()===actor,'Browser signer changed during operation');
  response=await api('/api/nstack/authorize','POST',{operationId,challengeId:challenge.id,event});
  if(response?.done===true)return response.result;
 }
 throw new Error('Browser storage operation exceeded its bounded request plan');
 }finally{attempt.dispose();}
}
