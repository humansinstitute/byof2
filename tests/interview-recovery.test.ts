import {expect,test} from 'bun:test';
import {recoverInterviewReply,interviewRecoveryConfigs} from '../src/interview-recovery';
import {pipelineBinding} from '../src/dispatcher';
import type {RemotePipelineConfig,createRemotePipelines} from '../integration/remote-pipelines';
const cfg:RemotePipelineConfig={origin:'https://agent.example',clientOrigin:'https://app.example',callbackUrl:'https://app.example/api/pipeline-webhook',definitionId:'old-v7',installationId:'installation',appId:'app',ownerNpub:'owner',appPubkey:'a'.repeat(64),credentialFile:'/private/old-grant'};
const job={id:'job',kind:'interview',requestId:'request',projectId:'project',designId:'design',conversationId:'conversation',runId:'run',context:{attachments:[],priorSourceReceipts:[]},dispatchBinding:pipelineBinding(cfg)};
const turn={status:'completed',requestId:'job',projectId:'project',runId:'run',conversationKey:'byofreedom:interview:scoped-v1:conversation',sessionId:'session',nativeSessionId:'native',receiptId:'receipt',reply:JSON.stringify({title:'Design',document:'Plain source URL https://example.org/',response:'The completed answer.'}),output:{executionProfile:'scoped-interview',sourceReceipts:[]}};
const state=()=>({runId:'run',terminal:true,result:{job,turn}});
const client=(value:any,calls:string[]=[])=>((_cfg:RemotePipelineConfig)=>({poll:async(id:string)=>{calls.push(id);return {response:value}}})) as typeof createRemotePipelines;
test('recovery reads exact original grant/run without starting or editing execution',async()=>{
 const calls:string[]=[];const result=await recoverInterviewReply(job,[{...cfg,definitionId:'new-v8'},cfg],client(state(),calls));expect(result.result.response).toBe('The completed answer.');expect(calls).toEqual(['run']);expect(result.evidence.definitionId).toBe('old-v7');expect(result.evidence.normalizer).toBe('byofreedom.finishInterview.v5');
 expect(interviewRecoveryConfigs({INTERVIEW_PIPELINE_CONFIG:JSON.stringify({...cfg,definitionId:'new-v8'}),INTERVIEW_RECOVERY_PIPELINE_CONFIGS:JSON.stringify([cfg])})).toHaveLength(2);
});
test('recovery fails closed for unavailable old grants, nonterminal or foreign job/native evidence',async()=>{
 await expect(recoverInterviewReply(job,[{...cfg,definitionId:'new-v8'}],client(state()))).rejects.toThrow('unavailable');
 for(const value of [{...state(),terminal:false},{...state(),runId:'foreign'},{...state(),result:{job:{...job,context:{message:'changed'}},turn}},{...state(),result:{job,turn:{...turn,requestId:'foreign'}}},{...state(),result:{job,turn:{...turn,output:{executionProfile:'host-native'}}}}])await expect(recoverInterviewReply(job,[cfg],client(value))).rejects.toThrow();
});
