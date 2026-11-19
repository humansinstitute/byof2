import {createAppGatewayNStackFiles} from '../integration/nstack-app-files';
import {createManagedNStackFiles} from '../integration/nstack-files';
import {ADMINS,hash,need} from './auth';
import {connectionInput,type NStackConnection,type NStackFiles} from './nstack';
import {createInterviewImages} from './interview-images';
import type {Store} from './store';

/** Explicit server configuration; never derived from a participant's saved data connection. */
export function interviewStorageConnection(env:Record<string,string|undefined>=process.env):NStackConnection|undefined{
 const raw=env.BYO_INTERVIEW_STORAGE_CONNECTION_JSON;if(!raw)return;
 need(Buffer.byteLength(raw)<=4096,503,'Interview storage configuration exceeds bounds');
 const value=JSON.parse(raw);need(value&&Object.keys(value).sort().join(',')==='appNpub,endpoint,serviceNpub,workspaceOwnerNpub',503,'Exact managed interview storage connection required');
 return connectionInput(value);
}

/** Keeps the normalized private relay bytes for native image tickets; remote custody is additional. */
export function createManagedInterviewStorage(store:Store,connection:NStackConnection,files:NStackFiles){
 need(!connection.mode,503,'Server-managed interview storage required');
 const images=createInterviewImages(store),connectionHash=hash(JSON.stringify(connection));
 return {async put(actor:string,designId:string,imageId:string){
  const guard=()=>{
   images.select(actor,designId,[imageId]);
   const d=store.get('design',designId)!;
   const project=store.get('project',d.projectId);
   need(project&&!project.deletedAt&&(ADMINS.includes(actor)||store.get('membership',d.projectId+':'+actor)),403,'Project access denied');
   return d;
  };
  const design=guard(),image=store.get('interviewImage',imageId)!;
  const namespaceHash=hash(JSON.stringify(['byo-interview-image-v1',design.projectId,design.id,design.owner]));
  const binding=hash(JSON.stringify([connectionHash,namespaceHash,image.sha256,image.bytes]));
  need(await files.available(connection),503,'Private interview storage is not active');guard();
  const receipt=await files.put(connection,{namespaceHash,bytesBase64:image.base64,sha256:image.sha256,size:image.bytes,contentType:image.mimeType,name:image.name});guard();
  need(/^[a-f0-9-]{36}$/.test(receipt.objectId)&&receipt.sha256===image.sha256&&receipt.size===image.bytes,502,'Private image storage receipt mismatch');
  // A completed write must be readable through the same namespace before reporting NStack success.
  const readback=await files.get(connection,{namespaceHash,objectId:receipt.objectId});guard();
  need(readback.sha256===image.sha256&&readback.size===image.bytes&&readback.bytesBase64===image.base64,502,'Private image storage readback mismatch');
  store.put('interviewImageStorage',{id:binding,imageId,owner:design.owner,designId,projectId:design.projectId,connectionHash,namespaceHash,...receipt,complete:true,completedAt:new Date().toISOString()});
  return {objectId:receipt.objectId,storage:'nstack-private' as const};
 }};
}

/** Select explicitly; unset mode preserves the existing managed/browser behavior. */
export function configuredInterviewStorage(store:Store,env:Record<string,string|undefined>=process.env){
 const mode=env.BYO_INTERVIEW_STORAGE_MODE;
 need(mode===undefined||mode==='managed'||mode==='registered-app',503,'Unsupported interview storage mode');
 const connection=interviewStorageConnection(env);
 if(!connection){need(mode!=='registered-app',503,'Registered app interview connection required');return;}
 const files=mode==='registered-app'?createAppGatewayNStackFiles(env):createManagedNStackFiles(env,true);
 need(files,503,'Configured interview storage gateway required');
 return createManagedInterviewStorage(store,connection,files!);
}
