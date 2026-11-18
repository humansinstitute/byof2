export const name='byofreedom.prepareInterview.v4';
export const description='Bound app-owned interview context and pinned project branding for a tool-free model call.';
export const version=4;
export default async function prepare(input:Record<string,any>){
 const job=input.job,context=job?.context??job;
 if(!job||job.kind!=='interview'||typeof job.id!=='string'||typeof context.message!=='string')throw Error('Interview job required');
 const evidence={requestId:job.id,brand:context.brand??null,snapshot:context.snapshot??null,implementedVersion:context.implementedVersion??context.artifactVersion??null,history:context.history??[],message:context.message};
 if(JSON.stringify(evidence).length>160000)throw Error('Interview context too large; compact older history before dispatch');
 return evidence;
}
