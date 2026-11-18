import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,mkdir,rm,chmod,open,realpath,lstat} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {constants} from 'node:fs';
import {join,dirname} from 'node:path';
export const name='byofreedom.agentPublish.v4';
export const description='Validate actual static files in an isolated container and register a version through the scoped app API.';
export const version=4;
const image='oven/bun@sha256:f2b798e7ce1c056cd2149a6be7f014b3fde68a0c7165a3011ce3896e8404a6cd';
export default async function publish(input:Record<string,any>){
 const job=input.input?.job,settings=input.input?.settings,native=input.nativeReceipt,args=input.args;
 if(!job||job.kind!=='implementation'||native?.requestId!==job.id||native?.projectId!==job.projectId||!native.runId||!job.snapshotId)throw Error('Publication native lineage denied');
 const origin=settings?.publicOrigin;
 if(typeof origin!=='string'||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('Pinned publication origin missing');
 if(!args||Object.keys(args).sort().join(',')!=='manifest,publicationId,title'||args.manifest!=='publication.json'||typeof args.publicationId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(args.publicationId)||typeof args.title!=='string'||!args.title.trim()||args.title.length>160||typeof job.conversationId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(job.conversationId))throw Error('Invalid publication arguments');
 const directory=join(join(homedir(),'.wingmen','workspaces','byofreedom'),job.conversationId);
 if(await realpath(directory)!==directory)throw Error('Publication directory symlink denied');
 const path=join(directory,'publication.json');
 const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink()||info.size>20*1024*1024)throw Error('Invalid publication manifest');
 const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);let manifest:any;
 try{const current=await handle.stat();if(!current.isFile()||current.size>20*1024*1024||current.ino!==info.ino||current.dev!==info.dev)throw Error('Publication manifest changed');manifest=JSON.parse(await handle.readFile('utf8'));}finally{await handle.close();}
 if(!manifest||Object.keys(manifest).some(k=>!['publicationId','title','files','validation'].includes(k))||manifest.publicationId!==args.publicationId||manifest.title!==args.title||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw Error('Invalid publication manifest contents');
 const files=manifest.files as Record<string,string>,paths=Object.keys(files);
 if(!paths.length||paths.length>2048||!files['index.html']||paths.some(path=>!/^[A-Za-z0-9_. -]+(?:\/[A-Za-z0-9_. -]+)*$/.test(path)||path.split('/').some(x=>x==='.'||x==='..')||typeof files[path]!=='string')||Object.values(files).reduce((size,text)=>size+Buffer.byteLength(text),0)>16*1024*1024)throw Error('Invalid publication package');
 if(!Array.isArray(manifest.validation)||!manifest.validation.length||manifest.validation.some((x:unknown)=>typeof x!=='string'||x.length>1000))throw Error('Actual validation evidence required');
 const work=await mkdtemp(join(tmpdir(),'byofreedom-check-'));await chmod(work,0o755);
 let validation:string[];
 try{
  for(const path of paths){const dest=join(work,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,files[path]!);}
  const script=`const index=await Bun.file('/package/index.html').text();if(!/<(?:!doctype|html|body|main|div|h1)/i.test(index))throw Error('Missing HTML document');const scripts=[...index.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];let checked=0;for(const [_,attrs,body]of scripts){if(/src\\s*=/.test(attrs))continue;if(!body.trim()||/type\\s*=\\s*["'](?:application\\/ld\\+json|application\\/json)/i.test(attrs))continue;await Bun.write('/tmp/script-'+checked+'.js',body);const result=await Bun.build({entrypoints:['/tmp/script-'+checked+'.js'],target:'browser',outdir:'/tmp/out-'+checked});if(!result.success)throw Error('Inline JS syntax failed: '+result.logs.join(' '));checked++;}const server=Bun.serve({port:4321,hostname:'127.0.0.1',fetch:request=>{const p=new URL(request.url).pathname;return new Response(Bun.file('/package'+(p==='/'?'/index.html':p)));}});const response=await fetch('http://127.0.0.1:4321/');if(response.status!==200||!(await response.text()).includes(index.slice(0,30)))throw Error('Static app HTTP smoke failed');server.stop();console.log(JSON.stringify({html:true,inlineScripts:checked,http:true}));`;
  const child=Bun.spawn(['docker','run','--rm','--network=none','--read-only','--user=10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges:true','--pids-limit=64','--memory=256m','--cpus=1','--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777','--mount',`type=bind,src=${work},dst=/package,readonly`,'--entrypoint=bun',image,'-e',script],{stdout:'pipe',stderr:'pipe'});
  const timeout=setTimeout(()=>child.kill(),30000);let code:number,stdout:string,stderr:string;
  try{[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);}finally{clearTimeout(timeout);}
  if(code!==0)throw Error('Isolated static validation failed: '+stderr.slice(0,1500));
  validation=[...manifest.validation,'Independent isolated container: '+stdout.trim().slice(0,1000)];
 }finally{await rm(work,{recursive:true,force:true});}
 // Supported platform signing custody; raw instance key never leaves its internal signer.
 const {signWithWingmanKey}=await import(String(join(process.env.AUTOPILOT_REPO||join(homedir(),'code','wm','autopilot'),'src','mcp','wingman-signer.ts')));
 async function post(path:string,body:unknown){const bytes=JSON.stringify(body),url=origin+path;const {token}=await signWithWingmanKey(url,'POST',createHash('sha256').update(bytes).digest('hex'));const response=await fetch(url,{method:'POST',redirect:'error',headers:{authorization:token,'content-type':'application/json'},body:bytes,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`App publication request rejected (${response.status}): ${(await response.text()).slice(0,500)}`);return response.json();}
 const base=`/api/worker/jobs/${encodeURIComponent(job.id)}`;
 await post(base+'/progress',{runId:native.runId,progress:'Validated actual implementation files in an isolated container; registering tested version.'});
 return await post(base+'/artifacts',{publicationId:args.publicationId,title:args.title,runId:native.runId,files,validation});
}
