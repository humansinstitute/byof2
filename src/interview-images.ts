import {createHash} from 'node:crypto';
import {Store,type Row} from './store';
import {ADMINS,need} from './auth';

export const IMAGE_LIMITS={bytes:2*1024*1024,pixels:16000000,dimension:8192,perTurn:2,perDesignBytes:32*1024*1024};
export type InterviewImage={id:string;name:string;mimeType:string;base64:string;sha256:string};
function dimensions(bytes:Buffer,mimeType:string):{width:number;height:number}{
 if(mimeType==='image/png'){
  need(bytes.length>=33&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.toString('ascii',12,16)==='IHDR'&&bytes.readUInt32BE(8)===13,400,'Invalid PNG image');
  return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
 }
 need(bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes.at(-2)===255&&bytes.at(-1)===217,400,'Invalid JPEG image');
 let position=2;
 while(position<bytes.length-4){
  need(bytes[position++]===255,400,'Invalid JPEG structure');while(bytes[position]===255)position++;
  const marker=bytes[position++]!;
  if(marker===217||marker===218)break;
  if(marker===1||marker>=208&&marker<=215)continue;
  need(position+2<=bytes.length,400,'Invalid JPEG structure');
  const length=bytes.readUInt16BE(position);need(length>=2&&position+length<=bytes.length,400,'Invalid JPEG structure');
  if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
   need(length>=8,400,'Invalid JPEG dimensions');return {height:bytes.readUInt16BE(position+3),width:bytes.readUInt16BE(position+5)};
  }
  position+=length;
 }
 throw new Error('JPEG image dimensions unavailable');
}
export function validateInterviewImage(input:unknown){
 const value=input as Record<string,unknown>;
 need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='base64,mimeType,name',400,'Image requires name, mimeType and base64 only');
 need(typeof value.name==='string'&&value.name.trim().length>0&&value.name.length<=120&&!/[\x00-\x1f\x7f]/.test(value.name),400,'Invalid image name');
 need(value.mimeType==='image/png'||value.mimeType==='image/jpeg',400,'Choose a PNG or JPEG image');
 need(typeof value.base64==='string'&&value.base64.length<=Math.ceil(IMAGE_LIMITS.bytes/3)*4&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value.base64),400,'Invalid or oversized image');
 const bytes=Buffer.from(value.base64 as string,'base64');need(bytes.length>0&&bytes.length<=IMAGE_LIMITS.bytes,400,'Image must be at most 2 MB');
 let size;try{size=dimensions(bytes,value.mimeType as string);}catch{need(false,400,'Invalid image structure');throw Error('unreachable');}
 need(size.width>0&&size.height>0&&size.width<=IMAGE_LIMITS.dimension&&size.height<=IMAGE_LIMITS.dimension&&size.width*size.height<=IMAGE_LIMITS.pixels,400,'Image dimensions exceed the limit');
 return {name:(value.name as string).trim(),mimeType:value.mimeType as string,base64:bytes.toString('base64'),bytes:bytes.length,...size,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function createInterviewImages(store:Store){
 const assertOwner=(actor:string,designId:string)=>{const design=store.get('design',designId);need(design&&!store.get('project',design.projectId)?.deletedAt,404,'Design not found');need(design!.owner===actor||ADMINS.includes(actor),403,'This design interview belongs to its participant');return design!.owner as string;};
 const metadata=(row:Row)=>({id:row.id,name:row.name,mimeType:row.mimeType,bytes:row.bytes,width:row.width,height:row.height,sha256:row.sha256});
 function rowFor(actor:string,designId:string,id:string){const owner=assertOwner(actor,designId);const image=store.get('interviewImage',id);need(image&&image.owner===owner&&image.designId===designId,404,'Image not found');return image!;}
 function select(owner:string,designId:string,ids:unknown){
  need(Array.isArray(ids)&&ids.length<=IMAGE_LIMITS.perTurn&&ids.every(id=>typeof id==='string')&&new Set(ids).size===ids.length,400,'Choose at most two images');
  return (ids as string[]).map(id=>rowFor(owner,designId,id));
 }
 return {
  upload(actor:string,designId:string,input:unknown){
   const owner=assertOwner(actor,designId),image=validateInterviewImage(input);
   return store.transaction(()=>{
    const images=store.all('interviewImage').filter(i=>i.designId===designId);
    const existing=images.find(i=>i.sha256===image.sha256&&i.owner===owner);if(existing)return metadata(existing);
    need(images.reduce((sum,i)=>sum+i.bytes,0)+image.bytes<=IMAGE_LIMITS.perDesignBytes,413,'This design has reached its image storage limit');
    return metadata(store.add('interviewImage',{owner,uploadedBy:actor,designId,...image}));
   });
  },
  select(owner:string,designId:string,ids:unknown){return select(owner,designId,ids).map(metadata);},
  context(owner:string,designId:string,ids:unknown):InterviewImage[]{return select(owner,designId,ids).map(row=>({id:row.id,name:row.name,mimeType:row.mimeType,base64:row.base64,sha256:row.sha256}));},
  response(owner:string,designId:string,id:string){const row=rowFor(owner,designId,id);return new Response(Buffer.from(row.base64,'base64'),{headers:{'content-type':row.mimeType,'cache-control':'private, no-store','x-content-type-options':'nosniff','content-security-policy':"default-src 'none'; sandbox",'referrer-policy':'no-referrer'}});},
 };
}
