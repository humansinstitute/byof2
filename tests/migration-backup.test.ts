import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Store} from '../src/store';
import {ensureDesignLifecycleBackup} from '../src/migration-backup';
test('startup backup captures consistent WAL data, restores exact old records and is idempotent',()=>{const dir=mkdtempSync(join(tmpdir(),'byo-backup-')),path=join(dir,'app.sqlite');const store=new Store(path);try{store.put('snapshot',{id:'original',document:'Exact immutable original'});store.put('project',{id:'existing',title:'Preserved'});const b=ensureDesignLifecycleBackup(store,path);store.put('snapshot',{id:'later',document:'New edit'});const restored=new Store(join(dir,'backups',b.file));try{expect(restored.get('snapshot','original')?.document).toBe('Exact immutable original');expect(restored.get('project','existing')?.title).toBe('Preserved');expect(restored.get('snapshot','later')).toBeUndefined();expect(b.recordCount).toBe(2);expect(statSync(join(dir,'backups',b.file)).mode&0o077).toBe(0);expect(ensureDesignLifecycleBackup(store,path).file).toBe(b.file);}finally{restored.db.close();}}finally{store.db.close();rmSync(dir,{recursive:true,force:true});}});
