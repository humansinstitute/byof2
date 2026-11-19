import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { verifyEvent } from 'nostr-tools';

export interface RemotePipelineConfig {
  origin: string; clientOrigin: string; installationId: string; appId: string;
  ownerNpub: string; definitionId: string; callbackUrl: string;
  credentialFile: string; appPubkey: string;
}
export interface BrokerResult {
  response: Record<string, unknown>; httpStatus: number;
  receipt: {url: string; method: string; event: any; bodyHash: string | null};
}
export interface PipelineEnvelope {
  deliveryId: string; runId: string; status: string; terminal: boolean;
  result: unknown; error: unknown;
}
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
function tag(event: any, name: string): string {
  const values = event.tags?.filter((value: unknown) => Array.isArray(value) && value[0] === name);
  if (!Array.isArray(values) || values.length !== 1 || values[0].length !== 2 || typeof values[0][1] !== 'string') throw Error(`Invalid ${name} tag`);
  return values[0][1];
}
function signedEvent(event: any, pubkey: string, url: string | readonly string[], method: string, bodyHash: string | null, now = Date.now()) {
  if (!event || event.kind !== 27235 || event.pubkey !== pubkey || !verifyEvent(event) ||
      !Number.isSafeInteger(event.created_at) || Math.abs(now / 1000 - event.created_at) > 60 ||
      !(typeof url==='string'?[url]:url).includes(tag(event, 'u')) || tag(event, 'method') !== method ||
      (bodyHash !== null && tag(event, 'payload') !== bodyHash)) throw Error('Invalid pipeline signature');
}
export function createRemotePipelines(config: RemotePipelineConfig, transport: typeof fetch = fetch) {
  for (const origin of [config.origin, config.clientOrigin]) {
    const url = new URL(origin);
    if (url.protocol !== 'https:' || url.origin !== origin) throw Error('Managed pipeline requires exact HTTPS origins');
  }
  if (new URL(config.callbackUrl).origin !== config.clientOrigin || !/^[a-f0-9]{64}$/.test(config.appPubkey)) throw Error('Invalid callback or app identity');
  async function request(method: 'GET' | 'POST', path: string, serializedBody?: string): Promise<BrokerResult> {
    const token = (await readFile(config.credentialFile, 'utf8')).trim();
    if (!token || /[\r\n]/.test(token)) throw Error('Invalid managed pipeline credential');
    const response = await transport(`${config.origin}/api/wapps/remote-managed-pipelines`, {
      method: 'POST', headers: {'content-type':'application/json', authorization: `Bearer ${token}`},
      body: JSON.stringify({installationId:config.installationId,appId:config.appId,ownerNpub:config.ownerNpub,
        clientOrigin:config.clientOrigin,operation:'pipeline.request',request:{method,path,...(serializedBody===undefined?{}:{serializedBody})}}),
      signal: AbortSignal.timeout(30000), redirect: 'error',
    });
    const value = await response.json() as BrokerResult;
    if (!response.ok || !value.receipt || value.httpStatus !== response.status) throw Error(`Managed pipeline request failed (${response.status})`);
    const url = new URL(path, config.origin).href;
    signedEvent(value.receipt.event, config.appPubkey, url, method, serializedBody === undefined ? null : digest(serializedBody));
    if (value.receipt.url !== url || value.receipt.method !== method || value.receipt.bodyHash !== (serializedBody===undefined?null:digest(serializedBody))) throw Error('Invalid pipeline request receipt');
    return value;
  }
  const run = (id:string) => `/api/pipelines/runs/${encodeURIComponent(id)}`;
  return {
    submit: (job:Record<string, unknown>, idempotencyKey:string) => {
      if (!idempotencyKey || idempotencyKey.length > 200) throw Error('Invalid pipeline idempotency key');
      return request('POST', `/api/pipelines/definitions/${encodeURIComponent(config.definitionId)}/runs`, JSON.stringify({mode:'webhook',idempotencyKey,input:{job},webhook:{url:config.callbackUrl}}));
    },
    poll: (id:string) => request('GET',run(id)),
    delivery: (id:string) => request('GET',`${run(id)}/delivery`),
    retryDelivery: (id:string) => request('POST',`${run(id)}/delivery/retry`),
    signer: () => request('GET','/api/pipelines/webhook-signer'),
  };
}
/** Verify before DB application. Caller must atomically persist event ID AND delivery/run fingerprint. */
export async function verifyPipelineCallback(request: Request, options: {url:string;urlAliases?:readonly string[];pubkey:string;now?:number}) {
  const authorization = request.headers.get('authorization');
  if (!authorization?.startsWith('Nostr ') || authorization.length > 12000) throw Error('Missing pipeline signature');
  const body = await request.text();
  if (Buffer.byteLength(body) > 20 * 1024 * 1024) throw Error('Pipeline callback too large');
  const event = JSON.parse(Buffer.from(authorization.slice(6),'base64').toString('utf8'));
  const actual=new URL(request.url);
  const urls=[options.url,...(options.urlAliases??[])].filter(value=>{const expected=new URL(value);return expected.pathname===actual.pathname&&expected.search===actual.search;});
  signedEvent(event,options.pubkey,urls,request.method,digest(body),options.now);
  const envelope = JSON.parse(body) as PipelineEnvelope;
  if (request.method !== 'POST' || !envelope || typeof envelope.deliveryId !== 'string' || typeof envelope.runId !== 'string' ||
      typeof envelope.status !== 'string' || typeof envelope.terminal !== 'boolean' || tag(event,'delivery') !== envelope.deliveryId ||
      tag(event,'run') !== envelope.runId || request.headers.get('x-wingman-delivery-id') !== envelope.deliveryId ||
      request.headers.get('x-wingman-run-id') !== envelope.runId) throw Error('Pipeline callback correlation failed');
  return {envelope, eventId:event.id as string, fingerprint:digest(body)};
}
