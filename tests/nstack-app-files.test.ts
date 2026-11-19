import {test,expect} from 'bun:test';
import {createAppBrokerNStackFiles,appStorageProtocol,appImageMaxBytes,type AppStorageRequest} from '../integration/nstack-app-files';
import {hash} from '../src/auth';
import {createNStackGateway} from '../src/nstack-gateway';
import {createManagedInterviewStorage,configuredInterviewStorage} from '../src/interview-managed-storage';
import {Store} from '../src/store';
const binding={endpoint:'https://tower.example',serviceNpub:'service',workspaceOwnerNpub:'owner',appNpub:'backend-app',installationId:'installation'};
const data=Buffer.from('normalized image fixture'),input={namespaceHash:'a'.repeat(64),bytesBase64:data.toString('base64'),sha256:hash(data),size:data.length,contentType:'image/png',name:'reference.png'};
export function standardFixture(){
 const requests:AppStorageRequest[]=[],objects=new Map<string,any>(),keys=new Map<string,string>(),rows=new Map<string,any>();
 let lose='',corrupt='',disabled=false,uploads=0;
 const identity={protocol:appStorageProtocol,workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub};
 const control=async(installation:string,r:AppStorageRequest)=>{
  expect(installation).toBe(binding.installationId);requests.push(r);
  if(disabled)return Response.json({error:'disabled'},{status:403});
  let v:any;
  if(r.path==='/descriptor')v={...identity,private_only:true,max_object_bytes:8388608,operations:['prepare','upload','complete','metadata','content','head']};
  else if(r.path==='/prepare'){
   const b=r.body as any;let id=keys.get(b.idempotency_key);
   if(!id){id=`aaaaaaaa-aaaa-5aaa-aaaa-${String(objects.size+1).padStart(12,'0')}`;keys.set(b.idempotency_key,id);objects.set(id,{...identity,object_id:id,file_name:b.file_name,content_type:b.content_type,size_bytes:b.size_bytes,sha256_hex:b.sha256_hex,is_public:false,completed_at:null});}
   v=objects.get(id);
  }else{
   const id=r.path.split('/')[2]!,m=objects.get(id);if(!m)return Response.json({}, {status:404});
   if(r.method==='PUT'){uploads++;expect(hash(Buffer.from((r.body as any).base64_data,'base64'))).toBe(m.sha256_hex);m.bytes=(r.body as any).base64_data;}
   if(r.path.endsWith('/complete'))m.completed_at='2026-11-19T01:00:00Z';
   v=r.path.endsWith('/content')?{...identity,object_id:id,content_type:m.content_type,size_bytes:m.size_bytes,sha256_hex:m.sha256_hex,bytes_base64:corrupt==='bytes'?Buffer.from('tamper').toString('base64'):m.bytes}:Object.fromEntries(Object.entries(m).filter(([k])=>k!=='bytes'));
  }
  if(lose===r.path){lose='';throw Error('lost response');}
  if(corrupt==='identity')v={...v,app_npub:'foreign'};
  if(corrupt==='workspace')v={...v,workspace_owner_npub:'foreign'};
  if(corrupt==='protocol')v={...v,protocol:'managed-app-storage-v1'};
  if(corrupt==='public'&&v.object_id)v={...v,is_public:true};
  return Response.json(v);
 };
 const files=createAppBrokerNStackFiles({bindings:[binding],control});
 const gateway=createNStackGateway({bindings:[binding],token:()=> 'x'.repeat(43),appImageFiles:files,broker:async(_,r)=>{
  const ns={workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub};
  if(r.method==='GET')return Response.json({...ns,row:rows.get(r.path.split('/').at(-1)!)});
  const b=r.body as any;if(rows.has(b.id))return Response.json({}, {status:409});rows.set(b.id,b.data);return Response.json({...ns,row:b.data});
 }});
 const call=(operation:string,i:any=input,c:any=binding,path='/v1/app-images')=>gateway.fetch(new Request('https://gateway.example'+path,{method:'POST',headers:{authorization:'Bearer '+'x'.repeat(43)},body:JSON.stringify({operation,connection:c,input:i})}));
 return {files,requests,objects,keys,rows,call,setLose:(v:string)=>lose=v,setCorrupt:(v:string)=>corrupt=v,disable:()=>disabled=true,uploads:()=>uploads};
}
test('standard lifecycle verifies bytes and same deterministic prepare UUID retries without duplicate objects',async()=>{
 const f=standardFixture();expect(await f.files.available(binding)).toBe(true);f.setLose('/prepare');await expect(f.files.put(binding,input)).rejects.toThrow('lost response');
 f.setLose('/objects/aaaaaaaa-aaaa-5aaa-aaaa-000000000001/complete');await expect(f.files.put(binding,input)).rejects.toThrow('lost response');
 const p=await f.files.put(binding,input);expect(f.objects.size).toBe(1);expect(f.uploads()).toBe(1);expect((await f.files.get(binding,{namespaceHash:input.namespaceHash,objectId:p.objectId})).bytesBase64).toBe(input.bytesBase64);
 await f.files.put(binding,{...input,name:'other.png'});await f.files.put(binding,{...input,namespaceHash:'b'.repeat(64)});await f.files.put(binding,{...input,contentType:'image/jpeg'});expect(f.keys.size).toBe(4);
 const keys=f.requests.filter(r=>r.path==='/prepare').map(r=>(r.body as any).idempotency_key);expect(keys[0]).toBe(keys[1]);expect(keys[1]).toBe(keys[2]);
 expect(JSON.stringify(f.requests)).not.toMatch(/https:|Bearer|nsec/);
});
test('standard client rejects foreign connection and tampered protocol identity public receipts or content',async()=>{
 for(const change of [{appNpub:'browser-app'},{workspaceOwnerNpub:'foreign'},{serviceNpub:'foreign'},{endpoint:'https://evil.example'}]){
  const f=standardFixture();await expect(f.files.put({...binding,...change},input)).rejects.toThrow('binding');expect(f.requests.length).toBe(0);
 }
 for(const corruption of ['identity','workspace','protocol','public','bytes']){const f=standardFixture();f.setCorrupt(corruption);await expect(f.files.put(binding,input)).rejects.toThrow();}
 const f=standardFixture();const p=await f.files.put(binding,input);f.disable();await expect(f.files.get(binding,{namespaceHash:input.namespaceHash,objectId:p.objectId})).rejects.toThrow('unavailable');
});
test('2MiB bound, canonical base64, image-only metadata and exact prepare receipt fail closed',async()=>{
 const f=standardFixture();await expect(f.files.put(binding,{...input,size:appImageMaxBytes+1})).rejects.toThrow('limit');
 await expect(f.files.put(binding,{...input,bytesBase64:input.bytesBase64+'\n'})).rejects.toThrow('integrity');
 await expect(f.files.put(binding,{...input,contentType:'text/plain'})).rejects.toThrow('metadata');
 await expect(f.files.put(binding,{...input,name:'../image.png'})).rejects.toThrow('metadata');expect(f.requests.length).toBe(0);
 const bytes=Buffer.alloc(appImageMaxBytes,1);await f.files.put(binding,{...input,size:bytes.length,bytesBase64:bytes.toString('base64'),sha256:hash(bytes)});
 const wrong=createAppBrokerNStackFiles({bindings:[binding],control:async(id,r)=>{const res=await (async()=>{if(r.path==='/descriptor')return Response.json({protocol:appStorageProtocol,app_npub:binding.appNpub,workspace_owner_npub:binding.workspaceOwnerNpub,private_only:true,max_object_bytes:8388608,operations:['prepare','upload','complete','metadata','content','head']});const {bytes,...m}=Array.from(f.objects.values())[0];return Response.json({...m,file_name:'wrong.png'});})();return res;}});
 await expect(wrong.put(binding,input)).rejects.toThrow('binding');
});
test('gateway isolates standard purpose and namespace and rejects conflicting registry',async()=>{
 const f=standardFixture();const a=await f.call('put');expect(a.status).toBe(200);const p=await a.json();expect((await f.call('put')).status).toBe(200);expect(f.objects.size).toBe(1);
 expect((await f.call('get',{objectId:p.objectId,namespaceHash:input.namespaceHash})).status).toBe(200);
 expect((await f.call('get',{objectId:p.objectId,namespaceHash:'b'.repeat(64)})).status).toBe(403);
 expect((await f.call('get',{objectId:p.objectId,namespaceHash:input.namespaceHash},binding,'/v1/interview-images')).status).toBe(501);
 expect((await f.call('put',input,{...binding,appNpub:'browser-app'})).status).toBe(403);
 f.rows.get('app-image:'+p.objectId).data.sha256='e'.repeat(64);expect((await f.call('put')).status).toBe(409);expect((await f.call('get',{objectId:p.objectId,namespaceHash:input.namespaceHash})).status).toBe(502);
 expect((await f.call('put',{...input,contentType:'text/plain'})).status).toBe(400);
});
test('ordinary BYOF participant requires only BYOF membership; foreign design/user denied and relay untouched',async()=>{
 const f=standardFixture(),store=new Store(':memory:');
 try{
  store.put('project',{id:'p'});store.put('membership',{id:'p:alice'});store.put('membership',{id:'p:bob'});
  store.put('design',{id:'d',projectId:'p',owner:'alice'});store.put('design',{id:'other',projectId:'p',owner:'alice'});
  store.put('interviewImage',{id:'image',owner:'alice',designId:'d',base64:input.bytesBase64,sha256:input.sha256,bytes:input.size,name:input.name,mimeType:input.contentType});
  const bridge={available:async()=>true,put:async(_c:any,i:any)=>{const r=await f.call('put',i);if(!r.ok)throw Error('gateway unavailable');return r.json();},get:async(_c:any,i:any)=>{const r=await f.call('get',i);if(!r.ok)throw Error('gateway unavailable');return r.json();}};
  const storage=createManagedInterviewStorage(store,binding,bridge);const before=JSON.stringify(store.get('interviewImage','image'));
  await expect(storage.put('bob','d','image')).rejects.toThrow();await expect(storage.put('alice','other','image')).rejects.toThrow();expect(f.objects.size).toBe(0);
  expect((await storage.put('alice','d','image')).storage).toBe('nstack-private');expect(JSON.stringify(store.get('interviewImage','image'))).toBe(before);
  expect(store.all('interviewImageStorage').length).toBe(1);f.setCorrupt('bytes');await expect(storage.put('alice','d','image')).rejects.toThrow();
 }finally{store.db.close();}
});
test('unset configuration stays legacy while explicit standard configuration fails without fallback',()=>{
 const store=new Store(':memory:');try{expect(configuredInterviewStorage(store,{})).toBeUndefined();expect(()=>configuredInterviewStorage(store,{BYO_INTERVIEW_STORAGE_MODE:'registered-app'})).toThrow('connection required');expect(()=>configuredInterviewStorage(store,{BYO_INTERVIEW_STORAGE_MODE:'typo'})).toThrow('Unsupported');}finally{store.db.close();}
});

test('confirmed AP environment binds installation app workspace and exact loopback without secret exposure',async()=>{
 const {registeredAppBrokerNStackFiles}=await import('../integration/nstack-app-files');
 const r={installationId:binding.installationId,origin:binding.endpoint,workspaceOwnerNpub:binding.workspaceOwnerNpub,appNpub:binding.appNpub,appId:'installed',ownerNpub:'owner',bindingId:'binding',workspaceId:null,protocol:appStorageProtocol,maxObjectBytes:8388608};
 const env={WAPP_REGISTERED_APP_STORAGE_BROKER_URL:'http://127.0.0.1:1234/api/internal/wapps/registered-app-storage',WAPP_REGISTERED_APP_STORAGE_CAPABILITY:'x'.repeat(43),WAPP_REGISTERED_APP_STORAGE_BINDINGS_JSON:JSON.stringify([r])};
 let calls=0;const files=registeredAppBrokerNStackFiles(env,[binding],(async(url,init)=>{calls++;expect(String(url)).toBe(env.WAPP_REGISTERED_APP_STORAGE_BROKER_URL);expect(init!.redirect).toBe('manual');expect((init!.headers as any).authorization).toBe('Bearer '+'x'.repeat(43));expect(JSON.parse(init!.body as string)).toEqual({installationId:binding.installationId,method:'GET',path:'/descriptor'});return Response.json({protocol:appStorageProtocol,workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub,private_only:true,max_object_bytes:8388608,operations:['prepare','upload','complete','metadata','content','head']});}) as typeof fetch);
 expect(await files.available(binding)).toBe(true);expect(calls).toBe(1);
 for(const url of ['https://evil.example/api/internal/wapps/registered-app-storage','http://127.0.0.1/api/internal/wapps/registered-app-storage?url=evil','http://user@127.0.0.1/api/internal/wapps/registered-app-storage','http://127.0.0.1/wrong'])expect(()=>registeredAppBrokerNStackFiles({...env,WAPP_REGISTERED_APP_STORAGE_BROKER_URL:url},[binding])).toThrow('loopback');
 for(const changed of [{appNpub:'browser-app'},{workspaceOwnerNpub:'foreign'},{origin:'https://evil.example'},{installationId:'foreign'},{protocol:'managed-app-storage-v1'}])expect(()=>registeredAppBrokerNStackFiles({...env,WAPP_REGISTERED_APP_STORAGE_BINDINGS_JSON:JSON.stringify([{...r,...changed}])},[binding])).toThrow();
 expect(()=>registeredAppBrokerNStackFiles({...env,WAPP_REGISTERED_APP_STORAGE_BINDINGS_JSON:JSON.stringify([r,r])},[binding])).toThrow();
 expect(()=>registeredAppBrokerNStackFiles({},[binding])).toThrow('configuration');
});
