import {lookup} from 'node:dns/promises';
import {request} from 'node:https';
import {isPrivateHost} from './nstack';
import {need,HttpError} from './auth';

/** Resolve once, validate every address, and pin TLS connection lookup to that public address. */
export function createPublicNStackFetch(resolveHost:typeof lookup=lookup,httpsRequest:typeof request=request):typeof fetch{return (async(input:any,init:RequestInit={})=>{
 const url=new URL(String(input));need(url.protocol==='https:'&&!url.username&&!url.password,400,'Public HTTPS NStack required');
 const addresses=await resolveHost(url.hostname,{all:true});need(addresses.length&&addresses.every(a=>!isPrivateHost(a.address)),400,'NStack resolves to a private network');const pinned=addresses[0]!;
 return new Promise<Response>((resolve,reject)=>{
  const headers=Object.fromEntries(new Headers(init.headers));
  const req=httpsRequest(url,{method:init.method||'GET',headers,agent:false,signal:init.signal||AbortSignal.timeout(12000),lookup:((_host:any,options:any,callback:any)=>options?.all?callback(null,[pinned]):callback(null,pinned.address,pinned.family)) as any},res=>{
   const chunks:Buffer[]=[];let bytes=0;
   res.on('data',chunk=>{bytes+=chunk.length;if(bytes>8*1024*1024){req.destroy(new HttpError(502,'NStack response exceeded bounds'));return;}chunks.push(Buffer.from(chunk));});
   res.on('error',reject);res.on('end',()=>{const responseHeaders=new Headers();for(const [name,value] of Object.entries(res.headers))if(value!==undefined)responseHeaders.set(name,Array.isArray(value)?value.join(', '):String(value));const status=res.statusCode||502;resolve(new Response([204,205,304].includes(status)?null:Buffer.concat(chunks),{status,headers:responseHeaders}));});
  });
  req.on('error',reject);if(init.body!==undefined&&init.body!==null){need(typeof init.body==='string',400,'Exact string NStack request body required');req.write(init.body);}req.end();
 });
}) as typeof fetch;}
export const publicNStackFetch=createPublicNStackFetch();
