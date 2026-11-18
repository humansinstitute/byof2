import {Marked,Renderer,type Tokens} from 'marked';
import DOMPurify from 'dompurify';

const escapeHTML=(value:string)=>value.replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!));
/** Only web, mail and local links are meaningful in workshop prose. */
export function safeMarkdownHref(value:string):string|null{
 const href=value.trim();
 if(!href||/[\u0000-\u0020\u007f\\]/.test(href)||href.startsWith('//'))return null;
 const scheme=/^([a-z][a-z0-9+.-]*):/i.exec(href);
 if(scheme&&!['https','http','mailto'].includes(scheme[1]!.toLowerCase()))return null;
 // Encoded schemes are unnecessary in Markdown and may hide active URL protocols.
 if(!scheme&&/^[^/?#]*&(?:#\d+|#x[\da-f]+|[a-z]+);/i.test(href))return null;
 return href;
}
const renderer=new Renderer();
renderer.html=({text})=>escapeHTML(text);
renderer.link=function({href,title,tokens}:Tokens.Link){const label=this.parser.parseInline(tokens),safe=safeMarkdownHref(href);return safe?`<a href="${escapeHTML(safe)}"${title?` title="${escapeHTML(title)}"`:''} rel="noopener noreferrer">${label}</a>`:label;};
// Prose does not initiate remote image loads or expose the reader to tracking pixels.
renderer.image=({text})=>escapeHTML(text);
const parser=new Marked({renderer,gfm:true,breaks:true,async:false});
/** Parser output is exposed for deterministic syntax tests; views use renderMarkdown. */
export function parseMarkdown(source:string):string{return parser.parse(source||'',{async:false});}
export function renderMarkdown(source:string):string{
 return DOMPurify.sanitize(parseMarkdown(source),{
  ALLOWED_TAGS:['p','br','h1','h2','h3','h4','h5','h6','strong','em','del','blockquote','ul','ol','li','pre','code','hr','a','table','thead','tbody','tr','th','td','input'],
  ALLOWED_ATTR:['href','title','rel','start','align','type','checked','disabled'],
  ALLOW_DATA_ATTR:false,ALLOW_ARIA_ATTR:false,
 });
}
