export const name='byofreedom.finishInterview.v4';
export const description='Validate real scoped native completion, a full design and source citations without inventing evidence.';
export const version=4;
export default async function finish(input:Record<string,any>){
 const turn=input.turn;
 if(turn?.status!=='completed'||turn.output?.executionProfile!=='scoped-interview'||typeof turn.sessionId!=='string'||typeof turn.nativeSessionId!=='string'||typeof turn.receiptId!=='string')throw Error('Completed scoped native interview required');
 if(typeof turn.reply!=='string'||Buffer.byteLength(turn.reply)>180000)throw Error('Invalid native design reply');
 const fence=/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(turn.reply);
 const design=JSON.parse(fence?fence[1]!:turn.reply);
 if(!design||Object.keys(design).sort().join(',')!=='document,response,title')throw Error('Invalid design result fields');
 for(const key of ['title','document','response'])if(typeof design[key]!=='string'||!design[key].trim())throw Error(`Missing design ${key}`);
 if(design.title.length>160||design.document.length>100000||design.response.length>16000)throw Error('Design result bound exceeded');
 for(const section of ['Confirmed facts','Source observations','Assumptions','Open questions'])if(!new RegExp(`^#{1,3} ${section}\\s*$`,'im').test(design.document))throw Error(`Missing design section: ${section}`);
 const receipts=turn.output.sourceReceipts;
 if(!Array.isArray(receipts)||receipts.length>2)throw Error('Missing or excessive source receipts');
 const attachments=input.expectedAttachments??[];
 if(!Array.isArray(attachments)||attachments.length>2)throw Error('Invalid expected image references');
 for(const attachment of attachments){
  const observed=receipts.find((r:any)=>r.id===attachment.id&&r.provenance==='approved-attachment');
  if(!observed)throw Error('Attached image was not inspected or reported unavailable');
  if(observed.available!==false&&observed.sha256!==attachment.sha256)throw Error('Inspected image does not match the pinned attachment');
 }
 const successful=receipts.filter((r:any)=>r.available!==false&&typeof r.sha256==='string');
 const publicSources=successful.filter((r:any)=>r.provenance==='public-source'&&typeof r.url==='string');
 const prior=input.priorSourceReceipts??[];
 if(!Array.isArray(prior)||prior.length>20)throw Error('Invalid prior source evidence');
 const priorPublic=prior.filter((r:any)=>r.available!==false&&r.provenance==='public-source'&&typeof r.url==='string'&&typeof r.sha256==='string'&&typeof r.sourceJobId==='string');
 const allowed=new Set([...publicSources,...priorPublic].map((r:any)=>r.url));
 const section=design.document.match(/^#{1,3} Source observations\s*\n([\s\S]*?)(?=^#{1,3} |$(?![\s\S]))/im)?.[1]??'';
 const citations=[...section.matchAll(/\]\((https:\/\/[^\s)]+)\)/g)].map(m=>m[1]!);
 if(citations.some(url=>!allowed.has(url)))throw Error('Source observation cites an unfetched page');
 if(publicSources.length&&!citations.length)throw Error('Fetched source observations require a citation');
 // Keep the host receipt allowlist; no raw source body, native events, ticket or private image bytes leave in result metadata.
 const safeReceipts=receipts.map((r:any)=>Object.fromEntries(['id','provenance','available','error','requestedUrl','url','redirects','mimeType','byteLength','sha256','width','height','fetchedAt','status','truncated'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
 return {response:design.response,snapshot:{title:design.title,document:design.document},workflowVersion:'interview-v5',executionProfile:'scoped-interview',research:{receipts:safeReceipts},
  receipt:{receiptId:turn.receiptId,requestId:turn.requestId,conversationKey:turn.conversationKey,sessionId:turn.sessionId,nativeSessionId:turn.nativeSessionId,sequence:turn.sequence}};
}
