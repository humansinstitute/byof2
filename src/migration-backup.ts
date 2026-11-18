import {Database} from 'bun:sqlite';
import {mkdirSync,chmodSync,rmSync} from 'node:fs';
import {dirname,join} from 'node:path';
import type {Store} from './store';
/** Consistent private backup before any lifecycle grouping in a deployed process. */
export function ensureDesignLifecycleBackup(store:Store,databasePath:string){
 const existing=store.get('migrationBackup','design-lifecycle-v1');if(existing)return existing;
 const directory=join(dirname(databasePath),'backups');mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
 const name='pre-design-lifecycle-'+crypto.randomUUID()+'.sqlite',path=join(directory,name);
 try{store.db.query('VACUUM INTO ?').run(path);chmodSync(path,0o600);const backup=new Database(path,{readonly:true});try{const result=backup.query('PRAGMA integrity_check').get() as any;if(result?.integrity_check!=='ok')throw Error('Migration backup integrity verification failed');const count=backup.query('SELECT count(*) AS count FROM records').get() as any;return store.put('migrationBackup',{id:'design-lifecycle-v1',file:name,recordCount:count.count,createdAt:new Date().toISOString(),integrity:'ok'});}finally{backup.close();}}catch(error){rmSync(path,{force:true});throw error;}
}
