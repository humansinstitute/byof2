import {homedir} from 'node:os';
import {test,expect,mock} from 'bun:test';
import publish from '../pipelines/functions/agent-publish.v4';
import {mkdir,mkdtemp,writeFile,rm,symlink} from 'node:fs/promises';
import {basename,join} from 'node:path';
const enabled=process.env.BYO_DOCKER_VALIDATION_TEST==='1';
(enabled?test:test.skip)('actual isolated Docker validation checks files before scoped publication',async()=>{
 mock.module(join(process.env.AUTOPILOT_REPO||join(homedir(),'code','wm','autopilot'),'src','mcp','wingman-signer.ts'),()=>({signWithWingmanKey:async()=>({token:'Nostr fixture-signature'})}));
 const original=globalThis.fetch,requests:any[]=[];
 const root=join(homedir(),'.wingmen','workspaces','byofreedom');await mkdir(root,{recursive:true});const directory=await mkdtemp(join(root,'fixture-'));const conversationId=basename(directory);
 const manifest={publicationId:'fixture-publication',title:'Test counter',files:{'index.html':'<!doctype html><html><body><button id="count">0</button><script>let count=0;document.querySelector("button").onclick=()=>document.querySelector("button").textContent=++count;</script></body></html>'+' '.repeat(100000)},validation:['Fixture package has functional counter handler']};
 await writeFile(join(directory,'publication.json'),JSON.stringify(manifest));
 globalThis.fetch=(async(url:any,init:any)=>{requests.push({url:String(url),body:JSON.parse(init.body)});return Response.json({registered:true,versionId:'fixture-version'});}) as typeof fetch;
 try{
  const result=await publish({input:{settings:{publicOrigin:'https://example.org'},job:{id:'fixture-job',kind:'implementation',projectId:'fixture-project',snapshotId:'fixture-snapshot',conversationId}},nativeReceipt:{requestId:'fixture-job',projectId:'fixture-project',runId:'fixture-run'},args:{publicationId:manifest.publicationId,title:manifest.title,manifest:'publication.json'}});
  expect(result.registered).toBe(true);expect(requests.length).toBe(2);expect(requests[0].url).toEndWith('/progress');expect(requests[1].body.validation.join(' ')).toContain('"inlineScripts":1');expect(requests[1].body.runId).toBe('fixture-run');
 }finally{globalThis.fetch=original;mock.restore();await rm(directory,{recursive:true,force:true});}
},40000);
