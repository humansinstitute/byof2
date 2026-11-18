export const name = 'byofreedom.finishInterview.v1';
export const description = 'Validate an isolated design snapshot independently from the native conversational final.';
export const version = 1;
export default async function finish(input: Record<string, any>) {
  const turn = input.turn;
  if (!turn || turn.status !== 'completed' || turn.output?.executionProfile !== 'isolated-codex') throw Error('Completed isolated native turn required');
  const files = turn.output.projectFiles;
  if (!Array.isArray(files)) throw Error('Missing isolated output files');
  const matching = files.filter((file: any) => file.path === 'design-result.json');
  if (matching.length !== 1 || typeof matching[0].base64 !== 'string') throw Error('Missing complete design result');
  const raw = Buffer.from(matching[0].base64,'base64').toString('utf8');
  if (Buffer.byteLength(raw)>200000) throw Error('Design result too large');
  const design = JSON.parse(raw);
  if (!design || Object.keys(design).sort().join(',')!=='document,response,title') throw Error('Invalid design result fields');
  for (const key of ['title','document','response']) if (typeof design[key]!=='string'||!design[key].trim()) throw Error(`Missing design ${key}`);
  if (design.title.length>160 || design.document.length>100000 || design.response.length>16000) throw Error('Design result bound exceeded');
  return {response:design.response,snapshot:{title:design.title,document:design.document},receipt:{receiptId:turn.receiptId,
    requestId:turn.requestId,conversationKey:turn.conversationKey,executionId:turn.executionId,nativeSessionId:turn.nativeSessionId,sequence:turn.sequence}};
}
