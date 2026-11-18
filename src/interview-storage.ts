import {need,hash} from './auth';
import type {Store,Row} from './store';
import type {NStackConnection,NStackTransport} from './nstack';

/** User-signed private NStack backup; local bytes remain the exact native-job relay copy. */
export async function storeInterviewImage(store:Store,c:NStackConnection,transport:NStackTransport,image:Row,design:Row,actor:string,guard:()=>void=()=>{},settingsRevision=0){
 guard();const connectionHash=hash(JSON.stringify(c));const binding=hash(JSON.stringify({connectionHash,settingsRevision,actor,imageId:image.id,sha256:image.sha256}));
 const previous=store.get('interviewImageStorage',binding);
 const exact=(r:any,objectId:string)=>r.object_id===objectId&&r.is_public===false&&r.owner_npub===c.workspaceOwnerNpub&&r.sha256_hex===image.sha256&&(typeof r.size_bytes==='number'||typeof r.size_bytes==='string'&&/^[0-9]+$/.test(r.size_bytes))&&Number.isSafeInteger(Number(r.size_bytes))&&Number(r.size_bytes)===image.bytes&&r.completed_at;
 const call=async(method:'GET'|'POST'|'PUT',path:string,body?:any)=>{guard();const r=await transport(c,{method,path,...(body===undefined?{}:{body})});const result=await r.json();guard();need(r.ok,r.status,result.error||'Private image storage failed');return result;};
 let objectId=previous?.objectId;
 if(objectId){const remote=await call('GET',`/api/v4/storage/${objectId}`);need(remote.object_id===objectId&&remote.is_public===false&&remote.owner_npub===c.workspaceOwnerNpub,502,'Private storage recovery identity mismatch');if(remote.completed_at){need(exact(remote,objectId),502,'Private image storage readback mismatch');guard();store.put('interviewImageStorage',{...previous!,complete:true,sha256:image.sha256,bytes:image.bytes});return {objectId,storage:'nstack-private'};}}

 if(!objectId){
  const prepared=await call('POST',`/api/v4/flightdeck-pg/workspaces/${c.workspaceId}/storage/prepare`,{content_type:image.mimeType,size_bytes:image.bytes,file_name:image.name,is_public:false,metadata:{purpose:'byo-interview-image',designId:design.id,projectId:design.projectId,participantOwner:design.owner,imageId:image.id,sha256:image.sha256}});
  need(/^[0-9a-f-]{36}$/.test(prepared.object_id)&&prepared.is_public===false&&prepared.owner_npub===c.workspaceOwnerNpub,502,'Private storage preparation identity mismatch');
  objectId=prepared.object_id;store.put('interviewImageStorage',{id:binding,objectId,imageId:image.id,actor,endpoint:c.endpoint,workspaceId:c.workspaceId,connectionHash,settingsRevision,sha256:image.sha256,bytes:image.bytes,complete:false});
 }
 // Signed same-origin API upload avoids trusting arbitrary presigned URLs from a response.
 await call('PUT',`/api/v4/storage/${objectId}`,{base64_data:image.base64});
 await call('POST',`/api/v4/storage/${objectId}/complete`,{sha256_hex:image.sha256,size_bytes:image.bytes});
 const verified=await call('GET',`/api/v4/storage/${objectId}`);
 need(exact(verified,objectId),502,'Private image storage readback mismatch');
 guard();store.put('interviewImageStorage',{...store.get('interviewImageStorage',binding)!,complete:true,sha256:image.sha256,bytes:image.bytes,completedAt:new Date().toISOString()});
 return {objectId,storage:'nstack-private'};
}
