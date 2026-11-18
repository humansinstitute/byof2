import {publicNStackFetch} from './nstack-http';
import {lookup} from 'node:dns/promises';
import {HttpError,need} from './auth';
import {boundedNStackText,isPrivateHost} from './nstack';
import {parseDescriptor,parseWorkspace,towerOrigin,type Descriptor,type Workspace} from '../public/nstack-discovery';

/** Server-side discovery only reads a public HTTPS origin. Private endpoints and redirects are refused. */
export async function discoverOrigin(input:string,fetcher:typeof fetch=publicNStackFetch,resolve:typeof lookup=lookup):Promise<Descriptor>{
 let origin:string;try{origin=towerOrigin(input);}catch(error){throw new HttpError(400,(error as Error).message);}
 need(!isPrivateHost(new URL(origin).hostname),400,'Private network endpoints are not supported');
 const addresses=await resolve(new URL(origin).hostname,{all:true});
 need(addresses.length&&addresses.every(a=>!isPrivateHost(a.address)),400,'Endpoint resolves to a private network');
 const response=await fetcher(origin+'/.well-known/nstack.json',{redirect:'error',signal:AbortSignal.timeout(8000),headers:{accept:'application/json'}});
 need(response.ok,502,'NStack descriptor unavailable');
 try{return parseDescriptor(JSON.parse(await boundedNStackText(response,262144)),origin);}catch(error){if(error instanceof HttpError)throw error;throw new HttpError(422,(error as Error).message);}
}
export type DiscoveryRead=(path:string)=>Promise<any>;
/** The caller supplies a bounded browser-authorized GET broker, never a service principal. */
export async function listDiscoveredWorkspaces(descriptor:Descriptor,read:DiscoveryRead):Promise<{descriptor:Descriptor;workspaces:Workspace[]}>{
 const workspaces:Workspace[]=[],seen=new Set<string>();let cursor:string|undefined;
 for(let page=0;page<500;page++){
  const query=new URLSearchParams({limit:'200'});if(cursor)query.set('cursor',cursor);
  const result=await read('/api/v4/flightdeck-pg/workspaces?'+query);
  need(result.partial!==true&&result.complete!==false&&Array.isArray(result.workspaces),502,'Incomplete workspace list; retry discovery');
  for(const raw of result.workspaces){let workspace:Workspace;try{workspace=parseWorkspace(raw);}catch{throw new HttpError(502,'Malformed workspace identity');}
   need(workspace.towerNpub===descriptor.towerNpub&&!workspaces.some(w=>w.id===workspace.id),502,'Mismatched or duplicate workspace identity');workspaces.push(workspace);
  }
  const next=result.next_cursor;
  if(!next){need(result.has_more!==true,502,'Incomplete workspace list');return {descriptor,workspaces};}
  need(typeof next==='string'&&next.length<=4096&&!seen.has(next)&&result.workspaces.length,502,'Invalid workspace pagination');seen.add(next);cursor=next;
 }
 throw new HttpError(502,'Workspace list exceeded safe limits');
}
