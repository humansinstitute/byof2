import {generateSecretKey,getPublicKey} from 'nostr-tools';

export const LEGACY_KEY='byo-freedom.identity.v1';
export const VAULT_DB='byo-freedom.identity.v2';
type Envelope={version:2;pubkey:string;wrappingKey:CryptoKey;iv:Uint8Array<ArrayBuffer>;ciphertext:ArrayBuffer};
const recovery='Your saved browser identity could not be opened. No replacement was created. Retry with browser storage enabled, or restore your recovery key in another browser profile. Keep this browser’s data for recovery.';
const request=<T>(r:IDBRequest<T>)=>new Promise<T>((resolve,reject)=>{r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
const completed=(tx:IDBTransaction)=>new Promise<void>((resolve,reject)=>{tx.oncomplete=()=>resolve();tx.onabort=tx.onerror=()=>reject(tx.error||Error('Identity storage transaction failed'));});
const aad=(pubkey:string)=>new TextEncoder().encode(`BYOF browser identity v2:${pubkey}`);
export function legacySecret(hex:string){
 if(!/^[a-fA-F0-9]{64}$/.test(hex))throw Error(recovery);
 const key=Uint8Array.from(hex.match(/../g)!,s=>parseInt(s,16));
 try{getPublicKey(key);return key;}catch{key.fill(0);throw Error(recovery);}
}

// No decrypted secret is cached. Each operation reads the durable envelope afresh.
export class IdentityVault {
 private database?:Promise<IDBDatabase>;
 private open(){return this.database??=new Promise<IDBDatabase>((resolve,reject)=>{
  if(!globalThis.indexedDB||!globalThis.crypto?.subtle){reject(Error(recovery));return;}
  const r=indexedDB.open(VAULT_DB,1);
  r.onupgradeneeded=()=>r.result.createObjectStore('identity');
  r.onerror=()=>reject(Error(recovery));r.onblocked=()=>reject(Error('Close other BYOF tabs and retry opening your saved identity.'));
  r.onsuccess=()=>{r.result.onversionchange=()=>r.result.close();resolve(r.result);};
 });}
 private async read(){const db=await this.open();const tx=db.transaction('identity','readonly');const done=completed(tx);const value=await request(tx.objectStore('identity').get('browser')) as Envelope|undefined;await done;return value;}
 private async decrypt(value:Envelope){
  let secret:Uint8Array<ArrayBuffer>|undefined;
  try{
   if(value.version!==2||value.wrappingKey?.extractable!==false||value.wrappingKey.algorithm.name!=='AES-GCM'||value.iv?.byteLength!==12)throw Error();
   secret=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:value.iv,additionalData:aad(value.pubkey)},value.wrappingKey,value.ciphertext));
   if(secret.length!==32||getPublicKey(secret)!==value.pubkey)throw Error();
   return secret;
  }catch{secret?.fill(0);throw Error(recovery);}
 }
 async use<T>(operation:(secret:Uint8Array<ArrayBuffer>)=>T|Promise<T>):Promise<T>{
  const value=await this.read();if(!value)throw Error(recovery);
  const secret=await this.decrypt(value);try{return await operation(secret);}finally{secret.fill(0);}
 }
 useLegacy<T>(operation:(secret:Uint8Array<ArrayBuffer>)=>T){
  const legacy=localStorage.getItem(LEGACY_KEY);if(legacy===null)throw Error(recovery);
  const secret=legacySecret(legacy);try{return operation(secret);}finally{secret.fill(0);}
 }
 private async locked<T>(operation:()=>Promise<T>){
  if(!navigator.locks)throw Error('This browser cannot safely save an identity. Use a current browser or your Nostr signer.');
  return navigator.locks.request(VAULT_DB,operation);
 }
 private async inspect(){
  const value=await this.read();const legacy=localStorage.getItem(LEGACY_KEY);
  if(value){
   const secret=await this.decrypt(value);secret.fill(0);
   if(legacy!==null){const old=legacySecret(legacy);try{if(getPublicKey(old)!==value.pubkey)throw Error(recovery);}finally{old.fill(0);}localStorage.removeItem(LEGACY_KEY);}
   return value.pubkey;
  }
  if(legacy!==null){if(!navigator.locks)throw Error('This browser cannot safely migrate your saved identity. Use a current browser or export your existing recovery key. No replacement was created.');const secret=legacySecret(legacy);try{return await this.save(secret);}finally{secret.fill(0);}}
  return null;
 }
 async initialize(){try{return await (navigator.locks?this.locked(()=>this.inspect()):this.inspect());}catch(error){throw Error(error instanceof Error&&error.message.includes('browser')?error.message:recovery);}}
 private async save(secret:Uint8Array<ArrayBuffer>){
  const pubkey=getPublicKey(secret);
  const wrappingKey=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(pubkey)},wrappingKey,secret);
  const db=await this.open();const tx=db.transaction('identity','readwrite',{durability:'strict'});const done=completed(tx);
  // add, never put: even a caller without the Web Lock cannot replace an account.
  tx.objectStore('identity').add({version:2,pubkey,wrappingKey,iv,ciphertext} satisfies Envelope,'browser');await done;
  const saved=await this.read();if(!saved||saved.pubkey!==pubkey)throw Error(recovery);
  const readback=await this.decrypt(saved);try{if(readback.some((v,i)=>v!==secret[i]))throw Error(recovery);}finally{readback.fill(0);}
  const legacy=localStorage.getItem(LEGACY_KEY);
  if(legacy!==null){const old=legacySecret(legacy);try{if(getPublicKey(old)!==pubkey)throw Error(recovery);}finally{old.fill(0);}localStorage.removeItem(LEGACY_KEY);}
  void navigator.storage?.persist?.().catch(()=>false);
  return pubkey;
 }
 async create(){return this.locked(async()=>{const existing=await this.inspect();if(existing)return existing;const secret=generateSecretKey() as Uint8Array<ArrayBuffer>;try{return await this.save(secret);}finally{secret.fill(0);}});}
 async import(secret:Uint8Array<ArrayBuffer>){return this.locked(async()=>{
  const existing=await this.inspect();if(existing){if(existing!==getPublicKey(secret))throw Error('This browser already holds a different identity. Use another browser profile to restore this account; export the saved identity before clearing any storage.');return existing;}
  return this.save(secret);
 });}
}
