import finish from '../pipelines/functions/finish-interview.v5';
import {createRemotePipelines,type RemotePipelineConfig} from '../integration/remote-pipelines';
import {pipelineBinding} from './dispatcher';
import type {Row} from './store';

/** Read-only recovery under an existing exact grant. Never submit or modify a native run. */
export async function recoverInterviewReply(job:Row,configs:RemotePipelineConfig[],createClient=createRemotePipelines){
 if(job.kind!=='interview'||!job.runId||!job.dispatchBinding)throw Error('Original interview run and workflow binding required');
 const cfg=configs.find(c=>JSON.stringify(pipelineBinding(c))===JSON.stringify(job.dispatchBinding));
 if(!cfg)throw Error('Original workflow grant is unavailable; retain its configuration and credential for recovery');
 const read=await createClient(cfg).poll(job.runId);
 const state=read.response as any;
 if(state.runId!==job.runId||state.terminal!==true)throw Error('Original run is not terminal or does not match');
 const original=state.result?.job,turn=state.result?.turn;
 if(!original||original.id!==job.id||original.kind!=='interview'||original.conversationId!==job.conversationId||original.designId!==job.designId||original.projectId!==job.projectId||original.requestId!==job.requestId||JSON.stringify(original.context)!==JSON.stringify(job.context))throw Error('Original run job binding mismatch');
 if(turn?.requestId!==job.id||turn.projectId!==job.projectId||turn.runId!==job.runId||turn.conversationKey!==`byofreedom:interview:scoped-v1:${job.conversationId}`)throw Error('Native turn job binding mismatch');
 const result=await finish({turn,expectedAttachments:job.context.attachments??[],priorSourceReceipts:job.context.priorSourceReceipts??[]});
 return {result,evidence:{runId:job.runId,definitionId:cfg.definitionId,receiptId:turn.receiptId,normalizer:'byofreedom.finishInterview.v5',recoveredAt:new Date().toISOString()}};
}

export function interviewRecoveryConfigs(env:Record<string,string|undefined>=process.env):RemotePipelineConfig[]{
 const prior=env.INTERVIEW_RECOVERY_PIPELINE_CONFIGS?JSON.parse(env.INTERVIEW_RECOVERY_PIPELINE_CONFIGS):[];
 if(!Array.isArray(prior)||prior.length>4)throw Error('At most four original interview recovery grants are supported');
 return [...(env.INTERVIEW_PIPELINE_CONFIG?[JSON.parse(env.INTERVIEW_PIPELINE_CONFIG)]:[]),...prior];
}
