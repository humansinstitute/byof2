/** Share links carry a project code, never an identity or automatic admin access. */
export const INVITE_KEY='byo-freedom.pending-invite.v1';
export function inviteCode(url:URL):string|null{
 let raw:string|null=null;
 if(url.pathname.startsWith('/ic=')){
  try{raw=decodeURIComponent(url.pathname.slice(4));}catch{return null;}
 }else if(url.pathname==='/')raw=url.searchParams.get('ic');
 if(raw===null)return null;
 const code=raw.trim().toUpperCase();
 return code.length>0&&code.length<=100&&!/[\u0000-\u001f\u007f]/.test(code)?code:null;
}
export function inviteUrl(origin:string,code:string){return new URL('/ic='+encodeURIComponent(code.trim().toUpperCase()),origin).href;}
