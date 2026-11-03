import {InputError,applyAlertLevelUpdate} from './ledger.ts';
import {businessSettingsFromValue,ensureWorkspace} from './workspace.ts';
import {workspaceEpoch} from './workspace-access.ts';
import {supplierCatalogFromValue} from './supplier-catalog.ts';
export const replicaTables=['products','customers','company_orders','sales','customer_payments','stock_adjustments','transactions','invoices','invoice_items','invoice_returns'] as const;
export const pageBytes=128*1024;
export async function revision(db:D1Database){return Number((await db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM audit_events').first<{n:number}>())?.n||0);}
function cursor(value:string|null){const n=Number(value||0);if(!Number.isSafeInteger(n)||n<0)throw new InputError('Invalid sync cursor.');return n;}
// Byte budget is a page target, not a write limit. A record already accepted by
// the API must remain downloadable. Isolate a large record on its own page;
// never truncate a note or strand an already-committed operation with a 413.
export function bounded<T>(rows:T[]){let bytes=1024;const selected:T[]=[];for(const row of rows){const size=new TextEncoder().encode(JSON.stringify(row)).length+1;if(selected.length&&bytes+size>pageBytes)break;selected.push(row);bytes+=size;}return selected;}
const startupMarkers=['initial_records_v1','product_categories_v1','balanced_transfers_v1','supplier_product_specs_2026_v1','supplier_product_cleanup_2026_v1','alert_levels_2026_10_18_20_to_10_10_to_5_v1','business_settings_v1'];
async function startupState(db:D1Database){
 const keys=[...startupMarkers,'workspace_epoch_v1'];
 const result=await db.batch<Record<string,string|number|null>>([
  db.prepare(`SELECT key,value FROM app_meta WHERE key IN (${keys.map(()=>'?').join(',')})`).bind(...keys),
  db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM audit_events'),
  db.prepare('SELECT EXISTS(SELECT 1 FROM sales s WHERE NOT EXISTS(SELECT 1 FROM invoice_items i WHERE i.sale_id=s.id)) AS missing'),
 ]);
 const values=new Map(result[0].results.map(row=>[String(row.key),String(row.value)]));
 return {values,head:Number(result[1].results[0]?.n||0),ready:startupMarkers.every(key=>values.has(key))&&!Number(result[2].results[0]?.missing)};
}
export async function replicaStart(db:D1Database,packed=false){
 let state=await startupState(db);
 if(!state.ready){await ensureWorkspace(db);await applyAlertLevelUpdate(db);state=await startupState(db);}
 // Capture revision and metadata together before paged reads. Completed imports
 // need one read batch, without repeating setup writes at every fresh login.
 const epoch=Number(state.values.get('workspace_epoch_v1')||0);
 const metadata={protocol:2,sync_revision:state.head,workspace_epoch:epoch,settings:businessSettingsFromValue(state.values.get('business_settings_v1')),supplier_catalog:supplierCatalogFromValue(state.values.get('supplier_product_specs_2026_v1')),entities:replicaTables,server_time:new Date().toISOString()};
 return packed?{...metadata,initial_page:await replicaBundle(db,new URL('https://replica.invalid/?epoch='+epoch))}:metadata;
}
export async function replicaPage(db:D1Database,url:URL){
 const entity=url.searchParams.get('entity')||'';
 if(!(replicaTables as readonly string[]).includes(entity))throw new InputError('Invalid sync entity.');
 const epoch=cursor(url.searchParams.get('epoch'));
 if(epoch!==await workspaceEpoch(db))throw new InputError('Workspace changed during sync. Refresh and retry.',409);
 const textId=['invoices','invoice_items','invoice_returns'].includes(entity),after=url.searchParams.get('after');
 const value=textId?(after||''):cursor(after);
 const rows=(await db.prepare(`SELECT * FROM ${entity} WHERE id>? ORDER BY id LIMIT 201`).bind(value).all()).results;
 const selected=bounded(rows.slice(0,200));return {entity,rows:selected,next_cursor:selected.at(-1)?.id??value,done:selected.length===rows.length};
}
export async function replicaChanges(db:D1Database,url:URL){
 const after=cursor(url.searchParams.get('after')),epoch=cursor(url.searchParams.get('epoch'));
 const result=await db.batch<Record<string,string|number|null>>([db.prepare("SELECT value FROM app_meta WHERE key='workspace_epoch_v1'"),db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM audit_events'),db.prepare('SELECT seq,entity,record_id,after_json FROM audit_events WHERE seq>? ORDER BY seq LIMIT 201').bind(after)]);
 const current=Number(result[0].results[0]?.value||0),head=Number(result[1].results[0]?.n||0);
 if(epoch!==current)throw new InputError('Workspace changed during sync. Refresh and retry.',409);
 if(after>head)throw new InputError('Sync cursor is ahead of this database.',409);
 const events=result[2].results.map(row=>({seq:Number(row.seq),entity:String(row.entity),record_id:String(row.record_id),data:row.after_json?JSON.parse(String(row.after_json)):null}));
 const changes=bounded(events.slice(0,200)),next=changes.at(-1)?.seq??after;
 return {changes,next_revision:next,head,has_more:next<head,workspace_epoch:current,server_time:new Date().toISOString()};
}

// Pack multiple small collections into one bounded response instead of one
// authenticated network round trip per table. Cursors remain keyset based.
export async function replicaBundle(db:D1Database,url:URL){
 const epoch=cursor(url.searchParams.get('epoch')),index=cursor(url.searchParams.get('index'));
 if(index>=replicaTables.length)throw new InputError('Invalid sync collection cursor.');
 const tables=replicaTables.slice(index),after=url.searchParams.get('after');
 const value=(table:string)=>['invoices','invoice_items','invoice_returns'].includes(table)?(after||''):cursor(after);
 const result=await db.batch<Record<string,string|number|null>>([
  db.prepare("SELECT value FROM app_meta WHERE key='workspace_epoch_v1'"),
  ...tables.map((table,i)=>db.prepare(`SELECT * FROM ${table} WHERE id>? ORDER BY id LIMIT 201`).bind(i===0?value(table):['invoices','invoice_items','invoice_returns'].includes(table)?'':0)),
 ]);
 if(epoch!==Number(result[0].results[0]?.value||0))throw new InputError('Workspace changed during sync. Refresh and retry.',409);
 const groups:{entity:string;rows:Record<string,string|number|null>[]}[]=[];let bytes=1024,count=0;
 for(let i=0;i<tables.length;i++){
  const rows=result[i+1].results,selected:Record<string,string|number|null>[]=[];let last:string|number|null=i===0?value(tables[i]):['invoices','invoice_items','invoice_returns'].includes(tables[i])?'':0;
  for(const row of rows){
   const size=new TextEncoder().encode(JSON.stringify(row)).length+1;
   if(count===200||(count>0&&bytes+size>pageBytes-8192)){if(selected.length)groups.push({entity:tables[i],rows:selected});return {groups,next:{index:index+i,after:last},done:false};}
   selected.push(row);last=row.id;bytes+=size;count++;
  }
  groups.push({entity:tables[i],rows:selected});
 }
 return {groups,next:null,done:true};
}
