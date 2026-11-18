import {join} from 'node:path';
import {homedir} from 'node:os';
export {};
/** Operator-native CLI. The app tool resolves only its fixed manifest under the broker-bound conversation workdir. */
const {callCapabilityBroker}=await import(String(join(process.env.AUTOPILOT_REPO||join(homedir(),'code','wm','autopilot'),'src','mcp','capability-client.ts')));
if(Bun.argv[2]!=='publication.json')throw Error('Usage: bun worker-publish.ts publication.json');
const manifest=await Bun.file('publication.json').json();
const args={publicationId:manifest.publicationId,title:manifest.title,manifest:'publication.json'};
const result=await callCapabilityBroker('/api/mcp/wingman/project-tool',{sessionId:process.env.SESSION_ID,tool:'byofreedom.publish',args});
console.log(JSON.stringify(result,null,2));
