import {test,expect} from 'bun:test';
import prepare from '../pipelines/functions/prepare-interview.v2';
import finish from '../pipelines/functions/finish-interview.v2';
import publish from '../pipelines/functions/agent-publish.v2';
import finishBuilder from '../pipelines/functions/finish-builder.v2';
test('tool-free interview preserves authoritative app edits and exact artifact feedback',async()=>{
 const result=await prepare({job:{id:'job',kind:'interview',context:{message:'I tried v2',snapshot:{id:'s3',document:'direct edit'},implementedVersion:{id:'v2'},history:[{role:'user',content:'hello'}]}}});
 expect(result.snapshot.document).toBe('direct edit');expect(result.implementedVersion.id).toBe('v2');
 expect(JSON.stringify(result)).not.toContain('executionProfile');
});
test('every valid tool-free response requires a full design',async()=>{
 expect((await finish({design:{title:'Freedom',document:'Confirmed facts\nMore free time',response:'What would you do?'}})).snapshot.title).toBe('Freedom');
 await expect(finish({design:{response:'Answer only'}})).rejects.toThrow();
 await expect(finish({design:{title:'x',document:'',response:'yes'}})).rejects.toThrow();
});
test('publication denies model-selected authority and unknown argument fields before side effects',async()=>{
 await expect(publish({args:{files:{'index.html':'x'}}})).rejects.toThrow('lineage');
 const input={input:{settings:{publicOrigin:'https://example.org'},job:{id:'j',kind:'implementation',projectId:'p',snapshotId:'s'}},nativeReceipt:{requestId:'j',projectId:'p',runId:'r'},args:{publicationId:'p',title:'t',files:{'../escape':'bad','index.html':'<html></html>'},validation:['check']}};
 await expect(publish(input)).rejects.toThrow('package');
 await expect(publish({...input,args:{...input.args,files:{'index.html':'<html></html>'},url:'https://evil.example'}})).rejects.toThrow('arguments');
});
test('ordinary builder prose is not parsed into artifact versions',async()=>{
 const result=await finishBuilder({turn:{status:'completed',reply:'No changes needed',requestId:'r'}});
 expect(result.response).toBe('No changes needed');expect(result).not.toHaveProperty('artifact');expect(result).not.toHaveProperty('files');
});
test('new builder definition pins scoped storage preparation while old definitions stay immutable',async()=>{
 const definition=await Bun.file(new URL('../pipelines/builder.v5.json',import.meta.url)).json();
 expect(definition.steps[0].function).toBe('byofreedom.prepareBuilder.v4');
 expect(definition.steps[1].agentTools['byofreedom.publish']).toBe('byofreedom.agentPublish.v4');
 const source=await Bun.file(new URL('../pipelines/functions/prepare-builder.v4.ts',import.meta.url)).text();expect(source).toContain('exact-version installation');expect(source).toContain('do not substitute localStorage/SQLite');
 expect((await Bun.file(new URL('../pipelines/builder.v4.json',import.meta.url)).json()).steps[0].function).toBe('byofreedom.prepareBuilder.v3');
});
