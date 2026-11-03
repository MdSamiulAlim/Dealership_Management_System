import {getTableColumns} from 'drizzle-orm';
import * as schema from '../db/schema.ts';
import {replicaTables} from './replica.ts';
import {InputError} from './ledger.ts';
import type {AppUser} from './app-access.ts';
const backupTables=[...replicaTables,'sync_operations'] as const;
const definitions={sync_operations:schema.syncOperations,products:schema.products,customers:schema.customers,company_orders:schema.orders,sales:schema.sales,customer_payments:schema.payments,stock_adjustments:schema.adjustments,transactions:schema.transactions,invoices:schema.invoices,invoice_items:schema.invoiceItems,invoice_returns:schema.invoiceReturns};
type Row=Record<string,string|number|null>;
export type CloudBackup={format:'arafat-cloud-backup-v1';created_at:string;actor:string;tables:Record<string,Row[]>;meta:Row[];audit:Row[]};
// Initialization markers must survive recovery: otherwise opening a restored
// app could seed customers or reapply the historical alert-level conversion.
const durableMetaKeys=['business_settings_v1','workspace_epoch_v1','initial_records_v1','balanced_transfers_v1','product_categories_v1','alert_levels_2026_10_18_20_to_10_10_to_5_v1','alert_level_update_v1'];
const metaFilter=`key IN (${durableMetaKeys.map(key=>`'${key}'`).join(',')}) OR key LIKE 'supplier_%' OR key LIKE '%catalog%' OR key LIKE '%seed%' OR key LIKE '%import%'`;
export async function captureBackup(db:D1Database,actor:string):Promise<CloudBackup>{
 const result=await db.batch([...backupTables.map(table=>db.prepare(`SELECT * FROM ${table} ORDER BY id`)),db.prepare(`SELECT * FROM app_meta WHERE ${metaFilter} ORDER BY key`),db.prepare('SELECT * FROM audit_events ORDER BY seq')]);
 return {format:'arafat-cloud-backup-v1',created_at:new Date().toISOString(),actor,tables:Object.fromEntries(backupTables.map((table,i)=>[table,result[i].results as Row[]])),meta:result[backupTables.length].results as Row[],audit:result[backupTables.length+1].results as Row[]};
}
export async function sha256(text:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');}
export function backupSummary(backup:CloudBackup){return {counts:Object.fromEntries(backupTables.map(table=>[table,backup.tables[table].length])),audit_events:backup.audit.length};}
export async function verifyBackup(text:string,expected:string){
 if(await sha256(text)!==expected)throw new InputError('Backup checksum mismatch.',409);
 let backup:CloudBackup;try{backup=JSON.parse(text);}catch{throw new InputError('Invalid backup JSON.');}
 if(backup.format!=='arafat-cloud-backup-v1'||!backup.tables||!Array.isArray(backup.meta)||!Array.isArray(backup.audit)||backupTables.some(table=>!Array.isArray(backup.tables[table])))throw new InputError('Unsupported backup format.');
 return backup;
}
export async function createCloudBackup(db:D1Database,bucket:R2Bucket|undefined,user:AppUser){
 if(!bucket)throw new InputError('Cloud backup storage is unavailable.',503);
 const backup=await captureBackup(db,user.username),text=JSON.stringify(backup),bytes=new TextEncoder().encode(text).length;
 if(bytes>32*1024*1024)throw new InputError('Backup exceeds the current 32 MB limit. Contact the administrator.',413);
 const id=crypto.randomUUID(),objectKey=`workspace/v1/${id}.json`,hash=await sha256(text),summary=backupSummary(backup);
 await bucket.put(objectKey,text,{httpMetadata:{contentType:'application/json'},customMetadata:{sha256:hash}});
 const stored=await bucket.get(objectKey);
 if(!stored||await sha256(await stored.text())!==hash)throw new InputError('Cloud backup verification failed.',503);
 await db.prepare('INSERT INTO backup_catalog(id,object_key,sha256,bytes,actor,summary_json) VALUES (?,?,?,?,?,?)').bind(id,objectKey,hash,bytes,user.username,JSON.stringify(summary)).run();
 return {id,sha256:hash,bytes,summary};
}
export async function downloadCloudBackup(db:D1Database,bucket:R2Bucket|undefined,id:string){
 const row=await db.prepare('SELECT * FROM backup_catalog WHERE id=?').bind(id).first<{object_key:string;sha256:string}>();
 if(!row)throw new InputError('Backup not found.',404);
 const object=await bucket?.get(row.object_key);if(!object)throw new InputError('Cloud backup object is unavailable.',503);
 const text=await object.text();await verifyBackup(text,row.sha256);return {text,sha256:row.sha256};
}
// Deliberately restricted to an EMPTY isolated database. The drill never resets
// the live workspace and cannot overwrite a populated database accidentally.
export function backupStockAnomalies(backup:CloudBackup){
 const stock=new Map(backup.tables.products.map(row=>[Number(row.id),Number(row.opening_stock)]));
 for(const row of backup.tables.company_orders)if(row.status==='Delivered')stock.set(Number(row.product_id),(stock.get(Number(row.product_id))||0)+Number(row.quantity));
 for(const row of backup.tables.stock_adjustments)stock.set(Number(row.product_id),(stock.get(Number(row.product_id))||0)+(['Return','Manual Add'].includes(String(row.type))?1:-1)*Number(row.quantity));
 for(const row of backup.tables.sales)stock.set(Number(row.product_id),(stock.get(Number(row.product_id))||0)-Number(row.quantity));
 return [...stock].filter(([,available])=>available<0).map(([product_id,available])=>({product_id,available}));
}
export async function restoreIntoEmptyDatabase(db:D1Database,backup:CloudBackup,options:{preserveLegacyStock?:boolean}={}){
 const counts=await db.batch<{n:number}>(backupTables.map(table=>db.prepare(`SELECT COUNT(*) AS n FROM ${table}`)));
 if(counts.some(result=>Number(result.results[0]?.n)>0))throw new InputError('Restore drill requires an empty isolated database.',409);
 const anomalies=backupStockAnomalies(backup);
 if(anomalies.length&&!options.preserveLegacyStock)throw new InputError('Backup contains historical negative stock. Isolated recovery must explicitly preserve and report it.',409);
 // Historical imports may predate stock validation. Only this explicit empty-
 // database drill can suspend INSERT guards; exact schema definitions are
 // restored in the SAME transaction. Live write routes never call this helper.
 const stockGuards=anomalies.length?(await db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='trigger' AND name IN ('guard_sale_stock_insert','guard_adjustment_stock_insert')").all<{name:string;sql:string}>()).results:[];
 if(anomalies.length&&stockGuards.length!==2)throw new InputError('Required stock safeguards are missing.',409);
 const statements:D1PreparedStatement[]=[];
 for(const table of backupTables)statements.push(db.prepare(`INSERT INTO app_meta(key,value) SELECT 'restore_empty_guard',NULL WHERE EXISTS(SELECT 1 FROM ${table})`));
 statements.push(db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES ('write_context',?)").bind(JSON.stringify({username:'restore-drill',role:'system',operation_id:crypto.randomUUID()})));
 for(const guard of stockGuards)statements.push(db.prepare(`DROP TRIGGER ${guard.name}`));
 // Preserve historical actors before triggers append the isolated restore events.
 const insertRows=(table:string,columns:string[],rows:Row[])=>{
  for(let i=0;i<rows.length;i+=50)statements.push(db.prepare(`INSERT INTO ${table} (${columns.join(',')}) SELECT ${columns.map(column=>`json_extract(value,'$.${column}')`).join(',')} FROM json_each(?)`).bind(JSON.stringify(rows.slice(i,i+50))));
 };
 insertRows('audit_events',Object.values(getTableColumns(schema.auditEvents)).map(column=>column.name),backup.audit);
 // Restore stock credits before debits. Sales may depend on Manual Add or
 // Return entries rather than opening stock / delivered company orders.
 const adjustmentColumns=Object.values(getTableColumns(schema.adjustments)).map(column=>column.name);
 for(const table of backupTables){
  if(table==='sales')insertRows('stock_adjustments',adjustmentColumns,backup.tables.stock_adjustments.filter(row=>['Return','Manual Add'].includes(String(row.type))));
  const rows=table==='stock_adjustments'?backup.tables[table].filter(row=>!['Return','Manual Add'].includes(String(row.type))):backup.tables[table];
  insertRows(table,Object.values(getTableColumns(definitions[table])).map(column=>column.name),rows);
 }
 for(const guard of stockGuards)statements.push(db.prepare(guard.sql));
 const allowedMeta=backup.meta.filter(row=>typeof row.key==='string'&&(durableMetaKeys.includes(row.key)||/^(.*(?:catalog|seed|import).*|supplier_.*)$/.test(row.key)));
 insertRows('app_meta',['key','value'],allowedMeta);
 statements.push(db.prepare("DELETE FROM app_meta WHERE key='write_context'"));
 for(const table of backupTables)statements.push(db.prepare(`INSERT INTO app_meta(key,value) SELECT 'restore_count_guard',NULL WHERE (SELECT COUNT(*) FROM ${table})<>?`).bind(backup.tables[table].length));
 await db.batch(statements);
 return {historical_negative_stock:anomalies};
}
