import {test,expect} from 'bun:test';
import {finalizeEvent,generateSecretKey,getPublicKey} from 'nostr-tools';
import {createHash} from 'node:crypto';
import {Store} from '../src/store';
import {verifyAgentActivity,acceptAgentActivity,activityForJob,type AgentActivity} from '../src/agent-activity';
import {renderAgentActivity} from '../public/agent-activity';
const key=generateSecretKey(),url='https://example.com/api/agent-activity';
const event=(changes:Partial<AgentActivity>={}):AgentActivity=>({version:1,eventId:'a'.repeat(64),sequence:1,runId:'run',stepId:'step',sessionId:'session',turnId:'turn',correlation:{jobId:'job',requestId:'request',projectId:'project',designId:'design',conversationId:'conversation'},timestamp:new Date().toISOString(),type:'commentary',content:'Checking your design.',...changes});
function request(e:AgentActivity,override:any={}){const body=JSON.stringify(e);const signed=finalizeEvent({kind:27235,created_at:Math.floor(Date.now()/1000),content:'',tags:[['u',url],['method','POST'],['payload',createHash('sha256').update(body).digest('hex')],['event',e.eventId],['run',e.runId]],...override},key);return new Request(url,{method:'POST',headers:{authorization:'Nostr '+Buffer.from(JSON.stringify(signed)).toString('base64'),'x-wingman-event-id':e.eventId,'x-wingman-run-id':e.runId},body});}
function fixture(){const store=new Store(':memory:');store.put('project',{id:'project'});store.put('job',{id:'job',requestId:'request',projectId:'project',designId:'design',conversationId:'conversation',runId:'run',workflowVersion:'interview-v7',status:'running'});return store;}
test('instance signature, exact target/body/headers and bounded public event schema',async()=>{
 const e=event();expect((await verifyAgentActivity(request(e),[url],getPublicKey(key))).event).toEqual(e);
 for(const req of [request(e,{created_at:1}),request(e,{tags:[['u','https://evil.example'],['method','POST']]}),request(event({type:'tools',content:'raw tool arguments'})),request({...e,reasoning:'private'} as any)])await expect(verifyAgentActivity(req,[url],getPublicKey(key))).rejects.toThrow();
 await expect(verifyAgentActivity(request(e),[url],getPublicKey(generateSecretKey()))).rejects.toThrow();const r=request(e);r.headers.set('x-wingman-run-id','foreign');await expect(verifyAgentActivity(r,[url],getPublicKey(key))).rejects.toThrow();
});
test('durable retry, immutable turn and correlation, gaps/order and terminal authority',()=>{
 const store=fixture();try{const e=event();acceptAgentActivity(store,e,'same');acceptAgentActivity(store,e,'same');expect(activityForJob(store,store.get('job','job')!)).toHaveLength(1);
 expect(()=>acceptAgentActivity(store,e,'changed')).toThrow();
 for(const modified of [{correlation:{...e.correlation,designId:'foreign'}},{runId:'foreign'},{turnId:'other'},{sessionId:'other'}])expect(()=>acceptAgentActivity(store,event({...modified,eventId:'b'.repeat(64),sequence:2}),'other')).toThrow();
 acceptAgentActivity(store,event({eventId:'c'.repeat(64),sequence:3,type:'completed',content:'Completed'}),'third');
 acceptAgentActivity(store,event({eventId:'b'.repeat(64),sequence:2,type:'tools',content:'Using tools'}),'second');
 expect(activityForJob(store,store.get('job','job')!).map(x=>x.sequence)).toEqual([1,2,3]);expect(store.get('job','job')!.status).toBe('running');expect(store.all('message')).toHaveLength(0);
 store.put('job',{...store.get('job','job')!,status:'complete'});acceptAgentActivity(store,event({eventId:'d'.repeat(64),sequence:4}),'late');expect(store.get('job','job')!.status).toBe('complete');
 store.put('project',{id:'project',deletedAt:'now'});expect(()=>acceptAgentActivity(store,e,'same')).toThrow();
 }finally{store.db.close();}
});
test('activity view escapes commentary and hides internal binding/fingerprint',()=>{
 const store=fixture();try{acceptAgentActivity(store,event({content:'<script>private-looking markup</script>'}),'body');const events=activityForJob(store,store.get('job','job')!);expect(Object.keys(events[0]).sort()).toEqual(['content','id','sequence','timestamp','type']);const html=renderAgentActivity({id:'job',status:'running',activity:events as any});expect(html).toContain('&lt;script&gt;');expect(html).not.toContain('<script>');expect(html).toContain('Agent activity');}finally{store.db.close();}
});
test('reply-first and workshop workflows retain signed activity with the same immutable binding checks',async()=>{
 for(const workflowVersion of ['interview-v8','interview-v9','interview-v10']){const store=fixture();try{store.put('job',{...store.get('job','job')!,workflowVersion});const verified=await verifyAgentActivity(request(event({type:'tools',content:'Using tools'})),[url],getPublicKey(key));acceptAgentActivity(store,verified.event,verified.fingerprint);expect(activityForJob(store,store.get('job','job')!)).toHaveLength(1);expect(()=>acceptAgentActivity(store,event({eventId:'b'.repeat(64),sequence:2,runId:'foreign'}),'other')).toThrow();}finally{store.db.close();}}
});
