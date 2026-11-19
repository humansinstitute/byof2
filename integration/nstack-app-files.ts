import {createHash} from 'node:crypto';
import {need} from '../src/auth';
import type {NStackConnection,NStackFiles} from '../src/nstack';
import {boundedJson,readGatewayToken} from './nstack-transport';
import {interviewGatewayBodyLimit} from './nstack-files';

export const appStorageProtocol='registered-app-storage-v1';
export const appImageMaxBytes=2097152;
export type AppStorageBinding=NStackConnection&{installationId:string};
export type AppStorageRequest={method:string;path:string;body?:unknown};
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const same=(a:NStackConnection,b:NStackConnection)=>['endpoint','serviceNpub','workspaceOwnerNpub','appNpub'].every(k=>a[k as keyof NStackConnection]===b[k as keyof NStackConnection])&&!a.mode;

/** Standard app authority is held by AP. This client never accepts URLs or signing material from callers. */
export function createAppBrokerNStackFiles(options:{bindings:AppStorageBinding[];control:(installationId:string,request:AppStorageRequest)=>Promise<Response>}):NStackFiles{
 function binding(c:NStackConnection){const b=options.bindings.find(b=>same(c,b));need(b,403,'Registered app file binding mismatch');return b!;}
 async function call(b:AppStorageBinding,method:string,path:string,body?:unknown,content=false){
  const r=await options.control(b.installationId,{method,path,...(body===undefined?{}:{body})});
  const v=await boundedJson(r,content?interviewGatewayBodyLimit:32768);
  need(r.ok,[400,403,404,409,413,503].includes(r.status)?r.status:502,'Registered app storage unavailable');
  need(v.protocol===appStorageProtocol&&v.workspace_owner_npub===b.workspaceOwnerNpub&&v.app_npub===b.appNpub,502,'Registered app storage identity mismatch');
  return v;
 }
 function metadata(v:any,id?:string){need(typeof v.object_id==='string'&&uuid.test(v.object_id)&&(!id||v.object_id===id)&&v.is_public===false&&(v.completed_at===null||typeof v.completed_at==='string'&&Number.isFinite(Date.parse(v.completed_at)))&&['image/png','image/jpeg'].includes(v.content_type)&&typeof v.file_name==='string'&&v.file_name.length>0&&v.file_name.length<=255&&Number.isSafeInteger(v.size_bytes)&&v.size_bytes>0&&v.size_bytes<=appImageMaxBytes&&/^[a-f0-9]{64}$/.test(v.sha256_hex),502,'Registered app object receipt mismatch');return v;}
 async function descriptor(b:AppStorageBinding){const v=await call(b,'GET','/descriptor');need(v.private_only===true&&Number.isSafeInteger(v.max_object_bytes)&&v.max_object_bytes>=appImageMaxBytes&&v.max_object_bytes<=8388608&&Array.isArray(v.operations)&&['prepare','upload','complete','metadata','content','head'].every(op=>v.operations.includes(op)),502,'Registered app descriptor mismatch');}
 async function get(b:AppStorageBinding,id:string){
  const m=metadata(await call(b,'GET',`/objects/${id}`),id);need(typeof m.completed_at==='string'&&Number.isFinite(Date.parse(m.completed_at)),502,'Registered app object incomplete');
  const v=await call(b,'GET',`/objects/${id}/content`,undefined,true);
  need(v.object_id===id&&v.content_type===m.content_type&&v.size_bytes===m.size_bytes&&v.sha256_hex===m.sha256_hex&&typeof v.bytes_base64==='string'&&v.bytes_base64.length<=Math.ceil(appImageMaxBytes/3)*4,502,'Registered app content receipt mismatch');
  const bytes=Buffer.from(v.bytes_base64,'base64');need(bytes.toString('base64')===v.bytes_base64&&bytes.length===m.size_bytes&&sha(bytes)===m.sha256_hex,502,'Registered app content integrity mismatch');
  return {bytesBase64:v.bytes_base64,sha256:m.sha256_hex,size:m.size_bytes,contentType:m.content_type};
 }
 return {
  available:async c=>{try{await descriptor(binding(c));return true;}catch{return false;}},
  put:async(c,input)=>{
   const b=binding(c);need(/^[a-f0-9]{64}$/.test(input.namespaceHash),400,'Exact app file namespace required');
   need(typeof input.bytesBase64==='string'&&input.bytesBase64.length<=Math.ceil(appImageMaxBytes/3)*4&&Number.isSafeInteger(input.size)&&input.size>0&&input.size<=appImageMaxBytes,413,'App image exceeds supported limit');
   need(['image/png','image/jpeg'].includes(input.contentType)&&typeof input.name==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,99}$/.test(input.name),400,'Safe app image metadata required');
   const bytes=Buffer.from(input.bytesBase64,'base64');need(bytes.toString('base64')===input.bytesBase64&&bytes.length===input.size&&sha(bytes)===input.sha256,400,'App image integrity mismatch');
   await descriptor(b);
   const key=sha(JSON.stringify([appStorageProtocol,b.endpoint,b.installationId,b.workspaceOwnerNpub,b.appNpub,input.namespaceHash,input.sha256,input.size,input.name,input.contentType]));
   const idempotency_key=`${key.slice(0,8)}-${key.slice(8,12)}-5${key.slice(13,16)}-a${key.slice(17,20)}-${key.slice(20,32)}`;
   const receipt=(v:any,id?:string)=>{metadata(v,id);need(v.sha256_hex===input.sha256&&v.size_bytes===input.size&&v.file_name===input.name&&v.content_type===input.contentType,502,'Registered app prepare binding mismatch');return v;};
   const p=receipt(await call(b,'POST','/prepare',{idempotency_key,file_name:input.name,content_type:input.contentType,size_bytes:input.size,sha256_hex:input.sha256}));
   if(p.completed_at===null)receipt(await call(b,'PUT',`/objects/${p.object_id}`,{base64_data:input.bytesBase64}),p.object_id);
   const done=receipt(await call(b,'POST',`/objects/${p.object_id}/complete`,{size_bytes:input.size,sha256_hex:input.sha256}),p.object_id);
   need(typeof done.completed_at==='string'&&Number.isFinite(Date.parse(done.completed_at)),502,'Registered app completion missing');
   const read=await get(b,p.object_id);need(read.sha256===input.sha256&&read.size===input.size&&read.bytesBase64===input.bytesBase64,502,'Registered app readback mismatch');
   return {objectId:p.object_id,sha256:input.sha256,size:input.size};
  },
  get:async(c,input)=>{const b=binding(c);need(uuid.test(input.objectId)&&/^[a-f0-9]{64}$/.test(input.namespaceHash),400,'Exact app object and namespace required');return get(b,input.objectId);}
 };
}

/** Server to gateway transport; explicit configuration never falls back to browser signing. */
export function createAppGatewayNStackFiles(env:Record<string,string|undefined>=process.env,fetchImpl:typeof fetch=fetch):NStackFiles{
 need(env.BYO_NSTACK_GATEWAY_URL&&env.BYO_NSTACK_GATEWAY_TOKEN_FILE,503,'Registered app gateway configuration required');
 const base=new URL(env.BYO_NSTACK_GATEWAY_URL!);need(base.protocol==='https:'&&base.pathname==='/v1/data'&&!base.username&&!base.password&&!base.search&&!base.hash,503,'Exact registered app gateway URL required');
 const url=new URL('/v1/app-images',base);
 async function request(body:unknown){const r=await fetchImpl(url,{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+readGatewayToken(env.BYO_NSTACK_GATEWAY_TOKEN_FILE!),'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const v=await boundedJson(r,interviewGatewayBodyLimit);need(r.ok,[400,403,404,409,413,501,503].includes(r.status)?r.status:502,'Registered app gateway unavailable');return v;}
 return {available:async connection=>{try{return (await request({operation:'status',connection})).available===true;}catch{return false;}},put:(connection,input)=>request({operation:'put',connection,input}),get:(connection,input)=>request({operation:'get',connection,input})};
}

/** Match the existing gateway allowlist against process-only authority issued by AP. No grant files. */
export function registeredAppBrokerNStackFiles(env:Record<string,string|undefined>,bindings:AppStorageBinding[],fetchImpl:typeof fetch=fetch):NStackFiles{
 const endpoint=env.WAPP_REGISTERED_APP_STORAGE_BROKER_URL,capability=env.WAPP_REGISTERED_APP_STORAGE_CAPABILITY,raw=env.WAPP_REGISTERED_APP_STORAGE_BINDINGS_JSON;
 need(endpoint&&capability&&raw&&raw.length<=32768,503,'Registered app broker configuration required');
 const url=new URL(endpoint!);need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/api/internal/wapps/registered-app-storage'&&!url.username&&!url.password&&!url.search&&!url.hash,503,'Exact loopback registered app broker required');
 need(/^[A-Za-z0-9_-]{43,128}$/.test(capability!),503,'Registered app process capability required');
 let runtime:any;try{runtime=JSON.parse(raw!);}catch{throw Error('Invalid registered app broker bindings');}
 need(Array.isArray(runtime)&&runtime.length>0&&runtime.length<=8&&bindings.length>0&&bindings.length<=8,503,'Registered app broker bindings required');
 for(const b of bindings){
  const matches=runtime.filter((r:any)=>r&&r.installationId===b.installationId&&r.origin===b.endpoint&&r.workspaceOwnerNpub===b.workspaceOwnerNpub&&r.appNpub===b.appNpub);
  need(matches.length===1,503,'Registered app broker binding mismatch');const r=matches[0];
  need(r.protocol===appStorageProtocol&&r.maxObjectBytes===8388608&&typeof r.appId==='string'&&r.appId.length>0&&typeof r.ownerNpub==='string'&&r.ownerNpub.length>0&&typeof r.bindingId==='string'&&r.bindingId.length>0&&(r.workspaceId===null||typeof r.workspaceId==='string'&&r.workspaceId.length>0),503,'Registered app runtime binding invalid');
 }
 return createAppBrokerNStackFiles({bindings,control:(installationId,request)=>fetchImpl(url,{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+capability,'content-type':'application/json'},body:JSON.stringify({installationId,...request}),signal:AbortSignal.timeout(20000)})});
}
