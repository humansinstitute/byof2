import {createHash} from 'node:crypto';
import {mkdtemp,writeFile,mkdir,rm,chmod} from 'node:fs/promises';
import {tmpdir,homedir} from 'node:os';
import {join,dirname} from 'node:path';
export const name='byofreedom.finishParticipantBuilder.v1';
export const description='Independently validate allowlisted isolated output and register only an exact private job result.';
export const version=1;
const image='oven/bun@sha256:f2b798e7ce1c056cd2149a6be7f014b3fde68a0c7165a3011ce3896e8404a6cd';
export function participantPackage(turn:any,job:any){
 if(job?.requestedExecutionProfile!=='isolated-codex'||job.context?.submittedBy!==job.context?.participantOwner||turn?.status!=='completed'||turn.output?.executionProfile!=='isolated-codex'||turn.requestId!==job.id||turn.projectId!==job.projectId||turn.conversationKey!==`byofreedom:participant:${job.conversationId}`||typeof turn.runId!=='string'||!turn.runId||typeof turn.reply!=='string'||!turn.reply.trim())throw Error('Isolated completed turn lineage required');
 const snapshot=turn.output.projectFiles;if(!Array.isArray(snapshot)||snapshot.length>2048)throw Error('Invalid returned snapshot');
 const entries=new Map<string,string>();let bytes=0;
 for(const f of snapshot){if(!f||typeof f.path!=='string'||typeof f.base64!=='string'||! /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(f.base64)||entries.has(f.path))throw Error('Invalid returned file');bytes+=Buffer.byteLength(f.base64,'base64');if(bytes>16*1024*1024)throw Error('Returned snapshot too large');entries.set(f.path,f.base64);}
 const raw=entries.get('publication.json');if(raw===undefined)return null;
 const decoded=Buffer.from(raw,'base64');if(decoded.length>65536)throw Error('Publication manifest too large');
 const manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(decoded));
 if(!manifest||Object.keys(manifest).sort().join(',')!=='paths,title'||typeof manifest.title!=='string'||!manifest.title.trim()||manifest.title.length>160||!Array.isArray(manifest.paths)||!manifest.paths.length||manifest.paths.length>500||new Set(manifest.paths).size!==manifest.paths.length||!manifest.paths.includes('index.html'))throw Error('Invalid private package manifest');
 const files:Record<string,string>=Object.create(null);
 for(const path of manifest.paths){if(typeof path!=='string'||! /^(?!\.)[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(path)||path.split('/').some((p:string)=>!p||p==='.'||p==='..'||p.startsWith('.'))||path==='publication.json'||! /\.(?:html|css|js|json|svg|txt|md)$/.test(path)||!entries.has(path))throw Error('Invalid package path');files[path]=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.from(entries.get(path)!,'base64'));}
 if(Buffer.byteLength(JSON.stringify(files))>10*1024*1024)throw Error('Package too large');
 for(const path of manifest.paths){const parts=path.split('/');parts.pop();while(parts.length){if(Object.hasOwn(files,parts.join('/')))throw Error('Package file/directory conflict');parts.pop();}}
 return {files,title:manifest.title.trim()};
}
export async function validateParticipantFiles(files:Record<string,string>){
 const paths=Object.keys(files);
 if(!paths.length||paths.length>500||!files['index.html']||paths.some(p=>! /^(?!\.)[A-Za-z0-9_-][A-Za-z0-9_./-]*$/.test(p)||p.split('/').some(x=>!x||x==='.'||x==='..'||x.startsWith('.')))||Buffer.byteLength(JSON.stringify(files))>10*1024*1024)throw Error('Invalid validation package');
 const work=await mkdtemp(join(tmpdir(),'byofreedom-check-'));await chmod(work,0o755);
 let validation:string[];
 try{
  for(const path of paths){const dest=join(work,path);await mkdir(dirname(dest),{recursive:true});await writeFile(dest,files[path]!);}
  const script=`let packagedScripts=0;for(const path of ${JSON.stringify(paths.filter(p=>p.endsWith('.js')))}){const result=await Bun.build({entrypoints:['/package/'+path],target:'browser',external:['*'],outdir:'/tmp/package-js-'+packagedScripts});if(!result.success)throw Error('Packaged JS syntax failed: '+result.logs.join(' '));packagedScripts++;}const index=await Bun.file('/package/index.html').text();if(!/<(?:!doctype|html|body|main|div|h1)/i.test(index))throw Error('Missing HTML document');const scripts=[...index.matchAll(/<script\\b([^>]*)>([\\s\\S]*?)<\\/script>/gi)];let checked=0;for(const [_,attrs,body]of scripts){if(/src\\s*=/.test(attrs))continue;if(!body.trim()||/type\\s*=\\s*["'](?:application\\/ld\\+json|application\\/json)/i.test(attrs))continue;await Bun.write('/tmp/script-'+checked+'.js',body);const result=await Bun.build({entrypoints:['/tmp/script-'+checked+'.js'],target:'browser',outdir:'/tmp/out-'+checked});if(!result.success)throw Error('Inline JS syntax failed: '+result.logs.join(' '));checked++;}const server=Bun.serve({port:4321,hostname:'127.0.0.1',fetch:request=>{const p=new URL(request.url).pathname;return new Response(Bun.file('/package'+(p==='/'?'/index.html':p)));}});const response=await fetch('http://127.0.0.1:4321/');if(response.status!==200||!(await response.text()).includes(index.slice(0,30)))throw Error('Static app HTTP smoke failed');server.stop();console.log(JSON.stringify({html:true,inlineScripts:checked,packagedScripts,http:true}));`;
  const child=Bun.spawn(['docker','run','--rm','--network=none','--read-only','--user=10001:10001','--cap-drop=ALL','--security-opt=no-new-privileges:true','--pids-limit=64','--memory=256m','--cpus=1','--tmpfs=/tmp:rw,nosuid,nodev,size=33554432,mode=1777','--mount',`type=bind,src=${work},dst=/package,readonly`,'--entrypoint=bun',image,'-e',script],{stdout:'pipe',stderr:'pipe'});
  const timeout=setTimeout(()=>child.kill(),30000);let code:number,stdout:string,stderr:string;
  try{[stdout,stderr,code]=await Promise.all([new Response(child.stdout).text(),new Response(child.stderr).text(),child.exited]);}finally{clearTimeout(timeout);}
  if(code!==0)throw Error('Isolated static validation failed: '+stderr.slice(0,1500));
  validation=['Independent isolated container: '+stdout.trim().slice(0,1000)];
 }finally{await rm(work,{recursive:true,force:true});}
 return validation;
}
export default async function finish(input:Record<string,any>){
 const {job,turn,settings}=input;
 const pack=participantPackage(turn,job);
 const receipt={receiptId:turn.receiptId,requestId:turn.requestId,conversationKey:turn.conversationKey,runId:turn.runId,nativeSessionId:turn.nativeSessionId,sequence:turn.sequence};
 let registration=null;
 if(pack){
  const origin=settings?.publicOrigin;
  if(typeof origin!=='string'||new URL(origin).origin!==origin||!origin.startsWith('https://'))throw Error('Pinned registration origin required');
  const validation=await validateParticipantFiles(pack.files);
  const {signWithWingmanKey}=await import(String(join(process.env.AUTOPILOT_REPO||join(homedir(),'code','wm','autopilot'),'src','mcp','wingman-signer.ts')));
  async function post(path:string,body:unknown){const bytes=JSON.stringify(body),url=origin+path;const {token}=await signWithWingmanKey(url,'POST',createHash('sha256').update(bytes).digest('hex'));const response=await fetch(url,{method:'POST',redirect:'error',headers:{authorization:token,'content-type':'application/json'},body:bytes,signal:AbortSignal.timeout(30000)});if(!response.ok)throw Error(`Private result registration rejected (${response.status})`);return response.json();}
  const base=`/api/worker/jobs/${encodeURIComponent(job.id)}`;
  await post(base+'/progress',{runId:turn.runId,progress:'Independent isolated package validation passed; registering private version.'});
  registration=await post(base+'/artifacts',{publicationId:job.id,title:pack.title,runId:turn.runId,files:pack.files,validation,executionProfile:'isolated-codex',requestId:job.id,conversationKey:turn.conversationKey,submittedBy:job.context.submittedBy,snapshotId:job.snapshotId});
 }
 return {response:turn.reply,receipt,registration,executionProfile:'isolated-codex',workflowVersion:'participant-builder-v1'};
}
