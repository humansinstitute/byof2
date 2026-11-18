import {test,expect} from 'bun:test';
import {inviteCode,inviteUrl} from '../public/invite';
test('project invite formats normalize and round-trip custom codes safely',()=>{
 for(const url of ['https://byo.example/ic=060bcfb3','https://byo.example/?ic=060bcfb3'])expect(inviteCode(new URL(url))).toBe('060BCFB3');
 const link=inviteUrl('https://byo.example','a /?&#b');expect(inviteCode(new URL(link))).toBe('A /?&#B');
 for(const path of ['/','/sites/p?ic=JOIN','/ic=','/ic=%00','/ic=%ZZ','/ic='+ 'a'.repeat(101)])expect(inviteCode(new URL(path,'https://byo.example'))).toBe(null);
});
