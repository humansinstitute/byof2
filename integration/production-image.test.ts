import {expect,test} from 'bun:test';

const enabled=process.env.BYO_DOCKER_VALIDATION_TEST==='1';
(enabled?test:test.skip)('production image starts the actual app with all runtime imports',()=>{
 const tag=`byof-runtime-check:${crypto.randomUUID()}`;
 const run=(args:string[])=>{
  const result=Bun.spawnSync(['docker',...args],{cwd:process.cwd(),stdout:'pipe',stderr:'pipe'});
  if(result.exitCode!==0)throw Error(Buffer.from(result.stderr).toString().slice(-8000));
  return Buffer.from(result.stdout).toString();
 };
 try{
  run(['build','-t',tag,'.']);
  const output=run(['run','--rm','-e','PUBLIC_ORIGIN=https://app.example','-e','DATABASE_PATH=/tmp/acceptance.sqlite',tag,'bun','-e',`const {workshopCatalog}=await import('./src/workshop-catalog.ts');if(workshopCatalog().length!==3||workshopCatalog().some(e=>!e.files['index.html'].includes('<h1>')))throw Error('Missing example assets');await import('./src/server.ts');const r=await fetch('http://127.0.0.1:3000/health');if(!r.ok||!(await r.json()).ok)process.exit(1);console.log('production-health-ok');process.exit(0);`]);
  expect(output).toContain('production-health-ok');
 }finally{Bun.spawnSync(['docker','image','rm',tag],{stdout:'ignore',stderr:'ignore'});}
},120000);
