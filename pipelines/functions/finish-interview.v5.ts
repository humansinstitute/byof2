export const name='byofreedom.finishInterview.v5';
export const description='Deliver a completed scoped reply independently from bounded design acceptance and retain host source attribution.';
export const version=5;
export default async function finish(input:Record<string,any>){
 const turn=input.turn;
 if(turn?.status!=='completed'||turn.error!=null||turn.output?.executionProfile!=='scoped-interview'||typeof turn.sessionId!=='string'||typeof turn.nativeSessionId!=='string'||typeof turn.receiptId!=='string')throw Error('Completed scoped native interview required');
 if(typeof turn.reply!=='string'||Buffer.byteLength(turn.reply)>180000)throw Error('Invalid native design reply');
 if(!turn.reply.trim())throw Error('Empty native interview reply');
 // Parse only a complete JSON value (or the historical whole-response JSON fence).
 // Never search arbitrary prose for JSON or request a formatting repair turn.
 const fence=/^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/.exec(turn.reply);
 let design:any;
 try{design=JSON.parse(fence?fence[1]!:turn.reply);}catch{}
 const structured=design!==null&&typeof design==='object'&&!Array.isArray(design);
 const hasResponse=structured&&typeof design.response==='string'&&!!design.response.trim();
 if(design!==undefined&&(!structured||Object.keys(design).length===0))throw Error('Invalid or empty structured native output');
 const response=hasResponse?design.response:turn.reply;
 if(Buffer.byteLength(response)>180000)throw Error('Conversational reply bound exceeded');
 const validDesign=structured&&typeof design.title==='string'&&!!design.title.trim()&&design.title.length<=160&&typeof design.document==='string'&&!!design.document.trim()&&design.document.length<=100000;
 const designSave=validDesign?{status:'ready'}:{status:'not-saved',reason:'The reply is complete, but a complete design within the size limits was not returned. Your previous design is unchanged.'};
 const receipts=turn.output.sourceReceipts;
 if(!Array.isArray(receipts)||receipts.length>2)throw Error('Missing or excessive source receipts');
 const attachments=input.expectedAttachments??[];
 if(!Array.isArray(attachments)||attachments.length>2)throw Error('Invalid expected image references');
 for(const attachment of attachments){
  const observed=receipts.find((r:any)=>r.id===attachment.id&&r.provenance==='approved-attachment');
  if(!observed)throw Error('Attached image was not inspected or reported unavailable');
  if(observed.available!==false&&observed.sha256!==attachment.sha256)throw Error('Inspected image does not match the pinned attachment');
 }
 const prior=input.priorSourceReceipts??[];
 if(!Array.isArray(prior)||prior.length>20)throw Error('Invalid prior source evidence');
 // Keep the host receipt allowlist; no raw source body, native events, ticket or private image bytes leave in result metadata.
 const safeReceipts=receipts.map((r:any)=>Object.fromEntries(['id','provenance','available','error','requestedUrl','url','redirects','mimeType','byteLength','sha256','width','height','fetchedAt','status','truncated'].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])));
 return {response,responseFormat:hasResponse?'markdown':'text',...(validDesign?{snapshot:{title:design.title,document:design.document}}:{}),designSave,workflowVersion:'interview-v8',executionProfile:'scoped-interview',research:{receipts:safeReceipts,attribution:'Host-verified observations; document links and prose do not confer verification.'},
  receipt:{receiptId:turn.receiptId,requestId:turn.requestId,conversationKey:turn.conversationKey,sessionId:turn.sessionId,nativeSessionId:turn.nativeSessionId,sequence:turn.sequence}};
}
