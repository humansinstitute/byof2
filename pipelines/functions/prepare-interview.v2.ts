export const name='byofreedom.prepareInterview.v2';
export const description='Bound app-owned interview context for a tool-free model call.';
export const version=2;
export default async function prepare(input:Record<string,any>){
 const job=input.job,context=job?.context??job;
 if(!job||job.kind!=='interview'||typeof job.id!=='string'||typeof context.message!=='string')throw Error('Interview job required');
 const evidence={requestId:job.id,snapshot:context.snapshot??null,implementedVersion:context.implementedVersion??context.artifactVersion??null,history:context.history??[],message:context.message};
 if(JSON.stringify(evidence).length>160000)throw Error('Interview context too large; compact older history before dispatch');
 return evidence;
}
