import {mkdirSync} from 'node:fs';
mkdirSync('dist',{recursive:true});
const result=await Bun.build({entrypoints:['public/app.ts'],outdir:'dist',target:'browser',minify:true,sourcemap:'none',naming:'app.js'});
if(!result.success){for(const log of result.logs)console.error(log);process.exit(1)}
const digest=(bytes:Uint8Array)=>new Bun.CryptoHasher('sha256').update(bytes).digest('hex').slice(0,16);
const appVersion=digest(new Uint8Array(await Bun.file('dist/app.js').arrayBuffer()));
const styleVersion=digest(new Uint8Array(await Bun.file('public/style.css').arrayBuffer()));
const index=(await Bun.file('public/index.html').text()).replace('src="/app.js"',`src="/app.js?v=${appVersion}"`).replace('href="/style.css"',`href="/style.css?v=${styleVersion}"`);
await Bun.write('dist/index.html',index);
console.log(`Built browser client: dist/app.js and versioned dist/index.html (${appVersion})`);
