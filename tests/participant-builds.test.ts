import {test,expect} from 'bun:test';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {Store} from '../src/store';
import {createApp} from '../src/app';
import {config} from '../src/config';
import {ADMINS,hash} from '../src/auth';
import {startDispatcher,pipelineJobInput} from '../src/dispatcher';
import prepare from '../pipelines/functions/prepare-participant-builder.v1';
import {participantPackage,validateParticipantFiles} from '../pipelines/functions/finish-participant-builder.v1';
function fixture(available=true){
 const store=new Store(':memory:'),admin=generateSecretKey(),user=generateSecretKey(),other=generateSecretKey(),outsider=generateSecretKey(),worker=generateSecretKey(),webhook=generateSecretKey();ADMINS.push(getPublicKey(admin));
 const origin='https://participant.example',env={PUBLIC_ORIGIN:origin,WORKER_PUBKEY:getPublicKey(worker),AUTOPILOT_WEBHOOK_PUBKEY:getPublicKey(webhook),BUILDER_PIPELINE_CONFIG:'admin-only',...(available?{PARTICIPANT_BUILDER_PIPELINE_CONFIG:'isolated-only',PARTICIPANT_BUILDER_RUNTIME:'isolated-codex-v1'}:{})};
 const app=createApp(store,config(env));
 const call=async(path:string,method='GET',data?:any,key=user)=>{const body=data===undefined?'':JSON.stringify(data),event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(body?[['payload',hash(body)]]:[])]},key);const r=await app.fetch(new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64')},...(body?{body}:{})}));return {status:r.status,body:await r.json() as any};};
 const setup=async()=>{const p=(await call('/api/projects','POST',{title:'Workshop'},admin)).body;for(const key of [user,other])await call('/api/join','POST',{code:p.joinCode},key);const d=(await call(`/api/projects/${p.id}/designs`,'POST',{title:'Counter'})).body;const s=(await call(`/api/designs/${d.id}`,'PATCH',{title:'Counter',document:'A counter with a button.',expectedSnapshotId:null})).body;return {p,d,s};};
 const enable=(p:any,enabled=true,rev=0,key=admin)=>call(`/api/projects/${p.id}/participant-builds`,'PATCH',{enabled,expectedRevision:rev},key);
 const close=()=>{ADMINS.splice(ADMINS.indexOf(getPublicKey(admin)),1);store.db.close();};return {store,app,call,setup,enable,close,admin,user,other,outsider,worker,webhook,env,origin};
}
test('default off, legacy off, admin revision checks, and desired state separate from unavailable runtime',async()=>{
 const f=fixture(false);try{const {p,d,s}=await f.setup();expect(p.participantBuildsEnabled).toBe(false);expect((await f.call(`/api/projects/${p.id}/participant-builds`)).body).toMatchObject({participantBuildsEnabled:false,participantBuildsRevision:0,buildAvailable:false});
 for(const key of [f.user,f.other,f.outsider])expect((await f.enable(p,true,0,key)).status).toBe(403);
 expect((await f.call(`/api/projects/${p.id}`,'PATCH',{participantBuildsEnabled:true},f.user)).status).toBe(403);
 expect((await f.enable(p)).body).toMatchObject({participantBuildsEnabled:true,participantBuildAvailable:false});expect((await f.enable(p,false,0)).status).toBe(409);
 const waiting=await f.call(`/api/designs/${d.id}/build`,'POST',{requestId:'waiting',snapshotId:s.id});expect(waiting.body.job).toBeNull();expect(waiting.body.reason).toContain('runtime is not configured');expect(f.store.all('job')).toHaveLength(0);
 expect((await f.call(`/api/implementations/${waiting.body.implementation.id}/messages`,'POST',{content:'Bypass',requestId:'x'})).status).toBe(503);
 f.store.put('project',{id:'legacy',title:'Old'});f.store.put('membership',{id:'legacy:'+getPublicKey(f.user),projectId:'legacy'});expect((await f.call('/api/projects/legacy/participant-builds')).body.participantBuildsEnabled).toBe(false);
 }finally{f.close();}
});
test('own initial build, follow-up, retry and private result retain immutable lane and reject raw authority bypasses',async()=>{
 const f=fixture();try{const {p,d,s}=await f.setup();await f.enable(p);
 const path=`/api/designs/${d.id}/build`,input={requestId:'initial',snapshotId:s.id};
 for(const key of [f.other,f.outsider])expect((await f.call(path,'POST',input,key)).status).toBe(403);
 const built=(await f.call(path,'POST',input)).body,j=f.store.get('job',built.job.id)!,i=built.implementation;
 expect(j).toMatchObject({owner:getPublicKey(f.user),requestedExecutionProfile:'isolated-codex',workflowVersion:'participant-builder-v1',snapshotId:s.id});expect((await f.call(path,'POST',input)).body.job.id).toBe(j.id);
 for(const key of [f.other,f.outsider])for(const [route,method,b] of [[`/api/implementations/${i.id}`,'GET',undefined],[`/api/implementations/${i.id}/messages`,'POST',{content:'Steal',requestId:'steal'}],[`/api/jobs/${j.id}/retry`,'POST',{}]] as const)expect((await f.call(route,method,b,key)).status).toBe(403);
 expect((await f.call(`/api/worker/jobs/${j.id}/artifacts`,'POST',{runId:'fake'},f.user)).status).toBe(403);
 f.store.put('job',{...j,status:'running',runId:'isolated-run'});
 const registration={publicationId:'package',runId:'isolated-run',title:'Counter',files:{'index.html':'<button>0</button>'},validation:['Independent isolated container: HTML and JS smoke'],executionProfile:'isolated-codex',requestId:j.id,conversationKey:`byofreedom:participant:${i.id}`,submittedBy:j.owner,snapshotId:s.id};
 expect((await f.call(`/api/worker/jobs/${j.id}/artifacts`,'POST',{...registration,submittedBy:'other'},f.worker)).status).toBe(403);
 const v=(await f.call(`/api/worker/jobs/${j.id}/artifacts`,'POST',registration,f.worker)).body;expect(v.versionId).toBeTruthy();expect(f.store.get('artifact',v.artifactId)!.publishedVersionId).toBeNull();
 for(const route of [`/api/artifacts/${v.artifactId}/publish`,`/api/artifacts/${v.artifactId}/data-installations`,`/api/projects/${p.id}/artifact-shares`])expect((await f.call(route,'POST',{versionId:v.versionId},f.user)).status).toBe(403);
 expect((await f.call(`/api/worker/jobs/${j.id}/complete`,'POST',{response:'Forged host',executionProfile:'operator-controlled-host-native'},f.worker)).status).toBe(422);
 await f.call(`/api/worker/jobs/${j.id}/complete`,'POST',{response:'Counter ready',executionProfile:'isolated-codex',receipt:{requestId:j.id,runId:'isolated-run',conversationKey:`byofreedom:participant:${i.id}`}},f.worker);
 const next=(await f.call(`/api/implementations/${i.id}/messages`,'POST',{content:'Make the button blue',requestId:'followup',executionProfile:'host'})).body;expect(next.startingVersionId).toBe(v.versionId);expect(next.requestedExecutionProfile).toBe('isolated-codex');
 f.store.put('job',{...f.store.get('job',next.id)!,status:'failed'});expect((await f.call(`/api/jobs/${next.id}/retry`,'POST',{})).status).toBe(200);expect(f.store.get('job',next.id)!.context).toEqual(next.context);
 await f.enable(p,false,1);f.store.put('job',{...f.store.get('job',next.id)!,status:'failed'});expect((await f.call(`/api/jobs/${next.id}/retry`,'POST',{})).status).toBe(503);expect((await f.call(`/api/implementations/${i.id}/messages`,'POST',{content:'New work',requestId:'revoked'})).status).toBe(503);expect((await f.call(`/api/implementations/${i.id}`)).body.artifacts[0].versions[0].id).toBe(v.versionId);
 }finally{f.close();}
});
test('dispatcher uses only participant grant, fences predispatch revocation, and retains accepted runs after revocation',async()=>{
 const f=fixture();const cfg={origin:'https://autopilot.example',clientOrigin:f.origin,installationId:'participant-install',appId:'app',ownerNpub:'owner',definitionId:'isolated-definition',callbackUrl:f.origin+'/api/pipeline-webhook',credentialFile:'/unused',appPubkey:'a'.repeat(64)};let dispatch:any;
 try{const {p,d,s}=await f.setup();await f.enable(p);const result=(await f.call(`/api/designs/${d.id}/build`,'POST',{requestId:'initial',snapshotId:s.id})).body;const original=f.store.get('job',result.job.id)!;const seen:any[]=[];const fake=((c:any)=>({submit:async(input:any)=>{seen.push({config:c,input});return {response:{runId:'kept-run'},receipt:{}};},poll:async()=>({response:{}}),delivery:async()=>({response:{}})})) as any;
 dispatch=startDispatcher(f.store,{...f.env,PARTICIPANT_BUILDER_PIPELINE_CONFIG:JSON.stringify(cfg)},fake);await dispatch.ready;expect(seen).toHaveLength(1);expect(seen[0].config.definitionId).toBe('isolated-definition');expect(seen[0].input.requestedExecutionProfile).toBe('isolated-codex');
 await f.enable(p,false,1);await dispatch.tick();expect(f.store.get('job',original.id)!.status).toBe('running');expect(f.store.get('job',original.id)!.runId).toBe('kept-run');
 f.store.put('job',{...original,id:'revoked-undispatched',status:'queued',attempts:0});await dispatch.tick();expect(f.store.get('job','revoked-undispatched')!.error).toBe('participant_execution_revoked');expect(seen).toHaveLength(1);
 }finally{dispatch?.stop();f.close();}
});
const file=(path:string,text:string)=>({path,base64:Buffer.from(text).toString('base64')});
function isolatedOutput(){const job={id:'job',kind:'implementation',projectId:'project',snapshotId:'snapshot',conversationId:'conversation',requestedExecutionProfile:'isolated-codex',context:{submittedBy:'member',participantOwner:'member',snapshot:{id:'snapshot'},storage:{contractVersion:1,backend:'nstack',sdkSource:'export const sdk=true;'},message:'Build'}};return {job,turn:{status:'completed',requestId:'job',projectId:'project',runId:'run',conversationKey:'byofreedom:participant:conversation',reply:'Ready',output:{executionProfile:'isolated-codex',projectFiles:[file('publication.json',JSON.stringify({title:'Counter',paths:['index.html']})),file('index.html','<h1>Counter</h1>'),file('.byo/context.json','private evidence never registered')]}}};}
test('isolated preparation pins SDK/context, suppresses stale publication, and result allowlist excludes all context',async()=>{
 const f=isolatedOutput(),request=await prepare({job:f.job});expect(request.executionProfile).toBe('isolated-codex');expect(request.directory).toBe('/workspace');expect(request.durationMs).toBe(120000);expect(request).not.toHaveProperty('agentTools');expect(request.projectFiles.map(x=>x.path)).toContain('.byo/data-sdk.ts');expect(request.projectFiles.some(x=>x.path==='publication.json')).toBe(false);expect(participantPackage(f.turn,f.job)).toEqual({title:'Counter',files:{'index.html':'<h1>Counter</h1>'}});
 for(const altered of [{...f.turn,runId:null},{...f.turn,requestId:'foreign'},{...f.turn,conversationKey:'admin'},{...f.turn,output:{...f.turn.output,executionProfile:'host'}}])expect(()=>participantPackage(altered,f.job)).toThrow();
});
test('package metadata cannot select host authority, private context, binary, traversal, duplicate or conflicting files',()=>{
 for(const paths of [['../secret','index.html'],['.byo/context.json','index.html'],['publication.json','index.html'],['index.html','index.html'],['index.html','asset.png'],['index.html','assets','assets/main.js']]){const f=isolatedOutput();f.turn.output.projectFiles[0]=file('publication.json',JSON.stringify({title:'Counter',paths}));expect(()=>participantPackage(f.turn,f.job)).toThrow();}
 const f=isolatedOutput();f.turn.output.projectFiles[0]=file('publication.json',JSON.stringify({title:'Counter',paths:['index.html'],validation:['Model claims pass'],origin:'https://evil.example'}));expect(()=>participantPackage(f.turn,f.job)).toThrow('manifest');
});
(process.env.BYO_DOCKER_VALIDATION_TEST==='1'?test:test.skip)('participant independent validator checks actual files and rejects malformed JavaScript',async()=>{
 expect((await validateParticipantFiles({'index.html':'<h1>Counter</h1><script>let n=0;</script>'})).join()).toContain('"inlineScripts":1');
 await expect(validateParticipantFiles({'index.html':'<h1>Invalid</h1><script>const = ;</script>'})).rejects.toThrow('validation failed');
 await expect(validateParticipantFiles({'index.html':'<h1>Invalid external script</h1>','assets/main.js':'const = ;'})).rejects.toThrow('validation failed');
},60000);
test('atomic admission limits global work and one owner across designs; retries cannot exceed capacity',async()=>{
 const f=fixture();try{const {p,d,s}=await f.setup();await f.enable(p);const start=()=>f.call(`/api/designs/${d.id}/build`,'POST',{requestId:'one',snapshotId:s.id});const [a,b]=await Promise.all([start(),start()]);expect(a.status).toBe(202);expect(b.body.job.id).toBe(a.body.job.id);expect(f.store.all('job')).toHaveLength(1);
 const own2=(await f.call(`/api/projects/${p.id}/designs`,'POST',{title:'Another'})).body,s2=(await f.call(`/api/designs/${own2.id}`,'PATCH',{title:'Another',document:'Another counter',expectedSnapshotId:null})).body;expect((await f.call(`/api/designs/${own2.id}/build`,'POST',{snapshotId:s2.id,requestId:'second-own'})).status).toBe(429);
 const other=(await f.call(`/api/projects/${p.id}/designs`,'POST',{title:'Other counter'},f.other)).body,os=(await f.call(`/api/designs/${other.id}`,'PATCH',{title:'Other',document:'Counter',expectedSnapshotId:null},f.other)).body;expect((await f.call(`/api/designs/${other.id}/build`,'POST',{snapshotId:os.id,requestId:'other'},f.other)).status).toBe(202);
 const third=generateSecretKey();await f.call('/api/join','POST',{code:p.joinCode},third);const td=(await f.call(`/api/projects/${p.id}/designs`,'POST',{title:'Third'},third)).body,ts=(await f.call(`/api/designs/${td.id}`,'PATCH',{title:'Third',document:'Counter',expectedSnapshotId:null},third)).body;expect((await f.call(`/api/designs/${td.id}/build`,'POST',{snapshotId:ts.id,requestId:'busy'},third)).status).toBe(429);expect(f.store.all('job')).toHaveLength(2);
 const original=f.store.get('job',a.body.job.id)!;f.store.put('job',{...original,status:'failed'});expect((await f.call(`/api/jobs/${original.id}/retry`,'POST',{})).status).toBe(200);expect(f.store.all('job').filter(j=>j.status==='queued')).toHaveLength(2);
 }finally{f.close();}
});
test('removed membership blocks every participant execution route and undispatched job, but accepted output survives setting revocation',async()=>{
 const f=fixture();let dispatcher:any;try{const {p,d,s}=await f.setup();await f.enable(p);const built=(await f.call(`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'one'})).body,j=f.store.get('job',built.job.id)!;
 f.store.db.query('DELETE FROM records WHERE kind=? AND id=?').run('membership',p.id+':'+getPublicKey(f.user));
 for(const path of [`/api/designs/${d.id}/build`,`/api/implementations/${built.implementation.id}/messages`,`/api/jobs/${j.id}/retry`])expect((await f.call(path,'POST',{snapshotId:s.id,content:'Bypass',requestId:'removed'})).status).toBe(403);
 dispatcher=startDispatcher(f.store,f.env,(()=>{throw Error('No client allowed');}) as any);await dispatcher.ready;expect(f.store.get('job',j.id)!.error).toBe('participant_execution_revoked');
 f.store.put('membership',{id:p.id+':'+getPublicKey(f.user),projectId:p.id});f.store.put('job',{...j,status:'running',runId:'accepted-before-revocation'});await f.enable(p,false,1);
 const completed=await f.call(`/api/worker/jobs/${j.id}/complete`,'POST',{response:'Accepted work completed',executionProfile:'isolated-codex',receipt:{requestId:j.id,runId:'accepted-before-revocation',conversationKey:`byofreedom:participant:${j.conversationId}`}},f.worker);expect(completed.status).toBe(200);expect(f.store.get('job',j.id)!.status).toBe('complete');expect((await f.call(`/api/implementations/${j.conversationId}`)).body.messages.at(-1).content).toBe('Accepted work completed');
 }finally{dispatcher?.stop();f.close();}
});
test('revocation after uncertain first submission never resubmits a request with unknown acceptance',async()=>{
 for(const revokeMembership of [false,true]){
 const f=fixture();let dispatch:any;try{const {p,d,s}=await f.setup();await f.enable(p);const built=(await f.call(`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'lost'})).body;let submissions=0;
 const cfg={origin:'https://autopilot.example',clientOrigin:f.origin,installationId:'participant-install',appId:'app',ownerNpub:'owner',definitionId:'isolated-definition',callbackUrl:f.origin+'/api/pipeline-webhook',credentialFile:'/unused',appPubkey:'a'.repeat(64)};
 dispatch=startDispatcher(f.store,{...f.env,PARTICIPANT_BUILDER_PIPELINE_CONFIG:JSON.stringify(cfg)},(()=>({submit:async()=>{submissions++;throw Error('Delivery failed before known acceptance');}})) as any);await dispatch.ready;expect(submissions).toBe(1);const j=f.store.get('job',built.job.id)!;expect(j.runId).toBeUndefined();
 if(revokeMembership)f.store.db.query('DELETE FROM records WHERE kind=? AND id=?').run('membership',p.id+':'+getPublicKey(f.user));else await f.enable(p,false,1);
 f.store.put('job',{...j,lastAttemptAt:0});await dispatch.tick();await dispatch.tick();expect(submissions).toBe(1);expect(f.store.get('job',j.id)).toMatchObject({status:'uncertain',error:'participant_execution_revoked_uncertain',attempts:1});
 }finally{dispatch?.stop();f.close();}
 }
});
test('combined project settings save is atomic for invalid metadata and stale participant permission revisions',async()=>{
 const f=fixture();try{const {p}=await f.setup(),path=`/api/projects/${p.id}`,enable={participantBuildsEnabled:true,expectedParticipantBuildsRevision:0};
 expect((await f.call(path,'PATCH',{...enable,title:'x'.repeat(151)},f.admin)).status).toBe(400);expect(f.store.get('project',p.id)!.participantBuildsEnabled).toBe(false);
 expect((await f.call(path,'PATCH',{...enable,title:'Renamed'},f.admin)).status).toBe(200);expect(f.store.get('project',p.id)).toMatchObject({title:'Renamed',participantBuildsEnabled:true,participantBuildsRevision:1});
 expect((await f.call(path,'PATCH',{...enable,participantBuildsEnabled:false,title:'Stale overwrite'},f.admin)).status).toBe(409);expect(f.store.get('project',p.id)!.title).toBe('Renamed');
 expect((await f.call(path,'PATCH',{title:'Member overwrite',...enable},f.user)).status).toBe(403);
 await f.call(path,'PATCH',{title:'Metadata only'},f.admin);expect(f.store.get('project',p.id)).toMatchObject({title:'Metadata only',participantBuildsEnabled:true,participantBuildsRevision:1});
 }finally{f.close();}
});

test('isolated participant workflow never registers host agent tools or selects the admin pipeline as fallback',async()=>{
 const definition=await Bun.file(new URL('../pipelines/participant-builder.v1.json',import.meta.url)).json();expect(definition.steps[1].function).toBe('session.completedTurn');expect(definition.steps[1]).not.toHaveProperty('agentTools');expect(definition.steps[1].input.pick.executionProfile).toBe('$.isolatedRequest.executionProfile');
 const f=fixture();let dispatcher:any;try{const {p,d,s}=await f.setup();await f.enable(p);const built=(await f.call(`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'no-fallback'})).body;let clients=0;
 dispatcher=startDispatcher(f.store,{BUILDER_PIPELINE_CONFIG:'admin-only',PARTICIPANT_BUILDER_RUNTIME:'isolated-codex-v1'},(()=>{clients++;throw Error('No host fallback');}) as any);await dispatcher.ready;expect(clients).toBe(0);expect(f.store.get('job',built.job.id)!.attempts).toBe(0);
 }finally{dispatcher?.stop();f.close();}
});
test('known terminal failed isolated run holds retry and follow-up; a new build uses a distinct conversation',async()=>{
 const f=fixture();let dispatcher:any;try{const {p,d,s}=await f.setup();await f.enable(p);const first=(await f.call(`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'failed-known'})).body;const j=f.store.get('job',first.job.id)!;f.store.put('job',{...j,status:'running',runId:'terminal-run',attempts:1});
 expect((await f.call(`/api/worker/jobs/${j.id}/complete`,'POST',{error:'Actual terminal pipeline failure'},f.worker)).status).toBe(200);expect(f.store.get('job',j.id)!.status).toBe('failed');
 const retry=await f.call(`/api/jobs/${j.id}/retry`,'POST',{});expect(retry.status).toBe(409);expect(retry.body.error).toContain('Start a new build');expect(f.store.get('job',j.id)!.status).toBe('failed');
 expect((await f.call(`/api/implementations/${j.conversationId}/messages`,'POST',{requestId:'unsafe-same-key',content:'Try again'})).status).toBe(409);
 const next=(await f.call(`/api/designs/${d.id}/build`,'POST',{snapshotId:s.id,requestId:'new-isolated-conversation'})).body.job;expect(next.id).not.toBe(j.id);expect(next.snapshotId).toBe(s.id);expect(next.requestedExecutionProfile).toBe('isolated-codex');expect(next.conversationId).not.toBe(j.conversationId);expect(f.store.get('job',j.id)!.runId).toBe('terminal-run');
 }finally{dispatcher?.stop();f.close();}
});
