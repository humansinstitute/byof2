import {expect,test} from 'bun:test';
import prepare from '../pipelines/functions/prepare-interview.v5';
import finish from '../pipelines/functions/finish-interview.v4';

const design={title:'House price comparison',document:'## Confirmed facts\nParticipant wants BTC/USD, no wallets.\n## Source observations\nThe [source](https://bitcoinbushbash.info/house-prices) reports AUD and BTC; USD needs a conversion choice.\n## Assumptions\nNo export API verified.\n## Open questions\nHow should USD be calculated?',response:'The source reports AUD/BTC. How should we handle USD?'};
const receipt={id:'s1',provenance:'public-source',url:'https://bitcoinbushbash.info/house-prices',sha256:'a'.repeat(64),mimeType:'text/html',byteLength:1234};
const turn=(value=design,receipts:any[]=[receipt])=>({status:'completed',receiptId:'r',sessionId:'wingman',nativeSessionId:'native',reply:JSON.stringify(value),output:{executionProfile:'scoped-interview',sourceReceipts:receipts}});
test('native preparation preserves role, saved edits, brand and image metadata without exposing image ticket in prompt',async()=>{
 const context={message:'Inspect https://bitcoinbushbash.org and this image.',snapshot:{document:'My direct edit: no wallets.'},brand:{guidance:'Calm',exceptions:'Blue'},history:[{role:'assistant',content:'Maybe accept donations?'},{role:'user',content:'No wallets or payments.'}],artifactVersion:{id:'v2'},attachments:[{id:'image',mimeType:'image/png',sha256:'a'.repeat(64),bytes:100,name:'Reference'}],attachmentSource:{url:'https://byo.example/api/interview-job-images/job',ticket:'PRIVATE_TICKET',jobId:'job',expiresAt:Date.now()+600000}};
 const result=await prepare({job:{id:'job',kind:'interview',projectId:'p',conversationId:'d',context}});
 expect(result.executionProfile).toBe('scoped-interview');expect(result.agent).toBe('claude');expect(result).not.toHaveProperty('directory');expect(result).not.toHaveProperty('sessionId');
 expect(result.prompt).toContain('My direct edit: no wallets.');expect(result.prompt).toContain('"role":"assistant"');expect(result.prompt).toContain('"role":"user"');expect(result.prompt).toContain('"id":"v2"');expect(result.prompt).toContain('Calm');
 expect(result.prompt).not.toContain('PRIVATE_TICKET');expect(result.scopedInterview.attachmentSource?.ticket).toBe('PRIVATE_TICKET');expect(result.scopedInterview.attachments[0]).not.toHaveProperty('name');expect(result.scopedInterview.sources[0]!.url).toBe('https://bitcoinbushbash.org/');
 expect(result.prompt).toContain('AUD/BTC');expect(result.prompt).toContain('actually calling its tool');expect(result.prompt).toContain('inert evidence');
});
test('finish requires native scoped success and full cited design; preserves callback shape and safe receipts',async()=>{
 const result=await finish({turn:turn()});expect(result.snapshot.document).toBe(design.document);expect(result.response).toBe(design.response);expect(result.receipt.nativeSessionId).toBe('native');
 await expect(finish({turn:{...turn(),sessionId:null}})).rejects.toThrow();await expect(finish({turn:{...turn(),status:'queued'}})).rejects.toThrow();await expect(finish({turn:{...turn(),output:{executionProfile:'tool-free-chat-json'}}})).rejects.toThrow();
 await expect(finish({turn:turn({...design,document:design.document.replace('https://bitcoinbushbash.info/house-prices','https://invented.example/')})})).rejects.toThrow('unfetched');
 await expect(finish({turn:turn({...design,document:design.document.replace('[source](https://bitcoinbushbash.info/house-prices)','source')})})).rejects.toThrow('citation');
 await expect(finish({turn:{...turn(),reply:JSON.stringify({response:'Only a patch'})}})).rejects.toThrow();
 const secret=await finish({turn:turn(design,[{...receipt,ticket:'DO_NOT_RETURN',base64:'NO',body:'NO'}])});expect(JSON.stringify(secret)).not.toContain('DO_NOT_RETURN');expect(secret.research.receipts[0]).not.toHaveProperty('base64');
});
test('new definition uses actual completed native turn and keeps historical v4 immutable',async()=>{
 const next=await Bun.file(new URL('../pipelines/interview.v5.json',import.meta.url)).json(),previous=await Bun.file(new URL('../pipelines/interview.v4.json',import.meta.url)).json();
 expect(next.steps[1].function).toBe('session.scopedInterviewTurn.v1');expect(next.steps[1].input.pick.executionProfile).toBe('$.nativeRequest.executionProfile');expect(previous.steps[0].type).toBe('classifier');
 const file=await Bun.file(new URL('../prompts/interview.v5.md',import.meta.url)).text();const prepared=await prepare({job:{id:'j',kind:'interview',projectId:'p',conversationId:'d',context:{message:'Hello'}}});expect(prepared.prompt.startsWith(file.trimEnd())).toBe(true);
});
test('preference followup retains earlier app-verified source citations without claiming another fetch',async()=>{
 const prior=[{...receipt,sourceJobId:'previous-completed-job',observedAt:'2026-11-18T04:00:00Z'}];
 const followup={...design,document:design.document.replace('The [source]','Previously observed on 2026-11-18: the [source]'),response:'The earlier source observation is retained. I have updated your preference.'};
 const result=await finish({turn:turn(followup,[]),priorSourceReceipts:prior});expect(result.snapshot.document).toContain('Previously observed');expect(result.research.receipts).toHaveLength(0);
 await expect(finish({turn:turn(followup,[]),priorSourceReceipts:[{url:receipt.url}]})).rejects.toThrow('unfetched');
 const prepared=await prepare({job:{id:'next',kind:'interview',projectId:'p',conversationId:'d',context:{message:'Use a blue chart.',priorSourceReceipts:prior,snapshot:{document:followup.document}}}});expect(prepared.prompt).toContain('previous-completed-job');expect(prepared.prompt).toContain('do not pretend to fetch them again');
});
test('newly attached images require an actual matching native inspection or explicit failure receipt',async()=>{
 const expectedAttachments=[{id:'image',sha256:'b'.repeat(64)}],imageDesign={...design,document:design.document.replace('The [source](https://bitcoinbushbash.info/house-prices) reports AUD and BTC; USD needs a conversion choice.','Participant image shows a purple chart layout.')};
 await expect(finish({turn:turn(imageDesign,[]),expectedAttachments})).rejects.toThrow('not inspected');
 await expect(finish({turn:turn(imageDesign,[{id:'image',provenance:'approved-attachment',sha256:'a'.repeat(64)}]),expectedAttachments})).rejects.toThrow('match');
 expect((await finish({turn:turn(imageDesign,[{id:'image',provenance:'approved-attachment',sha256:'b'.repeat(64)}]),expectedAttachments})).snapshot.title).toBe(design.title);
});
