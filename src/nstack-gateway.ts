import {interviewGatewayBodyLimit} from '../integration/nstack-files';
import {timingSafeEqual} from 'node:crypto';
import {hash,HttpError,need} from './auth';
import {boundedJson,readGatewayToken} from '../integration/nstack-transport';
import type {NStackConnection,NStackRequest,NStackFiles} from './nstack';

export const gatewayMigrationSql='CREATE TABLE byo_documents (id text PRIMARY KEY, collection text NOT NULL, row_id text NOT NULL, data jsonb NOT NULL, UNIQUE (collection, row_id))';
export const gatewayMigration={version:'byo-documents-v1',checksum:'sha256:'+hash(gatewayMigrationSql),sql:gatewayMigrationSql};
export type GatewayBinding=NStackConnection&{installationId:string};
export type GatewayOptions={bindings:GatewayBinding[];token:()=>string;broker:(installationId:string,request:{method:string;path:string;body?:unknown})=>Promise<Response>;fetchImpl?:(input:any,init?:RequestInit)=>Promise<Response>;files?:NStackFiles;interviewFiles?:NStackFiles};
const validCollection=/^byo_(?:[a-f0-9]{48}|connection_probe)$/;
function sameConnection(a:NStackConnection,b:NStackConnection){return ['endpoint','serviceNpub','workspaceOwnerNpub','appNpub'].every(k=>a[k as keyof NStackConnection]===b[k as keyof NStackConnection]);}
export function createNStackGateway(options:GatewayOptions){
 async function execute(connection:NStackConnection,request:NStackRequest){
  const binding=options.bindings.find(b=>sameConnection(b,connection));need(binding,403,'Destination is not an approved BYO binding');
  const health=await (options.fetchImpl||fetch)(binding!.endpoint+'/health',{redirect:'manual',signal:AbortSignal.timeout(10000)});const identity=await boundedJson(health,32768);need(health.ok&&identity.service_npub===binding!.serviceNpub,502,'Storage service identity mismatch');
  const prefix=`/api/v4/workspaces/${binding!.workspaceOwnerNpub}/apps/${binding!.appNpub}/db/`;
  need(typeof request.path==='string'&&request.path.startsWith(prefix)&&!request.path.includes('%')&&!request.path.includes('\\'),403,'Scoped data path required');
  const match=request.path.slice(prefix.length).match(/^(byo_[a-z0-9_]+)\/rows(?:\?limit=(\d+)&offset=(\d+))?$/);need(match&&validCollection.test(match[1]!),403,'Collection path is not allowed');const collection=match![1]!;
  const call=async(method:string,path:string,body?:unknown)=>{const response=await options.broker(binding!.installationId,{method,path,...(body===undefined?{}:{body})});const result=await boundedJson(response);if(!response.ok)throw new HttpError([400,401,403,404,409,413,429,503].includes(response.status)?response.status:502,'Chosen NStack rejected data operation');need(result.workspace_owner_npub===binding!.workspaceOwnerNpub&&result.app_npub===binding!.appNpub,502,'Broker namespace mismatch');return result;};
  if(request.method==='GET'){
   need(request.body===undefined&&match![2]&&Number(match![2])>=1&&Number(match![2])<=100&&Number(match![3])<=10000,400,'Bounded data pagination required');
   const result=await call('POST','/tables/byo_documents/query',{where:{collection:{eq:collection}},order:[{field:'id',dir:'asc'}],limit:Number(match![2]),offset:Number(match![3])});need(Array.isArray(result.rows),502,'Invalid remote rows');
   return {workspace_owner_npub:binding!.workspaceOwnerNpub,app_npub:binding!.appNpub,collection,rows:result.rows.map((r:any)=>{need(r.collection===collection&&typeof r.row_id==='string'&&r.data&&typeof r.data==='object',502,'Invalid remote row');return {collection,row_id:r.row_id,data:r.data};})};
  }
  need(request.method==='POST'&&!match![2]&&collection!=='byo_connection_probe',403,'Only immutable data insertion is allowed');
  const b=request.body as any;need(b&&Object.keys(b).every(k=>['row_id','visibility','data','metadata'].includes(k))&&b.visibility==='private'&&typeof b.row_id==='string'&&/^[A-Za-z0-9:_-]{1,128}$/.test(b.row_id)&&b.data?.byo===1&&Buffer.byteLength(JSON.stringify(b))<=128*1024,400,'Invalid immutable document');
  const id=hash(collection+':'+b.row_id);const result=await call('POST','/tables/byo_documents/rows',{id,data:{collection,row_id:b.row_id,data:b.data}});need(result.row?.id===id&&result.row.collection===collection,502,'Invalid insertion receipt');return {workspace_owner_npub:binding!.workspaceOwnerNpub,app_npub:binding!.appNpub,collection,row:{collection,row_id:b.row_id,data:result.row.data}};
 }
 async function files(b:any,interview=false){
  const adapter=interview?options.interviewFiles:options.files;const registry=interview?'byo_interview_file_bindings':'byo_file_bindings';
  if(b.operation==='status'){need(b.connection,400,'Exact file connection required');const binding=options.bindings.find(x=>sameConnection(x,b.connection));need(binding,403,'File connection is not approved');return {available:!!adapter&&await adapter.available(b.connection)};}
  need(adapter&&['put','get'].includes(b.operation),501,'Managed files require an approved storage custody binding');
  const binding=options.bindings.find(x=>sameConnection(x,b.connection));need(binding,403,'File connection is not approved');
  const input=b.input;need(input&&/^[a-f0-9]{64}$/.test(input.namespaceHash),400,'Exact file namespace required');
  const call=async(method:string,path:string,body?:unknown)=>{const r=await options.broker(binding!.installationId,{method,path,...(body===undefined?{}:{body})});const value=await boundedJson(r);need(r.ok,[403,404,409].includes(r.status)?r.status:502,'Remote file registry rejected');need(value.workspace_owner_npub===binding!.workspaceOwnerNpub&&value.app_npub===binding!.appNpub,502,'File registry namespace mismatch');return value;};
  if(b.operation==='put'){need(!interview||['image/png','image/jpeg'].includes(input.contentType),400,'Interview image type required');const receipt=await adapter!.put(b.connection,input);const rowId=(interview?'image:':'file:')+receipt.objectId;try{await call('POST','/tables/byo_documents/rows',{id:rowId,data:{collection:registry,row_id:receipt.objectId,data:{namespaceHash:input.namespaceHash,sha256:receipt.sha256,size:receipt.size}}});}catch(error){if(!(error instanceof HttpError)||error.status!==409)throw error;const existing=await call('GET','/tables/byo_documents/rows/'+rowId);need(existing.row?.collection===registry&&existing.row.row_id===receipt.objectId&&existing.row.data?.namespaceHash===input.namespaceHash&&existing.row.data?.sha256===receipt.sha256&&existing.row.data?.size===receipt.size,409,'File registry retry mismatch');}return receipt;}
  need(typeof input.objectId==='string'&&/^[a-f0-9-]{36}$/.test(input.objectId),400,'Exact file object required');
  const row=await call('GET','/tables/byo_documents/rows/'+(interview?'image:':'file:')+input.objectId);need(row.row?.collection===registry&&row.row.data?.namespaceHash===input.namespaceHash,403,'File does not belong to this namespace');return adapter!.get(b.connection,input);
 }
 return {execute,async fetch(req:Request){try{
  const path=new URL(req.url).pathname;if(path==='/health'&&req.method==='GET')return Response.json({ok:true,service:'byo-nstack-gateway',protocol:1});need(['/v1/data','/v1/files','/v1/interview-images'].includes(path)&&req.method==='POST',404,'Not found');
  const supplied=req.headers.get('authorization')||'',expected='Bearer '+options.token();need(Buffer.byteLength(supplied)===Buffer.byteLength(expected)&&timingSafeEqual(Buffer.from(supplied),Buffer.from(expected)),401,'Storage gateway capability required');
  const b=await boundedJson(req as unknown as Response,path==='/v1/interview-images'?interviewGatewayBodyLimit:path==='/v1/files'?512*1024:160*1024);if(path==='/v1/files'||path==='/v1/interview-images')return Response.json(await files(b,path==='/v1/interview-images'),{headers:{'cache-control':'no-store'}});need(b&&Object.keys(b).sort().join(',')==='connection,request'&&b.connection&&b.request,400,'Scoped request required');const value=await execute(b.connection,b.request);return Response.json(value,{headers:{'cache-control':'no-store'}});
 }catch(error){return Response.json({error:error instanceof HttpError?error.message:'Storage gateway unavailable'},{status:error instanceof HttpError?error.status:502,headers:{'cache-control':'no-store'}});}}};
}

/** Only consumes supported managed-process capabilities. No signer/custody-store import. */
export function managedGatewayOptions(env:Record<string,string|undefined>=process.env):GatewayOptions{
 const raw=env.BYO_NSTACK_GATEWAY_BINDINGS_JSON,tokenPath=env.BYO_NSTACK_GATEWAY_TOKEN_FILE,brokerUrl=env.WAPP_TOWER_DB_BROKER_URL,cap=env.WAPP_TOWER_DB_CAPABILITY;
 need(raw&&tokenPath&&brokerUrl&&cap,503,'Managed gateway binding is incomplete');const broker=new URL(brokerUrl!);need(broker.protocol==='http:'&&broker.hostname==='127.0.0.1'&&broker.pathname==='/api/internal/wapps/tower-db',503,'Supported loopback DB broker required');
 const bindings=JSON.parse(raw!) as GatewayBinding[],runtime=JSON.parse(env.WAPP_TOWER_BINDINGS_JSON||'[]');need(Array.isArray(bindings)&&bindings.length>0&&bindings.length<=8,503,'Gateway bindings required');for(const b of bindings){const u=new URL(b.endpoint);need(u.protocol==='https:'&&u.origin===b.endpoint&&/^npub1[a-z0-9]+$/.test(b.serviceNpub)&&runtime.some((r:any)=>r.installationId===b.installationId&&r.towerUrl===b.endpoint&&r.workspaceOwnerNpub===b.workspaceOwnerNpub&&r.appNpub===b.appNpub),503,'Gateway binding does not match managed authority');}
 return {bindings,token:()=>readGatewayToken(tokenPath!),broker:async(installationId,request)=>fetch(broker,{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+cap,'content-type':'application/json'},body:JSON.stringify({installationId,...request}),signal:AbortSignal.timeout(15000)})};
}
