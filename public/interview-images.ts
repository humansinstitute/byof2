type Api=(path:string,method?:string,data?:Record<string,any>)=>Promise<any>;
type ImageReference={id:string;name:string;mimeType:string;bytes:number;sha256:string};
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const key=(id:string)=>`byo-freedom.images.${id}`;
const uploading=new Set<string>();
export function draftImages(id:string):ImageReference[]{try{const value=JSON.parse(localStorage.getItem(key(id))??'[]');return Array.isArray(value)?value.filter(i=>typeof i.id==='string'&&typeof i.name==='string'&&['image/png','image/jpeg'].includes(i.mimeType)).slice(0,2):[];}catch{return [];}}
export function clearDraftImages(id:string){localStorage.removeItem(key(id));}
export function imageUploadBusy(id:string){return uploading.has(id);}
export function imageComposer(id:string,enabled:boolean,working:boolean){
 if(!enabled)return '';
 return `<div class="interview-images" data-interview-images><div data-image-drafts>${draftImages(id).map(i=>`<div class="row"><span class="help">${escape(i.name)} · private image</span><button type="button" class="small ghost" data-remove-image="${escape(i.id)}" ${working?'disabled':''}>Remove</button></div>`).join('')}</div><label class="help">Attach an image <input type="file" data-image-upload accept="image/png,image/jpeg,image/webp" multiple aria-label="Attach private reference images" ${working||uploading.has(id)?'disabled':''}></label><span class="help" data-image-status role="status">${uploading.has(id)?'Uploading private image…':'Up to two private images. Large images are resized for the interview.'}</span></div>`;
}
export function imageReferences(images:unknown){return Array.isArray(images)?images.map(i=>`<button type="button" class="small" data-view-image="${escape(i.id)}">View ${escape(i.name||'reference image')}</button>`).join(' '):'';}
/** Re-encode browser-selected visual pixels: strip metadata and admit no active format. */
export async function normaliseImage(file:File){
 if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>10*1024*1024)throw Error('Choose a PNG, JPEG or WebP image under 10 MB.');
 const bitmap=await createImageBitmap(file);
 try{
  if(!bitmap.width||!bitmap.height||bitmap.width*bitmap.height>40000000)throw Error('This image is too large. Resize it before attaching.');
  const scale=Math.min(1,2048/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));
  const ctx=canvas.getContext('2d');if(!ctx)throw Error('Image processing is unavailable in this browser.');ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const mimeType=file.type==='image/jpeg'?'image/jpeg':'image/png';
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(Error('Image processing failed.')),mimeType,0.9));
  if(blob.size>2*1024*1024)throw Error('This image is still over 2 MB. Resize or simplify it before attaching.');
  const bytes=new Uint8Array(await blob.arrayBuffer());let binary='';for(let offset=0;offset<bytes.length;offset+=8192)binary+=String.fromCharCode(...bytes.subarray(offset,offset+8192));
  const name=(file.name.replace(/\.[^.]+$/,'').replace(/[\x00-\x1f\x7f]/g,'').slice(0,110)||'reference')+(mimeType==='image/jpeg'?'.jpg':'.png');
  return {name,mimeType,base64:btoa(binary)};
 }finally{bitmap.close();}
}
export function mountInterviewImages(api:Api,id:string,enabled:boolean,working:boolean,modal:(title:string,html:string)=>unknown){
 document.querySelectorAll<HTMLElement>('[data-view-image]').forEach(button=>button.addEventListener('click',async()=>{
  button.setAttribute('disabled','');
  try{const image=await api(`/api/designs/${id}/images/${encodeURIComponent(button.dataset.viewImage!)}`);if(!['image/png','image/jpeg'].includes(image.mimeType)||typeof image.base64!=='string'||!/^[A-Za-z0-9+/=]+$/.test(image.base64)||image.base64.length>2800000)throw Error('Image response is invalid.');modal('Private reference image',`<img alt="Participant reference" src="data:${image.mimeType};base64,${image.base64}" style="max-width:100%;height:auto">`);}
  catch(error){modal('Image unavailable',`<p>${escape((error as Error).message)}</p>`);}finally{button.removeAttribute('disabled');}
 }));
 if(!enabled)return;
 const render=()=>{const message=document.querySelector<HTMLTextAreaElement>('#message-input');if(message)message.required=draftImages(id).length===0;const target=document.querySelector('[data-image-drafts]');if(!target)return;target.innerHTML=draftImages(id).map(i=>`<div class="row"><span class="help">${escape(i.name)} · private image</span><button type="button" class="small ghost" data-remove-image="${escape(i.id)}" ${working?'disabled':''}>Remove</button></div>`).join('');target.querySelectorAll<HTMLElement>('[data-remove-image]').forEach(button=>button.addEventListener('click',()=>{localStorage.setItem(key(id),JSON.stringify(draftImages(id).filter(i=>i.id!==button.dataset.removeImage)));render();}));};
 render();
 document.querySelector<HTMLInputElement>('[data-image-upload]')?.addEventListener('change',async event=>{
  const input=event.target as HTMLInputElement,files=Array.from(input.files??[]);if(!files.length||uploading.has(id))return;
  const status=()=>document.querySelector('[data-image-status]');
  if(draftImages(id).length+files.length>2){if(status())status()!.textContent='Choose at most two images per message.';input.value='';return;}
  uploading.add(id);input.disabled=true;const submit=document.querySelector<HTMLButtonElement>('#message-form [type=submit]');if(submit)submit.disabled=true;
  try{for(const file of files){if(status())status()!.textContent='Uploading private image…';const image=await api(`/api/designs/${id}/images`,'POST',await normaliseImage(file));localStorage.setItem(key(id),JSON.stringify([...draftImages(id),image]));render();}if(status())status()!.textContent='Images ready. Send your message when you are ready.';}
  catch(error){if(status())status()!.textContent=(error as Error).message;}
  finally{uploading.delete(id);input.disabled=working;input.value='';const currentSubmit=document.querySelector<HTMLButtonElement>('#message-form [type=submit]');if(currentSubmit)currentSubmit.disabled=working;}
 });
}
