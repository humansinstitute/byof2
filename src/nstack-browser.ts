import {publicNStackFetch} from './nstack-http';
import {AsyncLocalStorage} from 'node:async_hooks';
import {verifyEvent} from 'nostr-tools';
import {hash,need,HttpError} from './auth';
import {boundedNStackText,type NStackConnection,type NStackTransport,type NStackRequest} from './nstack';

export const browserTransport=new AsyncLocalStorage<NStackTransport>();
export const BYO_APP_NPUB='npub1uzczf3p5c9j36hqlyqj5gzl47th3kp4yqz03y5tswkd0y7ucemhs7rf22j';
type Challenge={id:string;url:string;method:string;body?:string};
export type DiscoveryConnection={endpoint:string;serviceNpub:string;mode:'discovery'|'interview-images';workspaceId?:string;workspaceAppNpub?:string};
type Operation={id:string;actor:string;connection:NStackConnection|DiscoveryConnection;expires:number;challenge?:Challenge;resolve?:(r:Response)=>void;reject?:(e:Error)=>void;wake?:()=>void;done?:boolean;result?:any;error?:any;count:number;guard?:()=>void};
/** Only server-generated, ACL-checked operations can request authorization. No URL or body from authorize is executed. */
export function createBrowserOperations(fetcher:typeof fetch=publicNStackFetch){
 const operations=new Map<string,Operation>();
 function clean(){for(const [id,o] of operations)if(o.expires<Date.now()){o.reject?.(new HttpError(410,'Authorization expired; retry the operation'));operations.delete(id);}}
 async function output(o:Operation):Promise<any>{
  if(!o.challenge&&!o.done)await new Promise<void>(resolve=>{o.wake=resolve;});
  if(o.error)throw o.error;
  if(o.done){operations.delete(o.id);return {done:true,result:o.result};}
  return {operationId:o.id,connection:o.connection,challenge:o.challenge};
 }
 async function start(actor:string,connection:NStackConnection|DiscoveryConnection,run:(transport:NStackTransport)=>Promise<any>,guard?:()=>void){
  clean();need(operations.size<100,429,'Too many pending authorizations');const o:Operation={id:crypto.randomUUID(),actor,connection,expires:Date.now()+180000,count:0,guard};operations.set(o.id,o);
  const transport:NStackTransport=async(c,r)=>{
   need(JSON.stringify(c)===JSON.stringify(connection),409,'Operation connection changed');need(++o.count<=64,413,'Operation exceeds request bound');
   const root=`/api/v4/flightdeck-pg/workspaces/${c.workspaceId}`;
   need(connection.mode==='interview-images'?(r.path===root+'/storage/prepare'||/^\/api\/v4\/storage\/[0-9a-f-]{36}(?:\/complete)?$/.test(r.path)):connection.mode==='discovery'?(r.method==='GET'&&(r.path.startsWith('/api/v4/flightdeck-pg/workspaces?')||r.path===root+'/me')):r.path===root+'/me'||r.path.startsWith(root+'/connection-proof?nonce=')||r.path.startsWith(root+`/apps/${BYO_APP_NPUB}/`),403,'Unsupported browser authority request');
   need((connection.mode==='interview-images'?['GET','POST','PUT']:['GET','POST']).includes(r.method),403,'Unsupported browser authority method');
   const body=r.body===undefined?undefined:JSON.stringify(r.body);o.challenge={id:crypto.randomUUID(),url:c.endpoint+r.path,method:r.method,...(body===undefined?{}:{body})};
   return new Promise<Response>((resolve,reject)=>{const timer=setTimeout(()=>reject(new HttpError(410,'Browser authorization timed out; retry')),120000);timer.unref?.();o.resolve=r=>{clearTimeout(timer);resolve(r)};o.reject=e=>{clearTimeout(timer);reject(e)};o.wake?.();o.wake=undefined;});
  };
  void browserTransport.run(transport,()=>run(transport)).then(result=>{o.result=result;o.done=true;o.wake?.();},error=>{o.error=error;o.done=true;o.wake?.();});return output(o);
 }
 async function authorize(actor:string,b:any){
  clean();const o=operations.get(b.operationId);need(o&&o.actor===actor,404,'Pending operation not found');const op=o!;const c=op.challenge;need(c&&c.id===b.challengeId,409,'Authorization challenge changed');
  const e=b.event;need(e?.kind===27235&&e.pubkey===actor&&verifyEvent(JSON.parse(JSON.stringify(e))),401,'Exact browser actor signature required');
  const tag=(name:string)=>{const t=e.tags.filter((t:any)=>t[0]===name);need(t.length===1&&t[0].length===2,401,'Invalid authorization tags');return t[0][1];};
  need(tag('byo-challenge')===c!.id&&tag('u')===c!.url&&tag('method')===c!.method&&Math.abs(Date.now()/1000-e.created_at)<=60&&e.content==='',401,'Authorization does not match pending request');
  if(c!.body!==undefined)need(tag('payload')===hash(c!.body),401,'Authorization payload mismatch');
  // Clear before I/O: a concurrent replay cannot execute this challenge twice.
  op.guard?.();op.challenge=undefined;const resolve=op.resolve!;op.resolve=undefined;
  try{const response=await fetcher(c!.url,{method:c!.method,body:c!.body,redirect:'error',signal:AbortSignal.timeout(12000),headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(e)).toString('base64'),'content-type':'application/json',...(op.connection.workspaceAppNpub?{'x-flightdeck-pg-app-npub':op.connection.workspaceAppNpub}:op.connection.mode==='discovery'?{}:{'x-flightdeck-pg-app-npub':BYO_APP_NPUB})}});const text=await boundedNStackText(response,8*1024*1024);resolve(new Response(text,{status:response.status,headers:{'content-type':'application/json'}}));}catch(error){op.reject?.(error as Error);}
  return output(op);
 }
 return {start,authorize};
}
