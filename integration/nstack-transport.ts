import {constants,openSync,fstatSync,readFileSync,closeSync} from 'node:fs';
import {HttpError,need} from '../src/auth';
import type {NStackTransport} from '../src/nstack';

/** Server-only capability. It is never a Nostr key or an authority returned to a browser. */
export function readGatewayToken(path:string){let fd:number|undefined;try{fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);const stat=fstatSync(fd);need(stat.isFile()&&stat.size<=1024&&(stat.mode&0o077)===0&&stat.uid===process.geteuid?.(),503,'Storage capability file is unavailable');const token=readFileSync(fd,'utf8').trim();need(/^[A-Za-z0-9_-]{43,128}$/.test(token),503,'Storage capability is invalid');return token;}finally{if(fd!==undefined)closeSync(fd);}}
export async function boundedJson(response:Response,max=2*1024*1024){need(response.body,502,'Empty storage response');const reader=response.body!.getReader();const chunks:Uint8Array[]=[];let size=0;try{while(true){const p=await reader.read();if(p.done)break;size+=p.value.byteLength;if(size>max){await reader.cancel();throw new HttpError(502,'Storage response exceeds limit');}chunks.push(p.value);}try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(502,'Invalid storage JSON');}}finally{reader.releaseLock();}}
export function createManagedNStackTransport(env:Record<string,string|undefined>=process.env,fetchImpl:typeof fetch=fetch):NStackTransport|undefined{
 const endpoint=env.BYO_NSTACK_GATEWAY_URL,path=env.BYO_NSTACK_GATEWAY_TOKEN_FILE;
 if(!endpoint||!path)return undefined;
 const url=new URL(endpoint);need(url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/v1/data',503,'Exact HTTPS storage gateway URL required');
 return async(connection,request)=>{const token=readGatewayToken(path);let response:Response;try{response=await fetchImpl(url,{method:'POST',redirect:'manual',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({connection,request}),signal:AbortSignal.timeout(20000)});}catch{throw new HttpError(502,'Managed storage gateway unavailable');}need(response.status<300||response.status>=400,502,'Storage gateway redirect denied');const body=await boundedJson(response);return Response.json(body,{status:response.status});};
}
