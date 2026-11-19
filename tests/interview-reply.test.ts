import {expect,test} from 'bun:test';
import finish from '../pipelines/functions/finish-interview.v5';
import prepare from '../pipelines/functions/prepare-interview.v7';
import {config} from '../src/config';
const receipt={id:'s1',provenance:'public-source',url:'https://example.org/prices',sha256:'a'.repeat(64),body:'PRIVATE',ticket:'SECRET'};
const design={title:'Comparison',document:'Research notes\nThe source reports prices: https://example.org/prices\nDecisions: a chart.',response:'The source reports prices. Which period interests you?',extra:true};
const turn=(reply:string,sourceReceipts:any[]=[receipt])=>({status:'completed',sessionId:'session',nativeSessionId:'native',receiptId:'receipt',reply,output:{executionProfile:'scoped-interview',sourceReceipts}});
test('completed plain URL and alternative headings with extra fields save without citation policing',async()=>{
 const result=await finish({turn:turn(JSON.stringify(design))});expect(result.snapshot).toEqual({title:design.title,document:design.document});expect(result.response).toBe(design.response);expect(result.designSave.status).toBe('ready');expect(result.research.receipts[0]).not.toHaveProperty('body');expect(JSON.stringify(result)).not.toContain('SECRET');expect(result.research.attribution).toContain('Host-verified');
});
test('plain text and incomplete design retain reply separately from save warning',async()=>{
 for(const reply of ['A useful conversational answer.',JSON.stringify({response:'A useful answer.',title:'Incomplete'}),JSON.stringify({...design,document:'x'.repeat(100001)})]){
 const result=await finish({turn:turn(reply)});expect(result.response.length).toBeGreaterThan(0);expect(result.snapshot).toBeUndefined();expect(result.designSave.status).toBe('not-saved');
 }
 const fenced=await finish({turn:turn('```json\n'+JSON.stringify(design)+'\n```')});expect(fenced.response).toBe(design.response);
});
test('empty, unusable structured replies and resource overflow fail explicitly',async()=>{
 for(const reply of ['', ' ', '{}','null','[]','x'.repeat(180001)])await expect(finish({turn:turn(reply)})).rejects.toThrow();
});
test('scoped completion and pinned image integrity remain mandatory for text fallback too',async()=>{
 const completed=turn('A useful answer.');
 for(const change of [{status:'failed'},{sessionId:null},{output:{executionProfile:'host-native',sourceReceipts:[]}}])await expect(finish({turn:{...completed,...change}})).rejects.toThrow();
 const expectedAttachments=[{id:'image',sha256:'b'.repeat(64)}];
 await expect(finish({turn:completed,expectedAttachments})).rejects.toThrow('not inspected');
 await expect(finish({turn:turn('Answer',[{id:'image',provenance:'approved-attachment',sha256:'c'.repeat(64)}]),expectedAttachments})).rejects.toThrow('match');
 expect((await finish({turn:turn('Answer',[{id:'image',provenance:'approved-attachment',available:false}]),expectedAttachments})).response).toBe('Answer');
});
test('v8 preserves scoped configuration and uses additive functions',async()=>{
 const pipeline=await Bun.file('pipelines/interview.v8.json').json();expect(pipeline.steps.map((s:any)=>s.function)).toEqual(['byofreedom.prepareInterview.v7','session.scopedInterviewTurn.v1','byofreedom.finishInterview.v5']);
 expect(config({INTERVIEW_PIPELINE_CONFIG:'fixture',INTERVIEW_WORKFLOW_VERSION:'interview-v8',INTERVIEW_SCOPED_TOOLS:'1'}).interviewImagesEnabled).toBe(true);
 const result=await prepare({job:{id:'job',kind:'interview',projectId:'p',conversationId:'c',context:{message:'Hello',storage:{contractVersion:1,backend:'nstack'}}}});expect(result.executionProfile).toBe('scoped-interview');expect(result.prompt).not.toContain('headings exactly');expect(result.prompt).not.toContain('no extra fields');
});

test('missing and nonstring response preserve bounded original output as escaped text without losing valid design',async()=>{
 for(const value of [{title:'Design',document:'A complete design.'},{...design,response:42},{title:'Incomplete',response:null}]){
  const raw=JSON.stringify(value),result=await finish({turn:turn(raw)});expect(result.response).toBe(raw);expect(result.responseFormat).toBe('text');expect(result.designSave.status).toBe('document' in value?'ready':'not-saved');
 }
 const response='x'.repeat(17000);expect((await finish({turn:turn(JSON.stringify({...design,response}))})).response).toBe(response);
});
