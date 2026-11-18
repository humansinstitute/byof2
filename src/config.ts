export function config(env:Record<string,string|undefined>=process.env){
 const origin=env.PUBLIC_ORIGIN||'http://localhost:3344';const production=env.NODE_ENV==='production';
 if(new URL(origin).origin!==origin)throw new Error('PUBLIC_ORIGIN must be an origin without path');
 if(production&&!origin.startsWith('https://'))throw new Error('Production requires HTTPS PUBLIC_ORIGIN');
 return {origin,production,port:Number(env.PORT||3344),database:env.DATABASE_PATH||'data/byo.sqlite',workerPubkey:env.WORKER_PUBKEY||'',webhookPubkey:env.AUTOPILOT_WEBHOOK_PUBKEY||'',integrationEnabled:Boolean(env.INTERVIEW_PIPELINE_CONFIG),builderEnabled:Boolean(env.BUILDER_PIPELINE_CONFIG),interviewWorkflowVersion:env.INTERVIEW_WORKFLOW_VERSION||'interview-v3',builderWorkflowVersion:env.BUILDER_WORKFLOW_VERSION||'builder-v3',interviewImagesEnabled:Boolean(env.INTERVIEW_PIPELINE_CONFIG)&&['interview-v5','interview-v6'].includes(env.INTERVIEW_WORKFLOW_VERSION||'')&&env.INTERVIEW_SCOPED_TOOLS==='1',version:env.APP_VERSION||'0.1.0'};
}
