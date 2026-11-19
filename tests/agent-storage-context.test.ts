import {afterEach,beforeEach,expect,test} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {generateSecretKey,getPublicKey,finalizeEvent} from 'nostr-tools';
import {agentStorageContext} from '../src/agent-storage-context';
import {NStackLimits} from '../src/nstack';
import {createApp} from '../src/app';
import {Store} from '../src/store';
import {ADMINS,hash} from '../src/auth';
import {config} from '../src/config';
import {pipelineJobInput} from '../src/dispatcher';
import interview from '../pipelines/functions/prepare-interview.v6';
import builder from '../pipelines/functions/prepare-builder.v5';

test('storage context distinguishes browser private JSON from managed shared/files and never copies connection secrets',()=>{
 const settings={revision:7,state:'ready',connection:{mode:'browser-user',endpoint:'PRIVATE-ENDPOINT',workspaceName:'PRIVATE-LABEL',credential:'SECRET'},capabilities:{json:true,files:true,anonymousRead:true}};
 const browser=agentStorageContext(settings);
 expect(browser.capabilities).toEqual({json:true,files:false,policies:['private'],anonymousRead:false});
 expect(browser.access.independentNStackWorkspaceMembershipRequired).toBe(true);
 expect(browser.requirements.currentBlockers.join(' ')).toContain('shared/public');
 expect(browser.limits.fileBytes).toBe(NStackLimits.fileBytes);expect(browser.limits.fileBytes).not.toBe(2*1024*1024);
 expect(JSON.stringify(browser)).not.toMatch(/SECRET|PRIVATE-ENDPOINT|PRIVATE-LABEL/);
 const managed=agentStorageContext({...settings,connection:{},capabilities:{json:true,files:true,anonymousRead:true}});
 expect(managed.capabilities).toEqual({json:true,files:true,policies:['private','shared','public'],anonymousRead:true});
 expect(managed.requirements.currentBlockers).toEqual([]);
 for(const state of ['blocked','untested','unconfigured']){
  const unavailable=agentStorageContext({...settings,state});
  expect(unavailable.capabilities).toEqual({json:false,files:false,policies:[],anonymousRead:false});
 }
 expect(agentStorageContext({connection:null,capabilities:{json:true,files:true}}).mode).toBe('unconfigured');
 expect(agentStorageContext({...settings,connection:{},capabilities:{json:true,files:false}}).capabilities.files).toBe(false);
});

const origin='https://workshop.example';
let dir:string,store:Store,key:Uint8Array,actor:string,conversationIds:string[];
beforeEach(()=>{dir=mkdtempSync(join(tmpdir(),'byo-storage-context-'));store=new Store(join(dir,'test.sqlite'));key=generateSecretKey();actor=getPublicKey(key);ADMINS.push(actor);conversationIds=[];store.put('project',{id:'p',title:'Event',joinCode:'EVENT'});});
afterEach(()=>{ADMINS.splice(ADMINS.indexOf(actor),1);store.db.close();rmSync(dir,{recursive:true,force:true});for(const id of conversationIds)rmSync(join(join(homedir(),'.wingmen','workspaces','byofreedom'),id),{recursive:true,force:true});});
async function call(app:ReturnType<typeof createApp>,path:string,method='GET',data?:unknown){
 const body=data===undefined?'':JSON.stringify(data),event=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:crypto.randomUUID(),tags:[['u',origin+path],['method',method],...(body?[['payload',hash(body)]]:[])]},key);
 const response=await app.fetch(new Request(origin+path,{method,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64')},...(body?{body}:{})}));
 const result=await response.json();expect(response.status).toBeLessThan(300);return result;
}
test('signed interview and builder jobs capture same actual NStack snapshot; prompts teach photos/shared guestbooks honestly',async()=>{
 store.put('nstack',{id:'global',revision:2,state:'ready',connection:{mode:'browser-user',workspaceName:'Workshop',endpoint:'PRIVATE-ENDPOINT'},capabilities:{json:true,files:true,anonymousRead:true}});
 const app=createApp(store,config({PUBLIC_ORIGIN:origin,INTERVIEW_WORKFLOW_VERSION:'interview-v6'}));
 const d=await call(app,'/api/projects/p/designs','POST',{title:'Event guestbook'});
 const job=await call(app,`/api/designs/${d.id}/messages`,'POST',{content:'Build a shared guestbook with event photos',requestId:'one',storage:{capabilities:{files:true,policies:['shared']}}});
 const captured=job.context.storage;
 expect(captured.settingsRevision).toBe(2);expect(captured.capabilities).toEqual({json:true,files:false,policies:['private'],anonymousRead:false});expect(captured.sdkSource).toBeUndefined();
 store.put('nstack',{id:'global',revision:3,state:'unconfigured',connection:null,capabilities:{json:false,files:false}});
 const request=await interview({job:pipelineJobInput(job)});
 expect(request.prompt).toContain('Postgres-backed');expect(request.prompt).toContain('S3-compatible');expect(request.prompt).toContain('filePut/fileGet');expect(request.prompt).toContain('managed delegation');expect(request.prompt).toContain('"settingsRevision":2');expect(request.prompt).not.toContain('PRIVATE-ENDPOINT');expect(request.prompt).toContain('not app file-storage activation');
 const snap=await call(app,`/api/designs/${d.id}`,'PATCH',{title:'Guestbook',document:'Shared event messages and photos',expectedSnapshotId:null});
 const impl=await call(app,`/api/designs/${d.id}/implementations`,'POST',{snapshotId:snap.id});conversationIds.push(impl.id);
 const buildJob=await call(app,`/api/implementations/${impl.id}/messages`,'POST',{content:'Build the selected design',requestId:'build'});
 expect(buildJob.context.storage.settingsRevision).toBe(3);expect(buildJob.context.storage.capabilities.json).toBe(false);expect(buildJob.context.storage.sdkSource).toContain('createFreedomData');
 const build=await builder({job:pipelineJobInput(buildJob)});
 expect(build.prompt).toContain('private policy is per-user');expect(build.prompt).toContain('only admins write');expect(build.prompt).toContain('byo-data.json');expect(build.prompt).toContain('exact-version');expect(build.prompt).toContain('unavailable/setup-needed');expect(build.prompt).toContain('Native interview image attachments do not activate');expect(build.prompt).toContain('65536');expect(build.prompt).toContain('262144');
 expect(build.conversationKey).toBe('byofreedom:implementation:'+impl.id);expect(request.conversationKey).toBe('byofreedom:interview:scoped-v1:'+d.id);expect(request.executionProfile).toBe('scoped-interview');
});
test('new versioned prepares require server context and v6 retains private native image UI support',async()=>{
 await expect(interview({job:{id:'i',kind:'interview',projectId:'p',conversationId:'c',context:{message:'Photos'}}})).rejects.toThrow('storage context');
 await expect(builder({job:{id:'i',kind:'implementation',projectId:'p',conversationId:'c',snapshotId:'s',context:{message:'Build',snapshot:{document:'Photos'}}}})).rejects.toThrow('storage context');
 expect(config({INTERVIEW_PIPELINE_CONFIG:'set',INTERVIEW_WORKFLOW_VERSION:'interview-v6',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(true);
 expect(config({INTERVIEW_PIPELINE_CONFIG:'set',INTERVIEW_WORKFLOW_VERSION:'interview-v5',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(true);
 expect(config({INTERVIEW_PIPELINE_CONFIG:'set',INTERVIEW_WORKFLOW_VERSION:'interview-v7',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(true);
 expect(config({INTERVIEW_PIPELINE_CONFIG:'set',INTERVIEW_WORKFLOW_VERSION:'interview-v9',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(false);
 expect(config({INTERVIEW_PIPELINE_CONFIG:'set',INTERVIEW_WORKFLOW_VERSION:'interview-v8',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(true);
});
test('new storage-aware definitions keep scoped runtime and exact builder publication authority',async()=>{
 const interviewDefinition=await Bun.file(new URL('../pipelines/interview.v6.json',import.meta.url)).json();
 const buildDefinition=await Bun.file(new URL('../pipelines/builder.v6.json',import.meta.url)).json();
 expect(interviewDefinition.steps.map((s:any)=>s.function)).toEqual(['byofreedom.prepareInterview.v6','session.scopedInterviewTurn.v1','byofreedom.finishInterview.v4']);
 expect(buildDefinition.steps.map((s:any)=>s.function)).toEqual(['byofreedom.prepareBuilder.v5','session.completedTurn','byofreedom.finishBuilder.v2']);
 expect(buildDefinition.steps[1].agentTools).toEqual({'byofreedom.publish':'byofreedom.agentPublish.v4'});
});
