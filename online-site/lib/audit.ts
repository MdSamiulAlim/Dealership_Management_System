import {bounded} from './replica.ts';
import type {AppUser} from './app-access.ts';
import {InputError} from './ledger.ts';

// Context and business statements share one D1 transaction. No client-supplied
// actor is trusted, and triggers see the actual committed OLD/NEW values.
export function auditedDatabase(db:D1Database,user:AppUser,operationId:string):D1Database {
 async function batch(statements:D1PreparedStatement[]) {
  const result=await db.batch([
   db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES ('write_context',?)").bind(JSON.stringify({username:user.username,role:user.role,operation_id:operationId})),
   ...statements,db.prepare("DELETE FROM app_meta WHERE key='write_context'"),
  ]);
  return result.slice(1,-1);
 }
 function statement(sql:string,args:unknown[]=[]):D1PreparedStatement {
  const raw=args.length?db.prepare(sql).bind(...args):db.prepare(sql);
  return new Proxy(raw,{get(target,name){
   if(name==='bind')return (...values:unknown[])=>statement(sql,values);
   if(name==='run')return async()=>(await batch([raw]))[0];
   const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;
  }});
 }
 return new Proxy(db,{get(target,name){if(name==='batch')return batch;if(name==='prepare')return statement;const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
}
export async function auditPage(db:D1Database,url:URL){
 const before=Number(url.searchParams.get('before')||Number.MAX_SAFE_INTEGER);
 if(!Number.isSafeInteger(before)||before<1)throw new InputError('Invalid audit cursor.');
 const actor=url.searchParams.get('actor')||'',entity=url.searchParams.get('entity')||'';
 const result=await db.prepare('SELECT * FROM audit_events WHERE seq<? AND (?=\'\' OR actor=?) AND (?=\'\' OR entity=?) ORDER BY seq DESC LIMIT 51').bind(before,actor,actor,entity,entity).all();
 const rows=bounded(result.results.slice(0,50));return {rows,next_cursor:result.results.length>rows.length?rows.at(-1)?.seq:null};
}
