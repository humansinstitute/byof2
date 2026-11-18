import {afterEach,expect,test} from 'bun:test';
import {Store} from '../src/store';
import {createInterviewImages,validateInterviewImage} from '../src/interview-images';

const image={name:'reference.png',mimeType:'image/png',base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6ZQAAAABJRU5ErkJggg=='};
const stores:Store[]=[];
afterEach(()=>{for(const store of stores.splice(0))store.db.close();});
function setup(){const store=new Store(':memory:');stores.push(store);store.put('design',{id:'d',owner:'participant',projectId:'p'});store.put('design',{id:'other-design',owner:'participant',projectId:'p'});return {store,images:createInterviewImages(store)};}
test('private upload returns immutable metadata; only exact participant/design can read image bytes',async()=>{
 const {store,images}=setup();const saved=images.upload('participant','d',image);
 expect(saved).not.toHaveProperty('base64');expect(saved.sha256).toHaveLength(64);expect(saved.width).toBe(1);
 expect(images.upload('participant','d',image).id).toBe(saved.id);expect(store.all('interviewImage')).toHaveLength(1);
 expect(()=>images.response('outsider','d',saved.id)).toThrow();expect(()=>images.response('participant','other-design',saved.id)).toThrow();
 const response=images.response('participant','d',saved.id);expect(response.headers.get('cache-control')).toContain('no-store');expect(response.headers.get('content-type')).toBe('image/png');
 expect(Buffer.from(await response.arrayBuffer()).toString('base64')).toBe(image.base64);
 expect(images.context('participant','d',[saved.id])[0]!.base64).toBe(image.base64);
});
test('upload rejects active content, spoofed MIME, excessive dimensions, malformed and oversized bytes',()=>{
 for(const value of [{...image,mimeType:'image/svg+xml'}, {...image,mimeType:'image/jpeg'},{...image,base64:Buffer.from('<html>bad</html>').toString('base64')}, {...image,base64:image.base64+'\n'}, {...image,base64:'A'.repeat(3*1024*1024)}, {...image,url:'https://example.org/picture'}])expect(()=>validateInterviewImage(value)).toThrow();
 const huge=Buffer.from(image.base64,'base64');huge.writeUInt32BE(9000,16);expect(()=>validateInterviewImage({...image,base64:huge.toString('base64')})).toThrow();
});
test('attachment IDs cannot cross designs or exceed the per-turn budget',()=>{
 const {images}=setup(),saved=images.upload('participant','d',image);
 expect(()=>images.select('participant','d',[saved.id,saved.id])).toThrow();
 expect(()=>images.select('participant','d',['missing'])).toThrow();
 expect(()=>images.select('participant','d',['a','b','c'])).toThrow();
 expect(()=>images.select('participant','other-design',[saved.id])).toThrow();
});
