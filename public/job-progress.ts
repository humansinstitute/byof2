type Job=Record<string,any>;
const normalRunning=new Set(['Agent run checked; waiting for its signed result','Agent working','Your agent is working. It’s safe to leave this page.','Your designer is working on that now','Your builder is working on that now']);
/** Only known normal running copy is mapped. Diagnostics and actionable states remain visible. */
export function jobProgress(job:Job){const progress=job.progress||job.message||'';return job.status==='running'&&(!progress||normalRunning.has(progress))?(job.kind==='implementation'?'Your builder is working on that now':'Your designer is working on that now'):progress||'Waiting for the managed agent runtime';}
