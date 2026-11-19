/** Native disclosures keep ordinary Tab navigation and avoid incomplete ARIA menu roles. */
export function moreActions(content:string,label='More'){
 return `<details class="admin-more"><summary>${label}</summary><div class="more-actions">${content}</div></details>`;
}
let installed=false;
export function installMoreActions(){
 if(installed)return;installed=true;
 document.addEventListener('toggle',event=>{
  const opened=event.target;
  if(opened instanceof HTMLDetailsElement&&opened.matches('.admin-more')&&opened.open)
   document.querySelectorAll<HTMLDetailsElement>('.admin-more[open]').forEach(other=>{if(other!==opened)other.open=false;});
 },true);
 document.addEventListener('keydown',event=>{
  if(event.key!=='Escape')return;
  const active=document.activeElement?.closest<HTMLDetailsElement>('.admin-more[open]');
  if(active){event.preventDefault();active.open=false;active.querySelector('summary')?.focus();}
 });
 document.addEventListener('pointerdown',event=>{
  document.querySelectorAll<HTMLDetailsElement>('.admin-more[open]').forEach(details=>{
   if(!details.contains(event.target as Node))details.open=false;
  });
 });
 // Capture before direct/delegated button handlers so dialogs remember the visible summary.
 document.addEventListener('click',event=>{
  const button=(event.target as Element).closest('button,a');
  const details=button?.closest<HTMLDetailsElement>('.admin-more');
  if(details){details.open=false;details.querySelector('summary')?.focus();}
 },true);
}
