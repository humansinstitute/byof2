// Keep this small: aliases are explicit migration bridges, never host patterns.
export const MAX_PUBLIC_ORIGIN_ALIASES=4;
function publicOrigin(value:string,setting:string,production:boolean){
 let url:URL;try{url=new URL(value);}catch{throw Error(`${setting} must be an origin without path, query, hash or userinfo`);}
 if(value.length>2048||url.origin!==value||url.username||url.password||url.pathname!=='/'||url.search||url.hash||value.includes('*')||!['https:','http:'].includes(url.protocol))throw Error(`${setting} must be an origin without path, query, hash or userinfo`);
 if(production&&url.protocol!=='https:')throw Error(`Production requires HTTPS ${setting}`);
 return value;
}
export function config(env:Record<string,string|undefined>=process.env){
 const production=env.NODE_ENV==='production';
 const origin=publicOrigin(env.PUBLIC_ORIGIN||'http://localhost:3344','PUBLIC_ORIGIN',production);
 const rawAliases=env.PUBLIC_ORIGIN_ALIASES||'';
 if(/[\u0000-\u001f\u007f]/.test(rawAliases))throw Error('Invalid PUBLIC_ORIGIN_ALIASES');
 if(rawAliases.length>MAX_PUBLIC_ORIGIN_ALIASES*2049)throw Error('Too many or oversized PUBLIC_ORIGIN_ALIASES');
 const aliases=rawAliases?rawAliases.split(','):[];
 if(aliases.length>MAX_PUBLIC_ORIGIN_ALIASES)throw Error('Too many PUBLIC_ORIGIN_ALIASES');
 const origins=[...new Set([origin,...aliases.map(alias=>publicOrigin(alias.trim(),'PUBLIC_ORIGIN_ALIASES',production))])];
 return {origin,origins,production,port:Number(env.PORT||3344),database:env.DATABASE_PATH||'data/byo.sqlite',workerPubkey:env.WORKER_PUBKEY||'',webhookPubkey:env.AUTOPILOT_WEBHOOK_PUBKEY||'',integrationEnabled:Boolean(env.INTERVIEW_PIPELINE_CONFIG),builderEnabled:Boolean(env.BUILDER_PIPELINE_CONFIG),interviewWorkflowVersion:env.INTERVIEW_WORKFLOW_VERSION||'interview-v3',builderWorkflowVersion:env.BUILDER_WORKFLOW_VERSION||'builder-v3',interviewImagesEnabled:Boolean(env.INTERVIEW_PIPELINE_CONFIG)&&['interview-v5','interview-v6','interview-v7','interview-v8','interview-v9'].includes(env.INTERVIEW_WORKFLOW_VERSION||'')&&env.INTERVIEW_SCOPED_TOOLS==='1',version:env.APP_VERSION||'0.1.0'};
}
