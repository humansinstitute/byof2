export const name='byofreedom.finishBuilder.v2';
export const description='Return the native conversational final independently of explicit publication.';
export const version=2;
export default async function finish(input:Record<string,any>){
 const turn=input.turn;if(turn?.status!=='completed'||typeof turn.reply!=='string'||!turn.reply.trim())throw Error('Completed native implementation turn required');
 return {response:turn.reply,receipt:{receiptId:turn.receiptId,requestId:turn.requestId,conversationKey:turn.conversationKey,runId:turn.runId,sessionId:turn.sessionId,nativeSessionId:turn.nativeSessionId,sequence:turn.sequence},workflowVersion:'builder-v2',executionProfile:'operator-controlled-host-native'};
}
