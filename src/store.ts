import { Database } from 'bun:sqlite';
export type Row = {id:string; [key:string]:any};
export class Store {
 db:Database;
 constructor(path:string){this.db=new Database(path,{create:true});this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS replays(id TEXT PRIMARY KEY,expires INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS requests(owner TEXT NOT NULL,key TEXT NOT NULL,hash TEXT NOT NULL,response TEXT NOT NULL,PRIMARY KEY(owner,key)); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,hash TEXT NOT NULL,response TEXT NOT NULL);`);}
 get(kind:string,id:string):Row|undefined {const r=this.db.query('SELECT data FROM records WHERE kind=? AND id=?').get(kind,id) as any;return r?JSON.parse(r.data):undefined;}
 all(kind:string):Row[]{return (this.db.query('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind) as any[]).map(r=>JSON.parse(r.data));}
 put(kind:string,row:Row){this.db.query('INSERT INTO records VALUES (?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind,row.id,JSON.stringify(row));return row;}
 add(kind:string,data:Record<string,any>){return this.put(kind,{...data,id:crypto.randomUUID(),createdAt:new Date().toISOString()});}
 transaction<T>(fn:()=>T):T{return this.db.transaction(fn).immediate();}
 replay(id:string,expires:number){this.db.query('DELETE FROM replays WHERE expires < ?').run(Date.now()-60000);this.db.query('INSERT INTO replays VALUES (?,?)').run(id,expires);}
 once(id:string,hash:string,fn:()=>any){return this.transaction(()=>{const old=this.db.query('SELECT * FROM receipts WHERE id=?').get(id) as any;if(old){if(old.hash!==hash)throw new Error('Receipt conflict');return JSON.parse(old.response);}const response=fn();this.db.query('INSERT INTO receipts VALUES (?,?,?)').run(id,hash,JSON.stringify(response));return response;});}
}
