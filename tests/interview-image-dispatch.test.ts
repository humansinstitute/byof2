import {expect,test} from 'bun:test';
import {Store} from '../src/store';
import {createInterviewImages} from '../src/interview-images';
import {createInterviewImageAccess} from '../src/interview-image-access';
import {startDispatcher} from '../src/dispatcher';

test('delayed first dispatch activates fresh image ticket once; uncertain retries retain exact immutable submitted ticket',async()=>{
 const store=new Store(':memory:');store.put('design',{id:'d',owner:'u'});
 const image=createInterviewImages(store).upload('u','d',{name:'ref.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='});
 store.put('message',{id:'m',conversationId:'d',author:'u',imageIds:[image.id]});
 store.put('job',{id:'j',kind:'interview',owner:'u',designId:'d',conversationId:'d',projectId:'p',messageId:'m',status:'queued',attempts:0,context:{message:'',history:[]}});
 const pinned=createInterviewImageAccess(store,'https://byo.example',()=>1).pin('u','d','j','m',[image.id]);store.put('job',{...store.get('job','j')!,context:{...store.get('job','j')!.context,...pinned}});
 const cfg={origin:'https://autopilot.example',clientOrigin:'https://byo.example',installationId:'i',appId:'a',ownerNpub:'owner',definitionId:'v5',callbackUrl:'https://byo.example/api/pipeline-webhook',credentialFile:'/unused',appPubkey:'a'.repeat(64)};
 const sent:any[]=[];const worker=startDispatcher(store,{INTERVIEW_PIPELINE_CONFIG:JSON.stringify(cfg)},(()=>({submit:async(job:any)=>{sent.push(structuredClone(job));throw Error('HTTP acceptance response lost');}})) as any);
 try{
  await worker.ready;expect(sent).toHaveLength(1);expect(sent[0].context.attachmentSource.expiresAt).toBeGreaterThan(Date.now());expect(sent[0].context.attachmentSource.ticket).not.toBe(pinned.attachmentSource!.ticket);
  store.put('job',{...store.get('job','j')!,lastAttemptAt:0});await worker.tick();expect(sent).toHaveLength(2);expect(sent[1]).toEqual(sent[0]);
  expect(()=>createInterviewImageAccess(store,cfg.clientOrigin).activateFirstDispatch('j')).toThrow('cannot change');
 }finally{worker.stop();store.db.close();}
});
