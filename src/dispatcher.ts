import {createRemotePipelines,type RemotePipelineConfig} from '../integration/remote-pipelines';
import {Store,type Row} from './store';
import {createInterviewImageAccess} from './interview-image-access';
export const pipelineJobInput=(j:Row)=>({id:j.id,requestId:j.requestId,kind:j.kind,conversationId:j.conversationId,projectId:j.projectId,designId:j.designId,snapshotId:j.snapshotId,startingVersionId:j.startingVersionId,...(j.requestedExecutionProfile?{requestedExecutionProfile:j.requestedExecutionProfile}:{}),context:j.context});
export const shouldRetryDelivery=(j:Row,delivery:any)=>delivery?.status==='failed'&&(j.recoveryRequestedAt||0)>(j.lastDeliveryRetryAt||0);
export const pipelineBinding=(cfg:RemotePipelineConfig)=>({definitionId:cfg.definitionId,installationId:cfg.installationId,appId:cfg.appId,ownerNpub:cfg.ownerNpub,origin:cfg.origin,clientOrigin:cfg.clientOrigin,callbackUrl:cfg.callbackUrl,appPubkey:cfg.appPubkey});
export function startDispatcher(store:Store,env=process.env,createClient:typeof createRemotePipelines=createRemotePipelines){
 let busy=false;const clients=new Map<string,ReturnType<typeof createRemotePipelines>>();
 const lane=(j:Row)=>j.requestedExecutionProfile==='isolated-codex'?'participant':j.kind;
 const configFor=(j:Row):RemotePipelineConfig|undefined=>{
  const raw=lane(j)==='participant'?env.PARTICIPANT_BUILDER_RUNTIME==='isolated-codex-v1'?env.PARTICIPANT_BUILDER_PIPELINE_CONFIG:undefined:j.kind==='interview'?env.INTERVIEW_PIPELINE_CONFIG:env.BUILDER_PIPELINE_CONFIG;
  if(!raw)return;return JSON.parse(raw);
 };
 async function tick(){if(busy)return;busy=true;try{
  for(const candidate of store.all('job').filter(j=>['queued','dispatching','uncertain'].includes(j.status))){
   if(candidate.status==='uncertain'&&Date.now()-(candidate.lastAttemptAt||0)<30000)continue;
   if(candidate.requestedExecutionProfile==='isolated-codex'&&!candidate.runId){
    const d=store.get('design',candidate.designId),i=store.get('implementation',candidate.conversationId),p=store.get('project',candidate.projectId);
    if(p?.deletedAt||p?.participantBuildsEnabled!==true||d?.owner!==candidate.owner||i?.owner!==candidate.owner||!store.get('membership',candidate.projectId+':'+candidate.owner)){
     const attempted=candidate.attempts>0;
     store.put('job',{...candidate,status:attempted?'uncertain':'failed',error:attempted?'participant_execution_revoked_uncertain':'participant_execution_revoked',progress:attempted?'Permission revoked after uncertain delivery. No resubmission allowed; an organiser must reconcile possible original acceptance.':'New execution stopped: participant permission was revoked. Saved work is preserved.'});continue;
    }
   }
   const cfg=configFor(candidate);if(!cfg)continue;
   const binding=pipelineBinding(cfg);
   if(candidate.dispatchBinding?JSON.stringify(candidate.dispatchBinding)!==JSON.stringify(binding):candidate.attempts>0){
    store.put('job',{...candidate,status:'uncertain',error:'workflow_binding_changed',progress:candidate.dispatchBinding?'Workflow configuration changed. Restore the original installation and definition grant to recover this request; no replacement run started.':'Legacy request has no recorded workflow binding. An operator must reconcile its original acceptance before retrying; no replacement run started.'});continue;
   }
   if(candidate.requestedExecutionProfile==='isolated-codex'&&candidate.runId){store.put('job',{...candidate,status:'running',progress:'Recovering the original accepted isolated run; no new execution started.'});continue;}
   let client=clients.get(lane(candidate));if(!client){client=createClient(cfg);clients.set(lane(candidate),client);}
   const j=store.transaction(()=>{let fresh=store.get('job',candidate.id)!;if(fresh.status==='running'||fresh.status==='complete')return;
    if(fresh.kind==='interview'&&fresh.context?.attachments?.length&&fresh.attempts===0&&!fresh.runId)fresh=createInterviewImageAccess(store,cfg.clientOrigin).activateFirstDispatch(fresh.id);
    return store.put('job',{...fresh,dispatchBinding:fresh.dispatchBinding||binding,status:'dispatching',attempts:fresh.attempts+1,progress:'Connecting to the managed agent',lastAttemptAt:Date.now()});});if(!j)continue;
   try{
    const submitted=await client.submit(pipelineJobInput(j),j.id);
    const r=submitted.response as any;const runId=r.runId||r.run?.id||r.id;
    if(typeof runId!=='string')throw Error('Pipeline did not return a run reference');
    store.transaction(()=>{const current=store.get('job',j.id)!;if(['dispatching','uncertain'].includes(current.status))store.put('job',{...current,runId,definitionId:cfg.definitionId,status:'running',progress:current.kind==='interview'?'Your designer is working on that now':'Your builder is working on that now',dispatchReceipt:submitted.receipt});});
   }catch(e){store.transaction(()=>{const current=store.get('job',j.id)!;if(!['dispatching','uncertain'].includes(current.status))return;store.put('job',{...current,status:'uncertain',error:e instanceof Error?e.message:'Pipeline delivery uncertain',progress:'Delivery needs recovery; retry uses the same request identity'});});}
  }
  for(const j of store.all('job').filter(j=>j.status==='running'&&j.runId&&Date.now()-(j.lastPollAt||0)>15000)){
   const cfg=configFor(j);if(!cfg)continue;if(j.dispatchBinding&&JSON.stringify(j.dispatchBinding)!==JSON.stringify(pipelineBinding(cfg))){store.put('job',{...j,lastPollAt:Date.now(),pollError:'Workflow binding changed; restore its original grant for recovery.'});continue;}let client=clients.get(lane(j));if(!client){client=createClient(cfg);clients.set(lane(j),client);}
   try{const state=await client.poll(j.runId);const delivery=await client.delivery(j.runId);
    if(shouldRetryDelivery(j,(delivery.response as any).delivery)){await client.retryDelivery(j.runId);const fresh=store.get('job',j.id)!;if(fresh.status==='running')store.put('job',{...fresh,lastDeliveryRetryAt:Date.now(),progress:'Signed result delivery requeued; original run preserved'});}
    const current=store.get('job',j.id)!;if(current.status!=='running')continue;
    store.put('job',{...current,lastPollAt:Date.now(),pipelineState:state.response,deliveryState:delivery.response,progress:current.kind==='interview'?'Your designer is working on that now':'Your builder is working on that now'});
   }catch(e){const current=store.get('job',j.id)!;if(current.status==='running')store.put('job',{...current,lastPollAt:Date.now(),pollError:e instanceof Error?e.message:'Recovery check failed'});}
  }

 }finally{busy=false;}}
 const timer=setInterval(()=>void tick(),5000);timer.unref();const ready=tick();return {tick,ready,stop:()=>clearInterval(timer)};
}
