import {NStackLimits} from './nstack';

/** Bounded public facts captured by the app, never connection secrets or user-supplied grants. */
export function agentStorageContext(settings:Record<string,any>){
 const configured=!!settings.connection;
 const mode=configured?(settings.connection.mode==='browser-user'?'browser-user':'managed'):'unconfigured';
 const ready=configured&&settings.state==='ready';
 const json=ready&&settings.capabilities?.json===true;
 const managed=json&&mode==='managed';
 const files=managed&&settings.capabilities?.files===true;
 return {
  contractVersion:1,backend:'nstack',records:'Postgres-backed scoped JSON collections',objects:'NStack S3-compatible object storage through the scoped file SDK',
  settingsRevision:Number.isSafeInteger(settings.revision)&&settings.revision>=0?settings.revision:0,
  manifestFile:'byo-data.json',manifestVersion:1,
  instructions:'Use the scoped SDK and exact-version admin-approved manifest. This captured capability snapshot is not a grant; fresh SDK permission/availability failures remain authoritative. No raw SQL, keys, arbitrary backend or local persistence fallback.',
  mode,state:ready?'ready':configured?'unavailable':'unconfigured',
  capabilities:{json,files,policies:json?(managed?['private','shared','public']:['private']):[],anonymousRead:managed&&settings.capabilities?.anonymousRead===true},
  access:{projectMembershipRequired:true,independentNStackWorkspaceMembershipRequired:mode==='browser-user',private:'Each signed user reads/writes only their own records.',shared:'Project members read/write the same collection; requires managed delegation.',public:'Read-only for anonymous visitors after exact version is publicly exposed; only admins write.'},
  sdk:{factory:'createFreedomData',methods:['list','get','put','remove','filePut','fileGet'],fileInput:['bytesBase64','sha256','size','contentType','name'],manifestFile:'byo-data.json',manifestVersion:1,manifestCollectionFields:['name','policy','maxRecords','maxBytes'],exactVersionAdminInstallationRequired:true},
  namespaces:{live:'Stable across compatible enabled versions of the same app.',preview:'Separate exact-version and actor test data; never live data.'},
  limits:{collections:NStackLimits.collections,recordsPerCollection:NStackLimits.records,mutationRevisions:NStackLimits.revisions,jsonBytes:NStackLimits.recordBytes,fileBytes:NStackLimits.fileBytes,pageRecords:NStackLimits.page},
  requirements:{sharedGuestbook:['shared JSON collection','managed delegation'],eventPhotos:['file storage enabled','approved file collection policy','JSON metadata for captions/messages linked to logical file records'],currentBlockers:[...(!json?['NStack records are not ready.']:[]),...(mode==='browser-user'?['Current browser-authorized connection supports private data only; shared/public apps need managed delegation.','Each user must separately belong to the selected NStack workspace; joining the BYO project is insufficient.']:[]),...(!files?['Generated-app file upload/download is unavailable; native interview image attachments do not enable app file storage.']:[])]},
 };
}
