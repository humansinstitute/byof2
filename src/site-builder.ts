import {ADMINS,HttpError,need,hash} from './auth';
import {Store,type Row} from './store';

import {defaultBrand,validateBrand} from './brand';
import {siteFrameName} from './site-embedding';
const esc=(s:any)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const str=(v:any,max:number,empty=false)=>{need(typeof v==='string'&&v.length<=max&&(empty||v.trim()),400,'Invalid or missing text');return v.trim() as string;};
const pageSlug=(v:any)=>{need(typeof v==='string'&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v)&&v.length<=80,400,'Page addresses use lowercase letters, numbers and single hyphens');return v as string;};
const linkUrl=(v:any)=>{need(typeof v==='string'&&!/[\s\\\u0000-\u001f]/.test(v),400,'Invalid link URL');const s=str(v,2000);need(!/[\s\\\u0000-\u001f]/.test(s),400,'Invalid link URL');if(s.startsWith('/')){need(!s.startsWith('//')&&!s.includes('%')&&!s.split(/[?#]/)[0].split('/').includes('..'),400,'Invalid relative link');return s;}let u:URL;try{u=new URL(s);}catch{throw new HttpError(400,'Links must use HTTPS or a local path');}need(u.protocol==='https:'&&!u.username&&!u.password,400,'Links must use HTTPS');return u.href;};
const documentHeaders={'content-type':'text/html; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer','content-security-policy':"default-src 'none'; frame-src 'self' data: blob:; img-src https: data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"};
const packageCsp="sandbox allow-scripts allow-forms allow-downloads; default-src 'none'; script-src 'unsafe-inline' 'self' data: blob:; style-src 'unsafe-inline' 'self' data:; img-src https: data: blob: 'self'; connect-src https: wss:; font-src 'self' data:; frame-src 'none'; base-uri 'none'; form-action 'none'";
const mime=(file:string)=>file.endsWith('.html')?'text/html':file.endsWith('.js')||file.endsWith('.mjs')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.svg')?'image/svg+xml':'text/plain';

export function createSiteBuilder(store:Store){
 const read=(kind:string,id:string)=>{const r=store.get(kind,id);need(r&&(kind!=='project'||!r.deletedAt),404,'Not found');return r!;};
 const getDraft=(id:string)=>store.get('siteDraft',id)||{id,projectId:id,revision:0,title:read('project',id).title,layout:'simple',brand:defaultBrand(),pages:[],homePageId:null,footerLinks:[]};
 function validate(input:any,projectId:string,previous:Row):Row{
  need(input&&typeof input==='object',400,'Site draft required');const brand=input.brand;need(brand&&typeof brand==='object',400,'Brand required');
  const cleanBrand=validateBrand(brand,previous.brand.revision);const oldBrand=validateBrand(previous.brand,previous.brand.revision);
  cleanBrand.revision=oldBrand.revision+(JSON.stringify(oldBrand)!==JSON.stringify(cleanBrand)?1:0);
  need(['simple','resource-library','event-hub'].includes(input.layout),400,'Invalid site layout');need(Array.isArray(input.pages)&&input.pages.length<=100,400,'At most 100 pages');
  const pages=input.pages.map((p:any)=>{const v=read('version',str(p.artifactVersionId,100));const a=read('artifact',v.artifactId);need(a.projectId===projectId&&v.designId===a.designId&&Array.isArray(v.validation)&&v.validation.length,400,'Select a tested version in this project');return {id:str(p.id,100),artifactVersionId:v.id,slug:pageSlug(p.slug),label:str(p.label,150),visible:p.visible!==false};});
  need(new Set(pages.map((p:any)=>p.id)).size===pages.length&&new Set(pages.map((p:any)=>p.slug)).size===pages.length,400,'Page IDs and addresses must be unique');
  need(input.homePageId===null||pages.some((p:any)=>p.id===input.homePageId),400,'Select a homepage from these pages');
  need(Array.isArray(input.footerLinks)&&input.footerLinks.length<=30,400,'At most 30 footer links');const footerLinks=input.footerLinks.map((l:any)=>({label:str(l.label,150),url:linkUrl(l.url)}));
  return {id:projectId,projectId,revision:previous.revision+1,title:str(input.title,150),layout:input.layout,brand:cleanBrand,pages,homePageId:input.homePageId,footerLinks};
 }
 const state=(id:string)=>{const draft=getDraft(id);return {draft,publications:store.all('siteRelease').filter(r=>r.projectId===id).map(({pages,brand,footerLinks,...r})=>r),publishedReleaseId:store.get('sitePointer',id)?.releaseId||null,artifacts:store.all('artifact').filter(a=>a.projectId===id).map(a=>({...a,versions:store.all('version').filter(v=>v.artifactId===a.id).map(({files,...v})=>({...v,published:a.publishedVersionId===v.id,outdatedBrand:v.brandRevision!==draft.brand.revision||(v.designBrandRevision??v.brandContext?.designBrandRevision??null)!==(store.get('designBrand',a.designId)?.revision??0)}))}))};};
 const expected=(b:any,draft:Row)=>need(Number.isInteger(b.expectedRevision)&&b.expectedRevision===draft.revision,409,'Site draft changed; reload before saving or publishing');
 function handleApi(pk:string,projectId:string,tail:string[],method:string,b:any){
  need(ADMINS.includes(pk),403,'Admin required');read('project',projectId);const action=tail.join('/');
  if(!action&&method==='GET')return state(projectId);
  if(!action&&method==='PUT')return store.transaction(()=>{const prior=getDraft(projectId);expected(b,prior);store.put('siteDraft',validate(b.draft,projectId,prior));return state(projectId);});
  if(action==='preview'&&method==='POST'){const draft=getDraft(projectId);expected(b,draft);if(b.pageId)need(draft.pages.some((p:any)=>p.id===b.pageId),400,'Unknown preview page');return {html:render(draft,null,b.pageId||draft.homePageId,true),revision:draft.revision};}
  if((action==='publish'||action==='rollback')&&method==='POST'){
   const key=str(b.requestId,200);return store.once(`site:${projectId}:${action}:${pk}:${key}`,hash(JSON.stringify(b)),()=>{
    if(action==='rollback'){const release=read('siteRelease',str(b.releaseId,100));need(release.projectId===projectId,404,'Release not found');store.put('sitePointer',{id:projectId,releaseId:release.id});return state(projectId);}
    const draft=getDraft(projectId);expected(b,draft);need(draft.pages.length&&draft.homePageId,400,'Select pages and a homepage before publishing');
    const expose=new Set(Array.isArray(b.exposeVersionIds)?b.exposeVersionIds:[]);
    for(const p of draft.pages){const v=read('version',p.artifactVersionId);const a=read('artifact',v.artifactId);need(a.publishedVersionId===v.id||expose.has(v.id),409,'Confirm publication of every selected private version');}
    const {id:_,...snapshot}=draft;const release=store.add('siteRelease',{...snapshot,sourceRevision:draft.revision,publishedBy:pk});store.put('sitePointer',{id:projectId,releaseId:release.id});return state(projectId);
   });
  }
  throw new HttpError(404,'Unknown Site Builder endpoint');
 }
 function render(site:Row,releaseId:string|null,pageId:string|null,preview=false):string{
  const base=releaseId?`/sites/${site.projectId}/releases/${releaseId}`:`/sites/${site.projectId}`;const b=site.brand;
  const page=site.pages.find((p:any)=>p.id===pageId)||(preview?site.pages[0]:null);const href=(p:any)=>preview?`about:srcdoc#page-${encodeURIComponent(p.id)}`:`${base}/page/${p.slug}/`;
  const nav=site.pages.filter((p:any)=>p.visible).map((p:any)=>`<a ${!preview&&p.id===page?.id?'aria-current="page"':''} href="${esc(href(p))}">${esc(p.label)}</a>`).join('');
  let body='';if(preview){body=site.pages.map((p:any)=>{const v=read('version',p.artifactVersionId);return `<section class="preview-page" ${p.id===page?.id?'data-initial="true"':''} id="page-${esc(p.id)}" aria-label="${esc(p.label)}"><iframe title="${esc(p.label)}" name="${siteFrameName}" sandbox="allow-scripts allow-forms allow-downloads" src="data:text/html;charset=utf-8;base64,${Buffer.from(previewDocument(v.files)).toString('base64')}"></iframe></section>`;}).join('');}else if(page){body=`${store.get('nstackInstallation',page.artifactVersionId)?.enabled===true?`<p style="padding:0 24px;grid-column:1/-1"><a href="/#/apps/${encodeURIComponent(page.artifactVersionId)}" target="_top">Open app to save ↗</a> · Project membership required</p>`:''}<iframe title="${esc(page.label)}" name="${siteFrameName}" sandbox="allow-scripts allow-forms allow-downloads" src="/sites/${site.projectId}/releases/${site.id}/page/${page.slug}/_files/index.html"></iframe>`;}else body=site.pages.filter((p:any)=>p.visible).map((p:any)=>`<a class="page-card" href="${esc(href(p))}">${esc(p.label)} <span aria-hidden="true">↗</span></a>`).join('');
  const collection=site.pages.filter((p:any)=>p.visible).map((p:any)=>`<a class="page-card" ${!preview&&p.id===page?.id?'aria-current="page"':''} href="${esc(href(p))}">${esc(p.label)} <span aria-hidden="true">↗</span></a>`).join('');
  if(site.layout!=='simple'&&!page&&!preview)body=`<section class="site-intro"><p>${site.layout==='resource-library'?'Resource library':'Event hub'}</p><h1>${esc(site.title)}</h1><div class="collection">${collection}</div></section>`+body;
  const font=b.font==='serif'?'Georgia,serif':b.font==='mono'?'ui-monospace,monospace':'system-ui,sans-serif';const radius=b.buttonStyle==='pill'?'999px':b.buttonStyle==='square'?'0':'10px';
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(site.title)}</title><style>*{box-sizing:border-box}html{height:100%}body{height:100dvh;display:flex;flex-direction:column;margin:0;font:16px ${font};background:${b.background};color:${b.text}}header{flex:none;padding:6px 16px;border-bottom:1px solid currentColor;display:flex;gap:16px;align-items:center;min-width:0}.identity{font-size:1rem;font-weight:700;display:flex;align-items:center;gap:8px;min-width:0;max-width:40%;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;min-height:40px;text-decoration:none}.identity span{overflow:hidden;text-overflow:ellipsis}.identity img{max-width:90px;max-height:30px}a{color:inherit}nav{display:flex;gap:4px;overflow-x:auto;min-width:0;align-items:center}nav a{flex:none;white-space:nowrap;font-size:.9rem;min-height:40px;display:flex;align-items:center}nav a,.page-card{padding:8px 12px;border-radius:${radius};text-decoration:none}nav a[aria-current]{background:${b.primary};color:${b.background}}main{flex:1;min-height:0;display:flex;flex-direction:column}main>p{flex:none;margin:8px 0;font-size:.85rem}.site-intro{grid-column:1/-1;padding:16px 24px}.site-intro h1{font-size:clamp(2rem,5vw,4rem);margin:12px 0 24px}.collection{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px}.site-intro .page-card{margin:0}.site-intro p{text-transform:uppercase;letter-spacing:.12em;font-size:.8rem}.page-card{display:block;margin:16px;border:1px solid currentColor;min-height:100px}.page-card span{float:right}iframe{display:block;border:0;background:white;width:100%;flex:1;min-height:0;height:100%}footer{flex:none;padding:4px 16px;display:flex;gap:16px;flex-wrap:wrap;font-size:.8rem}footer a{display:flex;align-items:center;min-height:32px}.preview-note{flex:none;padding:4px 16px;margin:0;font-size:.75rem}.preview-page{display:none;flex:1;min-height:0;flex-direction:column}.preview-page:target,main:not(:has(.preview-page:target)) .preview-page[data-initial]{display:flex}@media(max-width:600px){header{padding:4px 10px;gap:10px}.identity{max-width:34%;font-size:.9rem}.identity img{max-width:40px}nav a{padding:8px;font-size:.82rem}footer{padding:2px 10px}}</style></head><body data-site-layout="${esc(site.layout)}"><header><a class="identity" title="${esc(site.title)}" href="${preview?'about:srcdoc#':base+'/'}">${b.logoUrl?`<img src="${esc(b.logoUrl)}" alt="">`:''}<span>${esc(site.title)}</span></a><nav aria-label="Site navigation">${nav}</nav></header>${preview?'<p class="preview-note">Private draft preview · not published. Choose a page above.</p>':''}<main>${body||'<p style="padding:24px">Add pages to preview your site.</p>'}</main>${site.footerLinks.length?`<footer>${site.footerLinks.map((l:any)=>`<a href="${esc(l.url)}" rel="noopener noreferrer">${esc(l.label)}</a>`).join('')}</footer>`:''}</body></html>`;
 }
 // Private preview packages are embedded into the signed API response, never exposed by a public ticket.
 function previewDocument(files:Record<string,string>){
  const cache=new Map<string,string>();const active=new Set<string>();
  const resolve=(from:string,target:string)=>{if(/^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i.test(target))return null;const u=new URL(target,'https://package.invalid/'+from);if(u.origin!=='https://package.invalid')return null;const name=decodeURIComponent(u.pathname.slice(1));return Object.hasOwn(files,name)?name:null;};
  const data=(name:string):string=>{if(cache.has(name))return cache.get(name)!;if(active.has(name))throw new HttpError(422,'Private preview cannot embed cyclic module imports; review this package through its existing artefact preview');active.add(name);const source=rewrite(name,files[name]);const value=`data:${mime(name)};charset=utf-8;base64,${Buffer.from(source).toString('base64')}`;active.delete(name);cache.set(name,value);return value;};
  const rewrite=(name:string,source:string):string=>{
   if(mime(name)==='text/html')source=source.replace(/<[a-z][^>]*>/gi,tag=>tag.replace(/\b(src|href)\s*=\s*(["'])(.*?)\2/gi,(all,attr,q,target)=>{const to=resolve(name,target);if(!to)return all;if(/^<a\b/i.test(tag)&&attr.toLowerCase()==='href'&&(to===name||active.has(to))){const fragment=new URL(target,'https://package.invalid/'+name).hash;return `${attr}=${q}${fragment||'#'}${q}`;}return `${attr}=${q}${data(to)}${q}`;}));
   if(mime(name)==='text/css'||mime(name)==='text/html')source=source.replace(/url\(\s*(["']?)([^)'"\s]+)\1\s*\)/gi,(all,q,target)=>{const to=resolve(name,target);return to?`url("${data(to)}")`:all;});
   if(mime(name)==='text/javascript')source=source.replace(/\b(from\s*|import\s*\(?\s*)(["'])([^"']+)\2/g,(all,prefix,q,target)=>{const to=resolve(name,target);return to?`${prefix}${q}${data(to)}${q}`:all;});return source;
  };
  return `<meta http-equiv="Content-Security-Policy" content="${esc(packageCsp)}">`+rewrite('index.html',files['index.html']);
 }
 function publicResponse(path:string):Response|undefined{
  const p=path.split('/').filter(Boolean);if(p[0]!=='sites'||!p[1])return;read('project',p[1]);const pointer=store.get('sitePointer',p[1]);
  if(p[2]&&p[2]!=='page'&&p[2]!=='releases')return; // Original contribution addresses remain unchanged.
  if(!pointer&&p[2]!=='releases'){if(p[2]==='page')throw new HttpError(404,'Site is not published');return;}
  let release:Row;let offset=2;let stable=true;
  if(p[2]==='releases'){release=read('siteRelease',p[3]);need(release.projectId===p[1],404,'Release not found');offset=4;stable=false;}else release=read('siteRelease',pointer!.releaseId);
  let page:any;if(p[offset]==='page'){page=release.pages.find((x:any)=>x.slug===p[offset+1]);need(page,404,'Page not found');}else{need(!p[offset],404,'Page not found');page=release.pages.find((x:any)=>x.id===release.homePageId);}
  if(p[offset+2]==='_files'){
   const file=p.slice(offset+3).join('/')||'index.html';const v=read('version',page.artifactVersionId);need(Object.hasOwn(v.files,file),404,'File not found');return new Response(v.files[file],{headers:{...documentHeaders,'content-type':mime(file)+'; charset=utf-8','content-security-policy':packageCsp,'access-control-allow-origin':'*'}});
  }
  need(!p[offset+2],404,'Page not found');return new Response(render(release,stable?null:release.id,page?.id||null),{headers:documentHeaders});
 }
 // Publishing a contribution must update the same site that the project link opens.
 // Copy the current release, never the unsaved draft, so unrelated edits stay private.
 function publishArtifact(pk:string,artifactId:string,versionId:string){
  need(ADMINS.includes(pk),403,'Admin required');
  return store.transaction(()=>{
   const a=read('artifact',artifactId),v=read('version',versionId);read('project',a.projectId);
   need(v.artifactId===a.id&&Array.isArray(v.validation)&&v.validation.length,400,'Choose a tested artifact version');
   const pointer=store.get('sitePointer',a.projectId);let siteReleaseId:string|null=null;
   if(pointer){
    const prior=read('siteRelease',pointer.releaseId);const belongs=(p:any)=>p.artifactVersionId===v.id;
    const existing=prior.pages.filter(belongs);const pages=prior.pages.map((p:any)=>belongs(p)?{...p,artifactVersionId:v.id,visible:true}:p);
    if(!existing.length){need(prior.pages.length<100,409,'Site has 100 pages; manage its pages before publishing another contribution');const base=('tool-'+a.id.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'')).slice(0,70);let slug=base,n=2;while(pages.some((p:any)=>p.slug===slug))slug=base+'-'+n++;pages.push({id:crypto.randomUUID(),artifactVersionId:v.id,slug,label:prior.pages.some((p:any)=>store.get('version',p.artifactVersionId)?.artifactId===a.id)?`${a.title} · Version ${v.number}`:a.title,visible:true});}
    if(!existing.length||existing.some((p:any)=>p.artifactVersionId!==v.id||!p.visible)){
     const {id,createdAt,...snapshot}=prior;const release=store.add('siteRelease',{...snapshot,pages,previousReleaseId:id,publishedBy:pk,reason:'artifact-publication',artifactId:a.id});
     store.put('sitePointer',{id:a.projectId,releaseId:release.id});siteReleaseId=release.id;
    }else siteReleaseId=prior.id;
   }
   return {...store.put('artifact',{...a,publishedVersionId:v.id}),siteReleaseId};
  });
 }
 return {handleApi,publicResponse,getDraft,publishArtifact};
}
