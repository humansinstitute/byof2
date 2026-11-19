import {expect,test} from 'bun:test';
import {generateSecretKey,getPublicKey} from 'nostr-tools';
import {legacySecret} from '../public/identity-vault';
test('migration validates exact secp256k1 secret, rejecting malformed and out-of-range legacy evidence',()=>{
 const original=generateSecretKey();const restored=legacySecret(Buffer.from(original).toString('hex').toUpperCase());
 expect(getPublicKey(restored)).toBe(getPublicKey(original));restored.fill(0);
 for(const invalid of ['', 'not-a-key','ab'.repeat(31),'ab'.repeat(33),'0'.repeat(64),'f'.repeat(64),' '.repeat(64)])expect(()=>legacySecret(invalid)).toThrow('No replacement was created');
});
