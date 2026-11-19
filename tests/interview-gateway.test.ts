import {test,expect} from 'bun:test';
import {createNStackGateway} from '../src/nstack-gateway';
import {interviewGatewayBodyLimit} from '../integration/nstack-files';
import type {NStackFiles} from '../src/nstack';
const binding={endpoint:'https://tower.example',serviceNpub:'service',workspaceOwnerNpub:'owner',appNpub:'app',installationId:'install'},objectId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',token='a'.repeat(43);
test('only exact image route permits bounded 2MiB envelopes; registry isolates namespaces and purpose, retry recovers',async()=>{
 const rows=new Map<string,any>();let puts=0,gets=0;
 const files:NStackFiles={available:async()=>true,put:async(_,i)=>{puts++;return {objectId,sha256:i.sha256,size:i.size};},get:async()=>{gets++;return {bytesBase64:'YWJj',sha256:'f'.repeat(64),size:3,contentType:'application/octet-stream'};}};
 const gateway=createNStackGateway({bindings:[binding],token:()=>token,interviewFiles:files,files,broker:async(_,r)=>{const ns={workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub};if(r.method==='GET')return Response.json({...ns,row:rows.get(r.path.split('/').at(-1)!)});const b=r.body as any;if(rows.has(b.id))return Response.json({error:'exists'},{status:409});rows.set(b.id,b.data);return Response.json({...ns,row:b.data});}});
 const call=(path:string,body:any)=>gateway.fetch(new Request('https://gateway.example'+path,{method:'POST',headers:{authorization:'Bearer '+token},body:typeof body==='string'?body:JSON.stringify({connection:binding,...body})}));
 const input={namespaceHash:'a'.repeat(64),bytesBase64:'a'.repeat(2796204),sha256:'f'.repeat(64),size:2097152,contentType:'image/png',name:'ref.png'};
 expect((await call('/v1/interview-images',{operation:'put',input})).status).toBe(200);
 expect((await call('/v1/interview-images',{operation:'put',input})).status).toBe(200);
 expect((await call('/v1/files',{operation:'put',input})).status).toBe(502);expect(puts).toBe(2);
 expect((await call('/v1/interview-images',{operation:'get',input:{objectId,namespaceHash:input.namespaceHash}})).status).toBe(200);
 expect((await call('/v1/interview-images',{operation:'get',input:{objectId,namespaceHash:'b'.repeat(64)}})).status).toBe(403);
 expect((await call('/v1/files',{operation:'get',input:{objectId,namespaceHash:input.namespaceHash}})).status).toBe(403);expect(gets).toBe(1);
 expect((await call('/v1/interview-images',{operation:'put',input:{...input,bytesBase64:'',contentType:'text/plain'}})).status).toBe(400);
 expect((await call('/v1/interview-images',' '.repeat(interviewGatewayBodyLimit+1))).status).toBe(502);
 expect((await call('/v1/interview-images',{operation:'put',input:{...input,namespaceHash:'b'.repeat(64)}})).status).toBe(409);
});
test('image gateway path fails closed until explicitly configured',async()=>{const gateway=createNStackGateway({bindings:[binding],token:()=>token,broker:async()=>{throw Error('must not call');}});const response=await gateway.fetch(new Request('https://gateway.example/v1/interview-images',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({connection:binding,operation:'put',input:{}})}));expect(response.status).toBe(501);});
test('lost registry insertion response retries the exact row without creating or overwriting metadata',async()=>{
 let row:any,insertions=0,lost=true;const ns={workspace_owner_npub:binding.workspaceOwnerNpub,app_npub:binding.appNpub};
 const gateway=createNStackGateway({bindings:[binding],token:()=>token,interviewFiles:{available:async()=>true,put:async()=>({objectId,sha256:'f'.repeat(64),size:3}),get:async()=>{throw Error('not used');}},broker:async(_,r)=>{if(r.method==='GET')return Response.json({...ns,row});if(row)return Response.json({error:'exists'},{status:409});row=(r.body as any).data;insertions++;if(lost){lost=false;throw Error('Registry response lost');}return Response.json({...ns,row});}});
 const call=()=>gateway.fetch(new Request('https://gateway.example/v1/interview-images',{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({connection:binding,operation:'put',input:{namespaceHash:'a'.repeat(64),contentType:'image/png'}})}));
 expect((await call()).status).toBe(502);expect((await call()).status).toBe(200);expect(insertions).toBe(1);row.data.sha256='e'.repeat(64);expect((await call()).status).toBe(409);
});
