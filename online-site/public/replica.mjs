/* Bounded initial replica + ordered deltas. Complete local history is retained
   so offline balances and customer dues never depend on the visible UI page. */
const names={company_orders:'orders',customer_payments:'payments',stock_adjustments:'adjustments',invoice_returns:'returns'};
const collections=['products','archived_products','customers','orders','sales','payments','adjustments','transactions','invoices','returns'];
const copy=value=>structuredClone(value);
function upsert(rows,id,row){const index=rows.findIndex(value=>String(value.id)===String(id));if(index>=0){if(row)rows[index]=row;else rows.splice(index,1);}else if(row)rows.push(row);}
export function applyChanges(base,changes){
 for(const event of changes){const {entity,record_id:id,data:row}=event;
  if(entity==='app_meta'){if(row?.key==='business_settings_v1')base.settings=JSON.parse(row.value);continue;}
  if(entity==='products'){upsert(base.products,id,null);upsert(base.archived_products,id,null);if(row)(row.archived?base.archived_products:base.products).push(row);continue;}
  if(entity==='invoice_items'){
   for(const invoice of base.invoices){invoice.items||=[];upsert(invoice.items,id,null);}
   if(row){const invoice=base.invoices.find(i=>i.id===row.invoice_id);if(invoice)invoice.items.push(row);}
   continue;
  }
  const name=names[entity]||entity;if(!collections.includes(name))continue;
  const value=row?copy(row):null;
  if(entity==='invoices'&&value)value.items=base.invoices.find(i=>i.id===id)?.items||[];
  upsert(base[name],id,value);
 }
 return base;
}
function sort(base){
 for(const name of ['products','archived_products','customers'])base[name].sort((a,b)=>a.name.localeCompare(b.name));
 const dates={orders:'order_date',sales:'sale_date',payments:'payment_date',adjustments:'adjust_date',transactions:'txn_date',invoices:'sale_date',returns:'return_date'};
 for(const [name,date] of Object.entries(dates))base[name].sort((a,b)=>String(b[date]).localeCompare(String(a[date]))||String(b.created_at||'').localeCompare(String(a.created_at||''))||String(b.id).localeCompare(String(a.id),undefined,{numeric:true}));
 for(const invoice of base.invoices)invoice.items.sort((a,b)=>Number(a.sale_id)-Number(b.sale_id));return base;
}
export async function pullChanges(base,request){
 let next=base,changed=false;
 for(;;){const page=await request(`/api/replica/changes?after=${next.sync_revision}&epoch=${next.workspace_epoch}`);
  if(!changed&&!page.changes.length&&!page.has_more)return {...base,server_time:page.server_time};
  if(!changed){next=copy(base);changed=true;}
  applyChanges(next,page.changes);next.sync_revision=page.next_revision;next.server_time=page.server_time;
  if(!page.has_more)return sort(next);
 }
}
export async function initialReplica(request,user,progress=()=>{}){
 const start=await request('/api/replica/start?packed=1');const base={...start,user:user||start.user,reports:{},dashboard:{}};delete base.initial_page;for(const name of collections)base[name]=[];
 const items=[];let count=0;
 function collect(entity,rows){
  if(entity==='invoice_items')items.push(...rows);
  else if(entity==='products')for(const row of rows)(row.archived?base.archived_products:base.products).push(row);
  else base[names[entity]||entity].push(...rows.map(row=>entity==='invoices'?{...row,items:[]}:row));
  count+=rows.length;progress(count);
 }
 if(start.initial_page){
  const page=start.initial_page;for(const group of page.groups)collect(group.entity,group.rows);
  if(!page.done){
   // Large histories have independent keyset cursors. Overlap a bounded four
   // collection downloads rather than waiting through every round trip.
   const remaining=start.entities.slice(page.next.index);let position=0;
   await Promise.all(Array.from({length:Math.min(4,remaining.length)},async()=>{
    while(position<remaining.length){const index=position++,entity=remaining[index];let after=index===0?page.next.after:'';
     for(;;){const rows=await request(`/api/replica/rows?entity=${entity}&after=${encodeURIComponent(after)}&epoch=${base.workspace_epoch}`);collect(entity,rows.rows);if(rows.done)break;after=rows.next_cursor;}
    }
   }));
  }
 }else for(const entity of start.entities){let after='';for(;;){const page=await request(`/api/replica/rows?entity=${entity}&after=${encodeURIComponent(after)}&epoch=${base.workspace_epoch}`);collect(entity,page.rows);if(page.done)break;after=page.next_cursor;}}
 const byInvoice=new Map(base.invoices.map(invoice=>[invoice.id,invoice]));for(const item of items)byInvoice.get(item.invoice_id)?.items.push(item);
 return pullChanges(base,request);
}
