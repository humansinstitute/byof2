import {finalizeEvent,getPublicKey,nip19,nip44} from 'nostr-tools';
import {IdentityVault} from './identity-vault';
export const MODE='byo-freedom.signer.v1',SIGNED_OUT='byo-freedom.signed-out.v1';
type Template=Record<string,any>;
declare global {interface Window {nostr?:{getPublicKey():Promise<string>;signEvent(event:Template):Promise<any>;nip44?:{decrypt(pubkey:string,ciphertext:string):Promise<string>}}}}

export class BrowserIdentity {
 private vault=new IdentityVault();
 private startup?:Promise<void>;
 savedPubkey:string|null=null;
 error='';
 get mode(){try{return localStorage.getItem(MODE);}catch{return null;}}
 get active(){try{return localStorage.getItem(SIGNED_OUT)!=='true'&&(this.mode==='extension'||this.mode==='anonymous'&&!this.error&&!!this.savedPubkey);}catch{return false;}}
 initialize(){return this.startup??=this.start();}
 private async start(){
  try{
   const mode=localStorage.getItem(MODE);
   if(mode!==null&&mode!=='anonymous'&&mode!=='extension')throw Error('Saved signer choice is invalid. Reconnect your signer or recover your identity; no replacement was created.');
   this.savedPubkey=await this.vault.initialize();
   const currentMode=localStorage.getItem(MODE);
   if(!currentMode&&this.savedPubkey)localStorage.setItem(MODE,'anonymous');
   if(currentMode==='anonymous'&&!this.savedPubkey)throw Error('Your saved browser identity is missing. Restore your recovery key; no replacement was created.');
  }catch(error){this.error=error instanceof DOMException?'Browser storage is unavailable. Enable storage and reload, or restore your recovery key in another browser profile. No replacement identity was created.':(error as Error).message;}
 }
 private async extension(){
  for(let i=0;!window.nostr&&i<20;i++)await new Promise(resolve=>setTimeout(resolve,100));
  if(!window.nostr)throw Error('Your Nostr signer is unavailable. Open this page in your signer’s browser or reconnect it.');
  return window.nostr;
 }
 async connectBrowser(){
  await this.initialize();if(this.error)throw Error(this.error);
  // A remembered extension must never turn into a new browser account.
  if(this.mode==='extension'&&!this.savedPubkey)throw Error('Reconnect your Nostr signer or restore its recovery key. No browser identity was created.');
  if(this.savedPubkey||this.mode==='anonymous'){
   const restored=await this.vault.use(key=>getPublicKey(key));
   if(this.savedPubkey&&restored!==this.savedPubkey)throw Error('The saved identity changed. Reload to reconnect; no replacement was created.');
   this.savedPubkey=restored;
  }else this.savedPubkey=await this.vault.create();
  localStorage.setItem(MODE,'anonymous');localStorage.removeItem(SIGNED_OUT);
 }
 async connectExtension(){const signer=await this.extension();await signer.getPublicKey();localStorage.setItem(MODE,'extension');localStorage.removeItem(SIGNED_OUT);}
 signOut(){localStorage.setItem(SIGNED_OUT,'true');}
 async importRecovery(value:string){
  await this.initialize();if(this.error)throw Error(this.error);
  const decoded=nip19.decode(value);if(decoded.type!=='nsec')throw Error('Please enter an nsec recovery key.');
  const secret=new Uint8Array(decoded.data);
  try{this.savedPubkey=await this.vault.import(secret);}finally{secret.fill(0);decoded.data.fill(0);}
  localStorage.setItem(MODE,'anonymous');localStorage.removeItem(SIGNED_OUT);
 }
 get canExportLegacy(){try{return this.vault.useLegacy(()=>true);}catch{return false;}}
 async exportRecovery(){if(this.error&&this.canExportLegacy)return this.vault.useLegacy(key=>nip19.nsecEncode(key));if(this.mode==='extension')throw Error('Your Nostr signer manages this account’s recovery key.');return this.vault.use(key=>nip19.nsecEncode(key));}
 async sign(event:Template){
  await this.initialize();if(!this.active)throw Error(this.error||'Please reconnect your saved identity.');
  if(event.kind===0)throw Error('BYO Freedom never publishes Nostr profiles.');
  if(this.mode==='extension')return (await this.extension()).signEvent(event);
  return this.vault.use(key=>finalizeEvent(event as any,key));
 }
 signer(){return {
  getPublicKey:async()=>{await this.initialize();if(!this.active)throw Error(this.error||'Please reconnect your saved identity.');return this.mode==='extension'?(await this.extension()).getPublicKey():this.vault.use(key=>getPublicKey(key));},
  signEvent:(event:Template)=>this.sign(event),
  nip44:{decrypt:async(pubkey:string,ciphertext:string)=>{
   await this.initialize();if(!this.active)throw Error(this.error||'Please reconnect your saved identity.');
   if(this.mode==='extension'){const signer=await this.extension();if(!signer.nip44)throw Error('Your signer does not support NIP-44.');return signer.nip44.decrypt(pubkey,ciphertext);}
   return this.vault.use(key=>{const conversation=nip44.v2.utils.getConversationKey(key,pubkey);try{return nip44.v2.decrypt(ciphertext,conversation);}finally{conversation.fill(0);}});
  }}
 };}
}
