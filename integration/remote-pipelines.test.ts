import {test, expect} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {createHash} from 'node:crypto';
import {verifyPipelineCallback} from './remote-pipelines';
import prepare from '../pipelines/functions/prepare-interview.v1';
import finish from '../pipelines/functions/finish-interview.v1';
import gate from '../pipelines/functions/builder-gate.v1';
const secret=generateSecretKey(),pubkey=getPublicKey(secret),url='https://example.org/api/pipeline-webhook';
function request(body:string, options:{url?:string;time?:number;delivery?:string}={}) {
 const event=finalizeEvent({kind:27235,created_at:options.time??Math.floor(Date.now()/1000),content:'',tags:[['u',options.url??url],['method','POST'],['payload',createHash('sha256').update(body).digest('hex')],['delivery',options.delivery??'delivery'],['run','run']]},secret);
 return new Request(url,{method:'POST',body,headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(event)).toString('base64'),'x-wingman-delivery-id':'delivery','x-wingman-run-id':'run'}});
}
const body=JSON.stringify({deliveryId:'delivery',runId:'run',status:'ok',terminal:true,result:{response:'hello'},error:null});
test('signed terminal callback validates exact correlation',async()=>{expect((await verifyPipelineCallback(request(body),{url,pubkey})).envelope.runId).toBe('run');});
test('callback rejects stale, mismatched URL, wrong pinned signer, changed correlation',async()=>{
 for(const options of [{time:1},{url:'https://evil.example/api/pipeline-webhook'},{delivery:'foreign'}]) await expect(verifyPipelineCallback(request(body,options),{url,pubkey})).rejects.toThrow();
 await expect(verifyPipelineCallback(request(body),{url,pubkey:getPublicKey(generateSecretKey())})).rejects.toThrow();
});
test('interview selects enforced profile and separates native/app context',async()=>{
 const native=await prepare({job:{id:'job',kind:'interview',conversationId:'chat',projectId:'project',message:'I need freedom',snapshot:{document:'My edited design'}}});
 expect(native.executionProfile).toBe('isolated-codex');expect(native.directory).toBe('/workspace');expect(native.prompt).toContain('My edited design');
});
test('interview validates complete saved design independently of prose',async()=>{
 const design={title:'Freedom',document:'## Confirmed facts\nI want more time',response:'What would help?'};
 const result=await finish({turn:{status:'completed',reply:'ordinary prose',output:{executionProfile:'isolated-codex',projectFiles:[{path:'design-result.json',base64:Buffer.from(JSON.stringify(design)).toString('base64')}]}}});
 expect(result.snapshot.document).toBe(design.document);
 await expect(finish({turn:{status:'completed',reply:JSON.stringify(design),output:{executionProfile:'isolated-codex',projectFiles:[]}}})).rejects.toThrow();
});
test('builder cannot silently fall back to unisolated host',async()=>{await expect(gate()).rejects.toThrow('no explicit app publication tool');});
