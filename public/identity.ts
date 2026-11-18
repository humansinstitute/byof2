import {verifyEvent, type Event} from 'nostr-tools';

export const PROFILE_RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'] as const;
export type NostrProfile = {name:string;avatar:string;event:Event};

export function verifiedProfile(event:unknown,pubkey:string,now=Math.floor(Date.now()/1000)):NostrProfile|null {
 try {
  const value=event as Event;
  if(value.kind!==0||value.pubkey!==pubkey||!Number.isSafeInteger(value.created_at)||value.created_at<0||value.created_at>now+300||value.content.length>200000||!verifyEvent(value))return null;
  const profile=JSON.parse(value.content);
  if(!profile||typeof profile!=='object'||Array.isArray(profile))return null;
  const name=typeof profile.display_name==='string'&&profile.display_name.trim()?profile.display_name:typeof profile.name==='string'?profile.name:'';
  const picture=typeof profile.picture==='string'?profile.picture:'';
  let avatar='';try {const url=new URL(picture);if(url.protocol==='https:')avatar=url.href;}catch {}
  return {name:name.trim().slice(0,100),avatar,event:value};
 }catch{return null;}
}

export function newestProfile(profiles:Array<NostrProfile|null>):NostrProfile|null {
 return profiles.filter((p):p is NostrProfile=>Boolean(p)).sort((a,b)=>b.event.created_at-a.event.created_at||a.event.id.localeCompare(b.event.id))[0]||null;
}

function relayProfile(relay:string,pubkey:string):Promise<NostrProfile|null> {
 return new Promise(resolve=>{
  let ws:WebSocket|undefined;let result:NostrProfile|null=null;let done=false;
  const sub=crypto.randomUUID();
  const finish=()=>{if(done)return;done=true;clearTimeout(timer);try{if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(['CLOSE',sub]));ws?.close();}catch{}resolve(result);};
  const timer=setTimeout(finish,4000);
  try {
   ws=new WebSocket(relay);
   ws.onopen=()=>ws!.send(JSON.stringify(['REQ',sub,{kinds:[0],authors:[pubkey],limit:3}]));
   ws.onmessage=({data})=>{if(typeof data!=='string'||data.length>220000)return;try{const message=JSON.parse(data);if(message[1]!==sub)return;if(message[0]==='EVENT')result=newestProfile([result,verifiedProfile(message[2],pubkey)]);else if(message[0]==='EOSE'||message[0]==='CLOSED')finish();}catch{}};
   ws.onerror=finish;ws.onclose=finish;
  }catch{finish();}
 });
}

export async function readNostrProfile(pubkey:string):Promise<NostrProfile|null> {
 if(!/^[a-f0-9]{64}$/.test(pubkey))return null;
 const key=`byo-freedom.nostr-profile.v1.${pubkey}`;
 let cached:NostrProfile|null=null;try{cached=verifiedProfile(JSON.parse(localStorage.getItem(key)||'null'),pubkey);}catch{}
 const profiles=await Promise.all(PROFILE_RELAYS.map(relay=>relayProfile(relay,pubkey)));
 const profile=newestProfile([cached,...profiles]);
 if(profile)try{localStorage.setItem(key,JSON.stringify(profile.event));}catch{}
 return profile;
}

export function isChatSubmitKey(event:{key:string;shiftKey?:boolean;isComposing?:boolean;keyCode?:number},composing=false,lastCompositionEnd=0,now=Date.now()):boolean {
 return event.key==='Enter'&&!event.shiftKey&&!event.isComposing&&event.keyCode!==229&&!composing&&(!lastCompositionEnd||now-lastCompositionEnd>=50);
}
