import {verifyEvent,nip19} from 'nostr-tools';
import type {Store} from './store';
export const ADMINS=['npub1jss47s4fvv6usl7tn6yp5zamv2u60923ncgfea0e6thkza5p7c3q0afmzy','npub1llwrq3rtah3rg3r2dyfyht55ek7aa0ey7z47ujju407pzfp38shqa7zcvr'].map(n=>nip19.decode(n).data as string);
export class HttpError extends Error {constructor(public status:number,message:string){super(message);}}
export const need=(v:any,status=400,message='Invalid request')=>{if(!v)throw new HttpError(status,message);};
export const hash=(s:string|Uint8Array)=>new Bun.CryptoHasher('sha256').update(s).digest('hex');
export function authenticate(req:Request,body:string,origins:string|readonly string[],store:Store){
 const h=req.headers.get('authorization');need(h?.startsWith('Nostr '),401,'NIP-98 authorization required');
 let e:any;try{e=JSON.parse(Buffer.from(h!.slice(6),'base64').toString());}catch{throw new HttpError(401,'Invalid authorization');}
 need(e.kind===27235 && verifyEvent(e),401,'Invalid signature');
 const tag=(name:string)=>{const ts=e.tags.filter((t:any)=>t[0]===name);need(ts.length===1&&ts[0].length===2,401,'Invalid authorization tags');return ts[0][1];};
 const url=new URL(req.url);need((typeof origins==='string'?[origins]:origins).some(origin=>tag('u')===origin+url.pathname+url.search),401,'URL mismatch');need(tag('method')===req.method,401,'Method mismatch');need(Math.abs(Date.now()/1000-e.created_at)<=60,401,'Expired authorization');
 if(body.length||['POST','PATCH','PUT','DELETE'].includes(req.method))need(tag('payload')===hash(body),401,'Body hash mismatch');
 try{store.replay(e.id,(e.created_at+61)*1000);}catch{throw new HttpError(409,'Authorization replay');}return e.pubkey as string;
}
