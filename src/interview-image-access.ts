import {randomBytes,timingSafeEqual} from 'node:crypto';
import {Store} from './store';
import {hash,need} from './auth';
import {createInterviewImages} from './interview-images';

/** A read ticket grants only exact images on one active interview job and its actual registered run. */
export function createInterviewImageAccess(store:Store,origin:string,now:()=>number=Date.now){
 const images=createInterviewImages(store);
 return {
  activateFirstDispatch(jobId:string){
   const job=store.get('job',jobId);
   need(job&&job.attempts===0&&!job.runId&&!job.dispatchReceipt&&job.status==='queued',409,'Image access cannot change after a dispatch attempt');
   const imageIds=job!.context.attachments.map((a:any)=>a.id);
   const pinned=this.pin(job!.owner,job!.designId,jobId,job!.messageId,imageIds);
   return store.put('job',{...job!,context:{...job!.context,...pinned}});
  },
  pin(owner:string,designId:string,jobId:string,messageId:string,imageIds:string[]){
   const attachments=images.select(owner,designId,imageIds);
   if(!attachments.length)return {attachments:[],attachmentSource:null};
   const job=store.get('job',jobId),message=store.get('message',messageId);
   need(job?.owner===owner&&job.designId===designId&&job.messageId===messageId&&job.kind==='interview'&&message?.author===owner&&message.conversationId===designId,409,'Image job binding mismatch');
   const ticket=randomBytes(32).toString('base64url'),expiresAt=now()+10*60*1000;
   store.put('interviewImageAccess',{id:jobId,owner,designId,messageId,imageIds:attachments.map(a=>a.id),ticketHash:hash(ticket),expiresAt});
   return {attachments,attachmentSource:{url:`${origin}/api/interview-job-images/${jobId}`,ticket,jobId,expiresAt}};
  },
  response(request:Request,jobId:string){
   const grant=store.get('interviewImageAccess',jobId),ticket=request.headers.get('x-byo-image-ticket')??'';
   const url=new URL(request.url);
   need(request.method==='GET'&&!url.search&&url.pathname===`/api/interview-job-images/${jobId}`,403,'Exact image read required');
   need(grant&&/^[A-Za-z0-9_-]{43}$/.test(ticket)&&timingSafeEqual(Buffer.from(grant.ticketHash,'hex'),Buffer.from(hash(ticket),'hex')),403,'Image read denied');
   need(now()<grant!.expiresAt,403,'Image read expired');
   const job=store.get('job',jobId),message=store.get('message',grant!.messageId);
   need(job?.kind==='interview'&&job.owner===grant!.owner&&job.designId===grant!.designId&&job.messageId===grant!.messageId&&message?.author===grant!.owner,403,'Image job binding changed');
   need(job!.runId,409,'Image run not yet registered');
   need(request.headers.get('x-wingman-run-id')===job!.runId,403,'Image run mismatch');
   need(['running','dispatching','uncertain'].includes(job!.status),403,'Image job is no longer active');
   const imageId=request.headers.get('x-byo-image-id')??'';
   need(grant!.imageIds.includes(imageId)&&message!.imageIds?.includes(imageId),403,'Image is not pinned to this message');
   return images.response(grant!.owner,grant!.designId,imageId);
  },
 };
}
