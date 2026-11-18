import {test,expect} from 'bun:test';
import {EventEmitter} from 'node:events';
import {createPublicNStackFetch} from '../src/nstack-http';

test('NStack HTTPS pins the validated DNS address in TLS lookup and never follows redirect',async()=>{
 let calls=0;const read=createPublicNStackFetch((async()=>[{address:'8.8.8.8',family:4}]) as any,((url:any,options:any,callback:any)=>{
  calls++;expect(url.hostname).toBe('tower.example');expect(options.agent).toBe(false);expect(options.rejectUnauthorized).not.toBe(false);
  options.lookup('tower.example',{},(error:any,address:any,family:any)=>{expect(error).toBe(null);expect(address).toBe('8.8.8.8');expect(family).toBe(4);});
  options.lookup('tower.example',{all:true},(error:any,addresses:any)=>{expect(error).toBe(null);expect(addresses).toEqual([{address:'8.8.8.8',family:4}]);});
  const req=new EventEmitter() as any;req.write=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter() as any;res.statusCode=302;res.headers={location:'http://127.0.0.1/secret'};callback(res);res.emit('data',Buffer.from('redirect refused'));res.emit('end');});return req;
 }) as any);
 const response=await read('https://tower.example/.well-known/nstack.json');expect(response.status).toBe(302);expect(calls).toBe(1);
});
test('NStack HTTPS rejects private or mixed DNS before opening any socket',async()=>{
 let calls=0;for(const addresses of [[{address:'127.0.0.1',family:4}],[{address:'8.8.8.8',family:4},{address:'10.0.0.2',family:4}]]){
 const read=createPublicNStackFetch((async()=>addresses) as any,(()=>{calls++;throw new Error('must not connect')}) as any);await expect(read('https://tower.example/')).rejects.toThrow('private network');}
 expect(calls).toBe(0);
});
