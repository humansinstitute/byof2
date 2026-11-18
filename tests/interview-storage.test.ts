import {test,expect} from 'bun:test';
import {Store} from '../src/store';
import {storeInterviewImage} from '../src/interview-storage';
import {createBrowserOperations} from '../src/nstack-browser';
import {runBrowserOperation,validateBrowserChallenge} from '../public/nstack-browser';
import {finalizeEvent,generateSecretKey,getPublicKey,nip19} from 'nostr-tools';
import {hash} from '../src/auth';
const key=generateSecretKey(),actor=getPublicKey(key),owner=nip19.npubEncode(actor);
const c:any={endpoint:'https://stack.example',workspaceId:'11111111-1111-4111-8111-111111111111',workspaceOwnerNpub:owner,workspaceAppNpub:owner,serviceNpub:owner,mode:'browser-user'};
const image={id:'image',name:'reference.png',mimeType:'image/png',bytes:3,base64:'YWJj',sha256:hash('abc')};
const design={id:'d',projectId:'p',owner:actor};const objectId='22222222-2222-4222-8222-222222222222';
test('real browser authorization loop uploads only exact private image to selected Tower, verifies receipt, retries safely',async()=>{
 const store=new Store(':memory:');const requests:any[]=[];
 const broker=createBrowserOperations((async(url:any,init:any)=>{
  const e=JSON.parse(Buffer.from(init.headers.authorization.slice(6),'base64').toString());expect(e.pubkey).toBe(actor);const body=init.body?JSON.parse(init.body):undefined;requests.push({url,method:init.method,body});
  if(String(url).endsWith('/prepare'))return Response.json({object_id:objectId,owner_npub:owner,is_public:false});
  if(init.method==='GET')return Response.json({object_id:objectId,owner_npub:owner,is_public:false,sha256_hex:image.sha256,size_bytes:'3',completed_at:new Date().toISOString()});
  return Response.json({object_id:objectId});
 }) as typeof fetch);
 const plan={...c,mode:'interview-images',image:{...image,base64:undefined,designId:'d'}};
 const api=async(path:string,_method?:string,body?:any)=>path==='/api/designs/d/images'?broker.start(actor,plan,transport=>storeInterviewImage(store,c,(_c,r)=>transport(plan,r),image,design,actor)):broker.authorize(actor,body);
 const signer={getPublicKey:async()=>actor,signEvent:async(e:any)=>finalizeEvent(e,key)};
 try{
  expect(await runBrowserOperation(api,signer,'/api/designs/d/images',image)).toEqual({objectId,storage:'nstack-private'});
  expect(requests.map(r=>r.method)).toEqual(['POST','PUT','POST','GET']);expect(requests[0].body.is_public).toBe(false);expect(requests[0].body.metadata.participantOwner).toBe(actor);expect(requests[1].body).toEqual({base64_data:'YWJj'});expect(requests[2].body.sha256_hex).toBe(hash('abc'));
  expect(store.all('interviewImageStorage')[0]!.complete).toBe(true);
  await runBrowserOperation(api,signer,'/api/designs/d/images',image);expect(requests).toHaveLength(5);
 }finally{store.db.close();}
});
test('storage failure retains recoverable object binding and does not claim success; changed hash fails readback',async()=>{
 const store=new Store(':memory:');let fail=true,prepares=0;
 const transport:any=async(_:any,r:any)=>{if(r.path.endsWith('/prepare')){prepares++;return Response.json({object_id:objectId,owner_npub:owner,is_public:false});}if(r.method==='PUT'&&fail)return Response.json({error:'Upload unavailable'},{status:503});if(r.method==='GET')return Response.json({object_id:objectId,is_public:false,owner_npub:owner,sha256_hex:'0'.repeat(64),size_bytes:3,completed_at:'now'});return Response.json({});};
 try{await expect(storeInterviewImage(store,c,transport,image,design,actor)).rejects.toThrow('Upload unavailable');expect(store.all('interviewImageStorage')[0]!.complete).toBe(false);fail=false;await expect(storeInterviewImage(store,c,transport,image,design,actor)).rejects.toThrow('readback mismatch');expect(prepares).toBe(1);expect(store.all('interviewImageStorage')[0]!.complete).toBe(false);}finally{store.db.close();}
});
test('image signing plan rejects public writes, foreign Tower, path changes, unrelated methods and oversized payload',()=>{
 const plan={...c,mode:'interview-images',image:{...image,designId:'d'}};const challenge={id:'one',url:c.endpoint+`/api/v4/storage/${objectId}`,method:'PUT',body:JSON.stringify({base64_data:'YWJj'})};expect(validateBrowserChallenge(plan,challenge)).toEqual(challenge);
 for(const altered of [{...challenge,url:'https://evil.example/api/v4/storage/'+objectId},{...challenge,method:'DELETE'},{...challenge,url:c.endpoint+'/api/v4/storage/'+objectId+'/publish'},{...challenge,body:JSON.stringify({base64_data:'YWJj',is_public:true})},{...challenge,body:'x'.repeat(2900001)}])expect(()=>validateBrowserChallenge(plan,altered)).toThrow();
});
test('uncertain completion is reconciled by private metadata before retrying transfer; changed connection stops final success',async()=>{
 const store=new Store(':memory:');let completed=false,lost=true,puts=0,changed=false;
 const transport:any=async(_:any,r:any)=>{if(r.path.endsWith('/prepare'))return Response.json({object_id:objectId,owner_npub:owner,is_public:false});if(r.method==='PUT'){puts++;return Response.json({});}if(r.path.endsWith('/complete')){completed=true;if(lost)throw Error('Completion response lost');return Response.json({});}return Response.json({object_id:objectId,is_public:false,owner_npub:owner,sha256_hex:image.sha256,size_bytes:3,completed_at:completed?'now':null});};
 const guard=()=>{if(changed)throw Error('Connection changed');};
 try{await expect(storeInterviewImage(store,c,transport,image,design,actor,guard,2)).rejects.toThrow('response lost');expect(store.all('interviewImageStorage')[0]!.complete).toBe(false);lost=false;expect((await storeInterviewImage(store,c,transport,image,design,actor,guard,2)).storage).toBe('nstack-private');expect(puts).toBe(1);
  changed=true;await expect(storeInterviewImage(store,c,transport,image,design,actor,guard,2)).rejects.toThrow('Connection changed');
  changed=false;const guarded:any=async(_:any,r:any)=>{const value=await transport(_,r);if(r.method==='GET')changed=true;return value;};await expect(storeInterviewImage(store,c,guarded,image,design,actor,guard,2)).rejects.toThrow('Connection changed');expect(puts).toBe(1);
 }finally{store.db.close();}
});
test('wrong storage object, owner or visibility cannot confirm a private upload',async()=>{
 for(const altered of [{object_id:'33333333-3333-4333-8333-333333333333'},{owner_npub:'foreign'},{is_public:true}]){
  const store=new Store(':memory:');const transport:any=async(_:any,r:any)=>r.path.endsWith('/prepare')?Response.json({object_id:objectId,owner_npub:owner,is_public:false}):r.method==='GET'?Response.json({object_id:objectId,owner_npub:owner,is_public:false,sha256_hex:image.sha256,size_bytes:'3',completed_at:'now',...altered}):Response.json({});
  try{await expect(storeInterviewImage(store,c,transport,image,design,actor)).rejects.toThrow('readback mismatch');expect(store.all('interviewImageStorage')[0]!.complete).toBe(false);}finally{store.db.close();}
 }
});
