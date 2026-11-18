export const name='byofreedom.finishInterview.v2';
export const description='Validate the full design snapshot and conversational reply from tool-free inference.';
export const version=2;
export default async function finish(input:Record<string,any>){
 const design=input.design;
 if(!design||Object.keys(design).sort().join(',')!=='document,response,title')throw Error('Invalid design result fields');
 for(const key of ['title','document','response'])if(typeof design[key]!=='string'||!design[key].trim())throw Error(`Missing design ${key}`);
 if(design.title.length>160||design.document.length>100000||design.response.length>16000)throw Error('Design result bound exceeded');
 return {response:design.response,snapshot:{title:design.title,document:design.document},workflowVersion:'interview-v2',executionProfile:'tool-free-chat-json'};
}
