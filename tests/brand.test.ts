import {expect,test} from 'bun:test';
import {buildBrandContext,defaultBrand,validateBrand} from '../src/brand';

test('brand context pins revision, exceptions and reusable new-build CSS independently',()=>{
 const brand={...defaultBrand(),revision:7,primary:'#123ABC',font:'serif',buttonStyle:'pill',guidance:'Keep the participant’s own words.'};
 const design={revision:2,exceptions:'This diagram uses monospace labels.'};
 const context=buildBrandContext(brand,design);
 brand.guidance='Changed later';design.exceptions='Changed later';
 expect(context.brandRevision).toBe(7);
 expect(context.designBrandRevision).toBe(2);
 expect(context.projectBrand.guidance).toBe('Keep the participant’s own words.');
 expect(context.exceptions).toBe('This diagram uses monospace labels.');
 expect(context.styleContract.css).toContain('--byo-primary: #123abc');
 expect(context.styleContract.css).toContain('Georgia, serif');
 expect(context.styleContract.css).toContain('--byo-button-radius: 999px');
 expect(context.styleContract.instructions).toContain('not automatically restyled');
});

test('style contract rejects executable CSS, invalid choices and unsafe logo URLs',()=>{
 for(const changed of [{primary:'red; background:url(https://evil)'},{font:'constructor'},{font:'system; color:red'},{buttonStyle:'__proto__'},{logoUrl:'javascript:alert(1)'},{logoUrl:'data:image/svg+xml,test'},{logoUrl:'https://user:pass@example.com/logo.svg'},{revision:-1}])expect(()=>validateBrand({...defaultBrand(),...changed})).toThrow();
 const context=buildBrandContext({...defaultBrand(),tone:'</style><script>alert(1)</script>',guidance:'body{display:none}'});
 expect(context.styleContract.css).not.toContain('script');
 expect(context.styleContract.css).not.toContain('display:none');
});

test('default contract is usable without a saved project brand and explicit exceptions are bounded',()=>{
 expect(buildBrandContext().brandRevision).toBe(0);
 expect(()=>buildBrandContext(defaultBrand(),{revision:1,exceptions:'x'.repeat(10001)})).toThrow();
 expect(()=>buildBrandContext(defaultBrand(),{revision:1.5,exceptions:''})).toThrow();
 expect(validateBrand({...defaultBrand(),logoUrl:'https://example.org/logo.svg'}).logoUrl).toBe('https://example.org/logo.svg');
});

test('new interview preparation forwards pinned brand while retaining snapshot and feedback provenance',async()=>{
 const {default:prepare}=await import('../pipelines/functions/prepare-interview.v4');
 const brand=buildBrandContext({...defaultBrand(),revision:3},{revision:1,exceptions:'Use a restrained diagram palette.'});
 const result=await prepare({job:{id:'j',kind:'interview',context:{brand,message:'Keep my confirmed exclusions.',snapshot:{id:'s',document:'No payments.'},artifactVersion:{id:'v2'},history:[{role:'user',content:'No payments.'}]}}});
 expect(result.brand).toEqual(brand);
 expect(result.snapshot.document).toBe('No payments.');
 expect(result.implementedVersion.id).toBe('v2');
 expect(result.history).toEqual([{role:'user',content:'No payments.'}]);
});
