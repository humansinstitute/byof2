type Api=(path:string,method?:string,data?:Record<string,any>)=>Promise<any>;
type ImageReference={id:string;name:string;mimeType:string;bytes:number;sha256:string};
const escape=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const key=(id:string)=>`byo-freedom.images.${id}`;
const uploading=new Set<string>();
const uploadStatus=new Map<string,string>();
let unmountDraftListener=()=>{};
const notify=(id:string)=>document.dispatchEvent(new CustomEvent('byo-image-drafts',{detail:id}));
export function draftImages(id:string):ImageReference[]{try{const value=JSON.parse(localStorage.getItem(key(id))??'[]');return Array.isArray(value)?value.filter(i=>typeof i.id==='string'&&typeof i.name==='string'&&['image/png','image/jpeg'].includes(i.mimeType)).slice(0,2):[];}catch{return [];}}
export function clearDraftImages(id:string){localStorage.removeItem(key(id));uploadStatus.delete(id);notify(id);}
export function imageUploadBusy(id:string){return uploading.has(id);}
export function imageComposer(id:string,enabled:boolean,working:boolean){
 if(!enabled)return '';
 return `<div class="interview-images" data-interview-images><div data-image-drafts></div><div class="image-toolbar"><button type="button" class="small ghost" data-select-image aria-label="Attach private reference images" ${working||uploading.has(id)?'disabled':''}>＋ Image</button><input class="visually-hidden" type="file" data-image-upload accept="image/png,image/jpeg,image/webp" multiple aria-label="Choose private reference images" ${working||uploading.has(id)?'disabled':''}><span class="help" data-image-status role="status">${escape(uploadStatus.get(id)||(uploading.has(id)?'Uploading private image…':'Paste an image here · up to two private images'))}</span></div></div>`;
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
 unmountDraftListener();
 document.querySelectorAll<HTMLElement>('[data-view-image]').forEach(button=>button.addEventListener('click',async()=>{
  button.setAttribute('disabled','');
  try{const image=await api(`/api/designs/${id}/images/${encodeURIComponent(button.dataset.viewImage!)}`);if(!['image/png','image/jpeg'].includes(image.mimeType)||typeof image.base64!=='string'||!/^[A-Za-z0-9+/=]+$/.test(image.base64)||image.base64.length>2800000)throw Error('Image response is invalid.');modal('Private reference image',`<img alt="Participant reference" src="data:${image.mimeType};base64,${image.base64}" style="max-width:100%;height:auto">`);}
  catch(error){modal('Image unavailable',`<p>${escape((error as Error).message)}</p>`);}finally{button.removeAttribute('disabled');}
 }));
 if(!enabled)return;
 const form=document.querySelector<HTMLFormElement>('#message-form');if(!form)return;
 const input=form.querySelector<HTMLInputElement>('[data-image-upload]')!;
 const message=form.querySelector<HTMLTextAreaElement>('#message-input')!;
 const status=form.querySelector<HTMLElement>('[data-image-status]')!;
 const thumbnails=new Map<string,string>();
 const render=()=>{
  if(!form.isConnected)return;
  message.required=draftImages(id).length===0;
  const target=form.querySelector('[data-image-drafts]')!;
  target.innerHTML=draftImages(id).map(i=>`<div class="image-draft"><button type="button" class="image-preview" data-preview-image="${escape(i.id)}" aria-label="Preview ${escape(i.name)}"><img alt="${escape(i.name)}" ${thumbnails.has(i.id)?`src="${thumbnails.get(i.id)}"`:''}></button><span class="help">${escape(i.name)}</span><button type="button" class="small ghost" data-remove-image="${escape(i.id)}" aria-label="Remove ${escape(i.name)}" ${working?'disabled':''}>Remove</button></div>`).join('');
  target.querySelectorAll<HTMLElement>('[data-remove-image]').forEach(button=>button.addEventListener('click',()=>{localStorage.setItem(key(id),JSON.stringify(draftImages(id).filter(i=>i.id!==button.dataset.removeImage)));if(!draftImages(id).length&&!uploading.has(id)){uploadStatus.delete(id);status.textContent='Paste an image here · up to two private images';}render();}));
  target.querySelectorAll<HTMLElement>('[data-preview-image]').forEach(button=>button.addEventListener('click',()=>{const src=thumbnails.get(button.dataset.previewImage!);if(src)modal('Private reference image',`<img alt="Private reference" src="${src}" style="max-width:100%">`);}));
 };
 const loadThumbnails=async()=>{for(const i of draftImages(id)){if(thumbnails.has(i.id))continue;try{const image=await api(`/api/designs/${id}/images/${encodeURIComponent(i.id)}`);if(!['image/png','image/jpeg'].includes(image.mimeType)||typeof image.base64!=='string'||!/^[A-Za-z0-9+/=]+$/.test(image.base64)||image.base64.length>2800000)throw Error('Invalid image');thumbnails.set(i.id,`data:${image.mimeType};base64,${image.base64}`);render();}catch{if(form.isConnected)status.textContent='Preview unavailable. Remove and reattach the image, or retry after reconnecting.';}}};
 render();void loadThumbnails();
 form.querySelector('[data-select-image]')?.addEventListener('click',()=>input.click());
 const update=()=>{if(!form.isConnected){document.removeEventListener('byo-image-drafts',changed);return;}render();void loadThumbnails();input.disabled=working||uploading.has(id);form.querySelector<HTMLButtonElement>('[data-select-image]')!.disabled=input.disabled;form.querySelector<HTMLButtonElement>('[type=submit]')!.disabled=input.disabled;if(uploadStatus.has(id))status.textContent=uploadStatus.get(id)!;};
 const changed=(event:Event)=>{if((event as CustomEvent).detail===id)update();};document.addEventListener('byo-image-drafts',changed);unmountDraftListener=()=>document.removeEventListener('byo-image-drafts',changed);
 const report=(text:string)=>{uploadStatus.set(id,text);notify(id);};
 const upload=async(files:File[])=>{
  if(!files.length||working||uploading.has(id))return;
  if(draftImages(id).length+files.length>2){report('Choose at most two images per message.');input.value='';return;}
  uploading.add(id);input.disabled=true;const select=form.querySelector<HTMLButtonElement>('[data-select-image]')!;select.disabled=true;
  const submit=form.querySelector<HTMLButtonElement>('[type=submit]')!;submit.disabled=true;
  try{for(const file of files){report('Uploading private image…');const image=await api(`/api/designs/${id}/images`,'POST',await normaliseImage(file));localStorage.setItem(key(id),JSON.stringify([...draftImages(id),image]));render();}report('Images ready. Send your message when you are ready.');}
  catch(error){report((error as Error).message);}
  finally{uploading.delete(id);input.disabled=working;select.disabled=working;input.value='';submit.disabled=working;notify(id);}
 };
 input.addEventListener('change',()=>void upload(Array.from(input.files??[])));
 message.addEventListener('paste',event=>{
  const files=Array.from(event.clipboardData?.items??[]).filter(item=>item.kind==='file'&&item.type.startsWith('image/')).map(item=>item.getAsFile()).filter((file):file is File=>!!file);
  if(!files.length)return;
  event.preventDefault();
  // Preserve accompanying text in mixed clipboard contents as well as the image.
  const text=event.clipboardData?.getData('text/plain');if(text){message.setRangeText(text,message.selectionStart,message.selectionEnd,'end');message.dispatchEvent(new Event('input',{bubbles:true}));}
  void upload(files);
 });
}
