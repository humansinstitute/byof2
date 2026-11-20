import {mkdirSync,writeFileSync,chmodSync} from 'node:fs';
import {dirname,join} from 'node:path';
/** Opaque installation execution grants only. Never provider or Nostr keys. */
export function materializePipelineCredentials(databasePath:string,env=process.env){
 const directory=join(dirname(databasePath),'execution-grants');
 for(const kind of ['INTERVIEW','BUILDER','PARTICIPANT_BUILDER']){
  const token=env[`${kind}_PIPELINE_CREDENTIAL`];if(!token)continue;
  if(!env[`${kind}_PIPELINE_CONFIG`])throw Error(`Missing ${kind} pipeline public configuration`);
  if(token.length>12000||/[\r\n]/.test(token))throw Error('Invalid opaque installation grant');
  const cfg=JSON.parse(env[`${kind}_PIPELINE_CONFIG`]!);mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
  const file=join(directory,kind.toLowerCase()+'.capability');writeFileSync(file,token,{mode:0o600});chmodSync(file,0o600);
  cfg.credentialFile=file;env[`${kind}_PIPELINE_CONFIG`]=JSON.stringify(cfg);delete env[`${kind}_PIPELINE_CREDENTIAL`];
 }
}

/** Durable BYO gateway capability, separate from pipeline grants and signer keys. */
export function materializeGatewayCredential(databasePath:string,env=process.env){
 const token=env.BYO_NSTACK_GATEWAY_CREDENTIAL;if(!token)return;
 if(!env.BYO_NSTACK_GATEWAY_URL||!/^[A-Za-z0-9_-]{43,128}$/.test(token))throw Error('Invalid opaque storage gateway capability');
 const directory=join(dirname(databasePath),'storage-grants');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const file=join(directory,'gateway.capability');writeFileSync(file,token,{mode:0o600});chmodSync(file,0o600);env.BYO_NSTACK_GATEWAY_TOKEN_FILE=file;delete env.BYO_NSTACK_GATEWAY_CREDENTIAL;
}
