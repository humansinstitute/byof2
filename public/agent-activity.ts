type Activity={id:string;sequence:number;timestamp:string;type:string;content:string};
const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function renderAgentActivity(job:{activity?:Activity[];status:string;id:string}){
 const events=job.activity||[];
 if(!events.length)return '';
 const visible=events.filter(a=>a.type==='commentary'||a.type==='tools').slice(-4);
 const terminal=events.at(-1)?.type;const ended=['completed','failed'].includes(terminal||'');
 return `<section class="agent-activity" aria-label="Agent activity" aria-live="polite" aria-atomic="false"><div class="activity-heading">${terminal==='failed'?'Activity ended; checking the result':ended?'Waiting for the reply':'Your agent is working'}</div><ol>${visible.map(a=>`<li data-activity-id="${escape(a.id)}"><span class="activity-indicator" aria-hidden="true">${a.type==='tools'?'↗':'·'}</span><span>${escape(a.content)}</span></li>`).join('')}</ol><p class="help">Live activity · your reply and results will appear when ready.</p></section>`;
}
