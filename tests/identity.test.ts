import {expect,test} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey,type Event} from 'nostr-tools';
import {verifiedProfile,newestProfile,readNostrProfile,isChatSubmitKey,PROFILE_RELAYS} from '../public/identity';

const secret=generateSecretKey();const pubkey=getPublicKey(secret);const now=1900000000;
const profile=(content:unknown,created_at=now,kind=0,key=secret)=>finalizeEvent({kind,created_at,tags:[],content:typeof content==='string'?content:JSON.stringify(content)},key);
const detached=(event:Event):Event=>JSON.parse(JSON.stringify(event));

test('signed kind0 profile supplies display name and HTTPS avatar with name fallback',()=>{
 const event=profile({name:'fallback',display_name:'  Freedom ₿uilder  ',picture:'https://images.example/avatar.png'});
 const result=verifiedProfile(detached(event),pubkey,now);expect(result?.name).toBe('Freedom ₿uilder');expect(result?.avatar).toBe('https://images.example/avatar.png');expect(result?.event.id).toBe(event.id);
 expect(verifiedProfile(detached(profile({name:'Satoshi',display_name:'  '})),pubkey,now)?.name).toBe('Satoshi');
 expect(verifiedProfile(detached(profile({name:'x'.repeat(101)})),pubkey,now)?.name).toHaveLength(100);
});

test('profile import rejects wrong identity, wrong kind, altered content, bad signature and malformed JSON',()=>{
 const valid=detached(profile({display_name:'Authentic'}));
 expect(verifiedProfile(valid,getPublicKey(generateSecretKey()),now)).toBeNull();
 expect(verifiedProfile(detached(profile({name:'Signed but wrong kind'},now,1)),pubkey,now)).toBeNull();
 expect(verifiedProfile({...detached(valid),content:JSON.stringify({name:'Tampered'})},pubkey,now)).toBeNull();
 expect(verifiedProfile({...detached(valid),sig:'0'.repeat(128)},pubkey,now)).toBeNull();
 expect(verifiedProfile(detached(profile('{invalid json')),pubkey,now)).toBeNull();
 for(const content of ['null','[]','"a string"'])expect(verifiedProfile(detached(profile(content)),pubkey,now)).toBeNull();
 expect(verifiedProfile(null,pubkey,now)).toBeNull();
 expect(verifiedProfile(detached(profile({name:'Future'},now+301)),pubkey,now)).toBeNull();
 expect(verifiedProfile(detached(profile({name:'Allowed clock skew'},now+300)),pubkey,now)?.name).toBe('Allowed clock skew');
});

test('unsafe or malformed picture values never become an avatar URL',()=>{
 for(const picture of ['javascript:alert(1)','data:image/svg+xml,<svg/>','http://images.example/avatar.png','file:///private/avatar.png','not a URL',42]){
  const result=verifiedProfile(detached(profile({name:'Safe name',picture})),pubkey,now);expect(result?.name).toBe('Safe name');expect(result?.avatar).toBe('');
 }
});

test('newest verified profile wins regardless of relay arrival order, with deterministic ties',()=>{
 const older=verifiedProfile(detached(profile({name:'Older'},now-10)),pubkey,now)!;
 const newer=verifiedProfile(detached(profile({name:'Newer'},now)),pubkey,now)!;
 expect(newestProfile([newer,null,older])?.name).toBe('Newer');expect(newestProfile([older,newer])?.name).toBe('Newer');expect(newestProfile([null])).toBeNull();
 const equal=verifiedProfile(detached(profile({name:'Other newest'},now)),pubkey,now)!;
 const expected=[newer,equal].sort((a,b)=>a.event.id.localeCompare(b.event.id))[0];expect(newestProfile([equal,newer])?.event.id).toBe(expected.event.id);
});

test('Enter submits, Shift Enter preserves newline, and IME completion never submits accidentally',()=>{
 expect(isChatSubmitKey({key:'Enter'},false,0,1000)).toBe(true);
 expect(isChatSubmitKey({key:'Enter',shiftKey:true},false,0,1000)).toBe(false);
 expect(isChatSubmitKey({key:'Enter',isComposing:true},false,0,1000)).toBe(false);
 expect(isChatSubmitKey({key:'Enter'},true,0,1000)).toBe(false);
 expect(isChatSubmitKey({key:'Enter',keyCode:229},false,0,1000)).toBe(false);
 expect(isChatSubmitKey({key:'Enter'},false,980,1000)).toBe(false);
 expect(isChatSubmitKey({key:'Enter'},false,950,1000)).toBe(true);
 expect(isChatSubmitKey({key:'Escape'},false,0,1000)).toBe(false);
});

test('relay lookup only subscribes to the requested author kind0 and never publishes a profile event',async()=>{
 const originalWebSocket=globalThis.WebSocket;const storageDescriptor=Object.getOwnPropertyDescriptor(globalThis,'localStorage');
 const sent:{relay:string;message:any[]}[]=[];const cache=new Map<string,string>();
 const event=profile({display_name:'Existing relay profile',picture:'https://images.example/existing.png'},Math.floor(Date.now()/1000));
 class ReadOnlyRelay {
  static OPEN=1;readyState=1;onopen:(()=>void)|null=null;onmessage:((event:{data:string})=>void)|null=null;onerror:(()=>void)|null=null;onclose:(()=>void)|null=null;
  constructor(public relay:string){queueMicrotask(()=>this.onopen?.());}
  send(data:string){const message=JSON.parse(data);sent.push({relay:this.relay,message});if(message[0]==='REQ'){queueMicrotask(()=>{this.onmessage?.({data:JSON.stringify(['EVENT',message[1],event])});this.onmessage?.({data:JSON.stringify(['EOSE',message[1]])});});}}
  close(){this.readyState=3;}
 }
 try{
  globalThis.WebSocket=ReadOnlyRelay as any;Object.defineProperty(globalThis,'localStorage',{configurable:true,value:{getItem:(key:string)=>cache.get(key)||null,setItem:(key:string,value:string)=>cache.set(key,value)}});
  const result=await readNostrProfile(pubkey);expect(result?.name).toBe('Existing relay profile');expect(result?.avatar).toBe('https://images.example/existing.png');
  const subscriptions=sent.filter(s=>s.message[0]==='REQ');expect(subscriptions).toHaveLength(PROFILE_RELAYS.length);
  for(const request of subscriptions){expect(request.message[2]).toEqual({kinds:[0],authors:[pubkey],limit:3});}
  expect(sent.every(s=>['REQ','CLOSE'].includes(s.message[0]))).toBe(true);expect(JSON.parse(cache.get(`byo-freedom.nostr-profile.v1.${pubkey}`)!).id).toBe(event.id);
 }finally{globalThis.WebSocket=originalWebSocket;if(storageDescriptor)Object.defineProperty(globalThis,'localStorage',storageDescriptor);else delete (globalThis as any).localStorage;}
});
