import {afterEach,expect,test} from 'bun:test';
import {Store} from '../src/store';
import {createInterviewImages} from '../src/interview-images';
import {createInterviewImageAccess} from '../src/interview-image-access';

const png={name:'reference.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='};
const stores:Store[]=[];afterEach(()=>{for(const s of stores.splice(0))s.db.close();});
function setup(){const store=new Store(':memory:');stores.push(store);store.put('design',{id:'d',owner:'u'});const image=createInterviewImages(store).upload('u','d',png);store.put('message',{id:'m',author:'u',conversationId:'d',imageIds:[image.id]});store.put('job',{id:'j',kind:'interview',owner:'u',designId:'d',messageId:'m',status:'running',runId:'r'});let time=1000;const access=createInterviewImageAccess(store,'https://byo.example',()=>time),pinned=access.pin('u','d','j','m',[image.id]);const req=(headers:Record<string,string>={},url=pinned.attachmentSource!.url)=>new Request(url,{headers:{'x-byo-image-ticket':pinned.attachmentSource!.ticket,'x-wingman-run-id':'r','x-byo-image-id':image.id,...headers}});return {store,image,access,pinned,req,advance:()=>time+=600001};}
test('ticket returns only exact pinned bytes for registered native run and no general authentication',async()=>{
 const {access,req,pinned,store}=setup();expect(pinned.attachments[0]).not.toHaveProperty('base64');expect(store.get('interviewImageAccess','j')).not.toHaveProperty('ticket');
 expect(Buffer.from(await access.response(req(),'j').arrayBuffer()).toString('base64')).toBe(png.base64);
 for(const headers of [{'x-wingman-run-id':'other'},{'x-byo-image-id':'other'},{'x-byo-image-ticket':'bad'}] as Record<string,string>[])expect(()=>access.response(req(headers),'j')).toThrow();
 expect(()=>access.response(req(),'other-job')).toThrow();expect(()=>access.response(req({},pinned.attachmentSource!.url+'?secret=other'),'j')).toThrow();
});
test('prebinding is explicit409 and expiry, changed message, or completed job cannot reuse ticket',()=>{
 const {access,req,store,advance}=setup(),job=store.get('job','j')!;
 store.put('job',{...job,runId:null});try{access.response(req(),'j');throw Error('Expected denial');}catch(e){expect((e as any).status).toBe(409);}
 store.put('job',job);expect(access.response(req(),'j').status).toBe(200);
 store.put('job',{...job,status:'complete'});expect(()=>access.response(req(),'j')).toThrow();
 store.put('job',job);store.put('message',{id:'m',author:'u',conversationId:'d',imageIds:[]});expect(()=>access.response(req(),'j')).toThrow();
 advance();expect(()=>access.response(req(),'j')).toThrow();
});
