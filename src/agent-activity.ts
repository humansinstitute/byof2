import {createHash} from 'node:crypto';
import {verifyEvent} from 'nostr-tools';
import {Store,type Row} from './store';
import {need} from './auth';

export interface AgentActivity {version:1;eventId:string;sequence:number;runId:string;stepId:string;sessionId:string|null;turnId:string;correlation:Record<string,string>;timestamp:string;type:'commentary'|'tools'|'completed'|'failed';content:string}
const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export async function verifyAgentActivity(req:Request,urls:string[],pubkey:string):Promise<{event:AgentActivity;fingerprint:string}>{
 const reader=req.body?.getReader();need(reader,400,'Activity body required');const chunks:Uint8Array[]=[];let size=0;
 try{for(;;){const {done,value}=await reader!.read();if(done)break;size+=value.byteLength;need(size<=65536,413,'Activity too large');chunks.push(value);}}finally{await reader!.cancel().catch(()=>{});}
 const body=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
 const authorization=req.headers.get('authorization');need(authorization?.startsWith('Nostr ')&&authorization.length<8192,401,'Activity authentication required');
 const signed=JSON.parse(Buffer.from(authorization!.slice(6),'base64').toString());
 need(verifyEvent(signed)&&signed.kind===27235&&signed.content===''&&signed.pubkey===pubkey&&Number.isInteger(signed.created_at)&&Math.abs(Date.now()/1000-signed.created_at)<90,401,'Invalid activity signer');
 const tag=(name:string)=>{const entries=signed.tags.filter((t:string[])=>t[0]===name);need(entries.length===1&&entries[0].length===2,401,'Invalid activity authentication');return entries[0][1];};
 const fingerprint=digest(body);need(req.method==='POST'&&urls.includes(tag('u'))&&tag('method')==='POST'&&tag('payload')===fingerprint,401,'Invalid activity signature target');
 const event=JSON.parse(body) as AgentActivity;
 need(event&&Object.keys(event).sort().join(',')==='content,correlation,eventId,runId,sequence,sessionId,stepId,timestamp,turnId,type,version',400,'Invalid activity envelope');
 need(event.version===1&&/^[a-f0-9]{64}$/.test(event.eventId)&&Number.isInteger(event.sequence)&&event.sequence>=1&&event.sequence<=257&&['commentary','tools','completed','failed'].includes(event.type)&&typeof event.content==='string'&&!!event.content.trim()&&event.content.length<=4000&&typeof event.timestamp==='string'&&Number.isFinite(Date.parse(event.timestamp)),400,'Invalid activity event');
 for(const value of [event.runId,event.stepId,event.turnId,...(event.sessionId===null?[]:[event.sessionId])])need(typeof value==='string'&&value.length>0&&value.length<=200,400,'Invalid activity binding');
 need(event.correlation&&typeof event.correlation==='object'&&!Array.isArray(event.correlation)&&Object.keys(event.correlation).sort().join(',')==='conversationId,designId,jobId,projectId,requestId'&&Object.values(event.correlation).every(v=>typeof v==='string'&&v.length>0&&v.length<=200),400,'Invalid activity correlation');
 need(event.type==='commentary'||event.content===({tools:'Using tools',completed:'Completed',failed:'Failed'} as any)[event.type],400,'Invalid activity indicator');
 need(tag('event')===event.eventId&&tag('run')===event.runId&&req.headers.get('x-wingman-event-id')===event.eventId&&req.headers.get('x-wingman-run-id')===event.runId,401,'Activity header mismatch');
 return {event,fingerprint};
}
export function acceptAgentActivity(store:Store,event:AgentActivity,fingerprint:string){return store.transaction(()=>{
 const j=store.get('job',event.correlation.jobId);need(j&&!store.get('project',j.projectId)?.deletedAt,404,'Activity job not found');
 for(const [key,value] of Object.entries(event.correlation))need((key==='jobId'?j!.id:j![key])===value,403,'Activity job mismatch');
 need(j!.runId===event.runId,409,'Run not yet registered or does not match');
 need(['interview-v7','builder-v7'].includes(j!.workflowVersion),403,'Activity workflow not enabled');
 const binding={runId:event.runId,stepId:event.stepId,sessionId:event.sessionId,turnId:event.turnId};
 if(j!.activityBinding)need(JSON.stringify(j!.activityBinding)===JSON.stringify(binding),409,'Activity turn changed');
 const old=store.get('agentActivity',event.eventId);
 if(old){need(old.fingerprint===fingerprint&&old.jobId===j!.id,409,'Activity receipt conflict');return {ok:true};}
 const prior=store.all('agentActivity').filter(a=>a.jobId===j!.id);
 need(prior.length<257&&!prior.some(a=>a.sequence===event.sequence),409,'Activity sequence conflict');
 store.put('job',{...j!,activityBinding:binding});
 store.put('agentActivity',{id:event.eventId,jobId:j!.id,sequence:event.sequence,timestamp:event.timestamp,type:event.type,content:event.content,fingerprint});
 return {ok:true};
});}
export function activityForJob(store:Store,j:Row){return store.all('agentActivity').filter(a=>a.jobId===j.id).sort((a,b)=>a.sequence-b.sequence).map(({id,sequence,timestamp,type,content})=>({id,sequence,timestamp,type,content}));}
