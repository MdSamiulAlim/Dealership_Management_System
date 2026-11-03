import {allocateCents as allocate} from '../public/money-allocation.mjs';
import {journalReports} from '../public/report-journal.mjs';
import {applySupplierCatalog,supplierCatalogState,removeUnlistedProducts} from './supplier-catalog.ts';
import { workspaceEpoch, requireWorkspaceEpoch, guardWorkspaceWrites } from "./workspace-access.ts";
import { bootstrap, ensureSeeded, isTransfer, prepareTransfer, InputError, money, prepareInsert, productUpdate, customerUpdate, wholeBags, today, validDate, calculatedTotal, integrityError, nonnegative, recordId, choice, requireActiveProduct } from "./ledger.ts";
import type { Payload, SqlRow, ProductRecord, CustomerRecord, InvoiceRecord, InvoiceItemRecord, SyncOperation, BusinessSettings } from "./records.ts";
const defaults={name:"Arafat Traders",phone:"+8801646130402",address:"",large_discount_percent:20,version:1};
const settingKey="business_settings_v1";
const tables:Record<string,string>={products:"products",customers:"customers",orders:"company_orders",payments:"customer_payments",adjustments:"stock_adjustments",transactions:"transactions"};
const positiveId=recordId;
const date=validDate;
const validKey=(v:unknown)=>{if(typeof v!=="string"||!/^[A-Za-z0-9_-]{8,100}$/.test(v))throw new InputError("Invalid operation/invoice ID.");return v;};
const clean=(v:unknown)=>String(v??"").trim();
const cents=(v:unknown)=>Math.round(money(v)*100);
export function invoiceAmounts(p:Payload){
 if(!Array.isArray(p.items)||!p.items.length||p.items.length>40)throw new InputError("Add between 1 and 40 invoice items.");
 const items=p.items.map((item:Payload)=>{if(!item||typeof item!=="object"||Array.isArray(item)||item.rate==null||String(item.rate).trim()==="")throw new InputError("Enter a quantity and rate for every invoice item.");const quantity=wholeBags(item.quantity,"Quantity",1),rate=nonnegative(item.rate,"Rate");if(quantity<=0||rate<0)throw new InputError("Quantity must be positive and rate cannot be negative.");return {product_id:positiveId(item.product_id),quantity,rate,gross:cents(quantity*rate)};});
 const gross=items.reduce((sum:number,i)=>sum+i.gross,0);if(gross>100000000000000)throw new InputError("Invoice subtotal cannot exceed 1,000,000,000,000.");const value=nonnegative(p.discount_value??p.discount??0,"Discount");
 choice(p.discount_type,["amount","percent"],"amount");
 const discount=p.discount_type==="percent"?Math.round(gross*value/100):cents(value);
 if(value<0||discount<0||discount>gross)throw new InputError("Discount must be between zero and the subtotal.");
 const total=gross-discount;calculatedTotal(p,total/100);const paid=cents(nonnegative(p.paid_amount??0,"Paid amount"));if(paid<0||paid>total)throw new InputError("Paid amount cannot exceed the invoice total.");
 const net=allocate(total,items.map((i)=>i.gross)),paidParts=allocate(paid,net);
 return {subtotal:gross/100,discount:discount/100,total_amount:total/100,paid_amount:paid/100,items:items.map((i,index:number)=>({...i,line_total:net[index]/100,paid_amount:paidParts[index]/100}))};
}
export async function ensureWorkspace(db:D1Database){
 await ensureSeeded(db);
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO invoices (id,invoice_no,sale_date,customer_id,subtotal,total_amount,paid_amount,account,notes,created_at)
   SELECT 'legacy-'||s.id,'AT-'||printf('%06d',s.id),s.sale_date,s.customer_id,s.total_amount,s.total_amount,s.paid_amount,s.account,COALESCE(s.notes,''),s.created_at FROM sales s WHERE NOT EXISTS(SELECT 1 FROM invoice_items i WHERE i.sale_id=s.id)`),
  db.prepare(`INSERT OR IGNORE INTO invoice_items (id,invoice_id,sale_id,product_id,product_name,product_code,quantity,rate,line_total)
   SELECT 'legacy-line-'||s.id,'legacy-'||s.id,s.id,s.product_id,p.name,p.product_code,s.quantity,s.rate,s.total_amount FROM sales s JOIN products p ON p.id=s.product_id JOIN invoices inv ON inv.id='legacy-'||s.id WHERE NOT EXISTS(SELECT 1 FROM invoice_items i WHERE i.sale_id=s.id)`),
  db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").bind(settingKey,JSON.stringify(defaults)),
 ]);
 // Freeze legacy invoice descriptions before updating supplier item metadata.
 await applySupplierCatalog(db);
 await removeUnlistedProducts(db);
}
export function businessSettingsFromValue(value?:string):BusinessSettings{return {...defaults,...JSON.parse(value||"{}")};}
export async function businessSettings(db:D1Database):Promise<BusinessSettings>{const row=await db.prepare("SELECT value FROM app_meta WHERE key=?").bind(settingKey).first<{value:string}>();return businessSettingsFromValue(row?.value);}
export async function workspaceBootstrap(db:D1Database){
 await ensureWorkspace(db);const data=await bootstrap(db);
 const result=await db.batch([
  db.prepare("SELECT i.*,COALESCE(NULLIF(i.customer_name,''),c.name) AS customer_name,CASE WHEN i.customer_name<>'' THEN i.customer_mobile ELSE c.mobile END AS customer_mobile,CASE WHEN i.customer_name<>'' THEN i.customer_address ELSE c.address END AS customer_address FROM invoices i JOIN customers c ON c.id=i.customer_id ORDER BY i.sale_date DESC,i.created_at DESC,i.id DESC"),
  db.prepare("SELECT * FROM invoice_items ORDER BY sale_id"),db.prepare("SELECT * FROM invoice_returns ORDER BY return_date DESC,created_at DESC"),
 ]);
 const items=result[1].results as InvoiceItemRecord[];const invoices=(result[0].results as InvoiceRecord[]).map(i=>({...i,items:items.filter(item=>item.invoice_id===i.id),net_total:money(i.status==="void"?0:i.total_amount-i.returned_total),net_paid:money(i.status==="void"?0:i.paid_amount-i.refunded),due_amount:money(i.status==="void"?0:i.total_amount-i.returned_total-i.paid_amount+i.refunded)}));
 const active=data.products.filter(p=>!p.archived),archived=data.products.filter(p=>p.archived);
 const snapshot={...data,products:active,archived_products:archived,dashboard:{...data.dashboard,current_stock:money(active.reduce((n,p)=>n+p.current_stock,0)),archived_stock:money(archived.reduce((n,p)=>n+p.current_stock,0)),low_stock:active.filter(p=>p.current_stock<=p.low_stock_level)},supplier_catalog:await supplierCatalogState(db),invoices,workspace_epoch:await workspaceEpoch(db),returns:result[2].results,settings:await businessSettings(db),server_time:new Date().toISOString()};
 const journal=journalReports(snapshot,snapshot.dashboard.today);
 Object.assign(snapshot.reports,journal.reports);Object.assign(snapshot.dashboard,journal.today);
 return snapshot;
}
export async function getInvoice(db:D1Database,id:string){const invoice=await db.prepare("SELECT i.*,COALESCE(NULLIF(i.customer_name,''),c.name) AS customer_name,CASE WHEN i.customer_name<>'' THEN i.customer_mobile ELSE c.mobile END AS customer_mobile,CASE WHEN i.customer_name<>'' THEN i.customer_address ELSE c.address END AS customer_address FROM invoices i JOIN customers c ON c.id=i.customer_id WHERE i.id=?").bind(id).first<InvoiceRecord>();if(!invoice)throw new InputError("Invoice not found",404);const rows=await db.prepare("SELECT * FROM invoice_items WHERE invoice_id=? ORDER BY sale_id").bind(id).all<InvoiceItemRecord>();return {...invoice,items:rows.results,settings:await businessSettings(db)};}
function stable(value:unknown):string{return JSON.stringify(value&&typeof value==="object"?Array.isArray(value)?value.map(v=>JSON.parse(stable(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(stable((value as Payload)[k]))])):value);}
async function digest(value:unknown){const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(stable(value)));return Array.from(new Uint8Array(bytes),v=>v.toString(16).padStart(2,"0")).join("");}
async function previous(db:D1Database,key:string,hash:string){const row=await db.prepare("SELECT * FROM sync_operations WHERE id=?").bind(key).first<SyncOperation>();if(row&&row.payload_hash!==hash)throw new InputError("Operation ID was reused with different data.",409);if(row&&!row.changed)throw new InputError("Another device changed this record. Review the latest record before retrying.",409);return row;}
async function commandResult(db:D1Database,row:SyncOperation,replayed:boolean){
 const result={id:row.result_id,entity:row.entity,replayed};
 if(row.entity!=="invoices")return result;
 if(row.customer_id)return {...result,customer_id:row.customer_id};
 const invoice=await db.prepare("SELECT customer_id FROM invoices WHERE id=?").bind(row.result_id).first<SqlRow>();
 return {...result,customer_id:invoice?.customer_id};
}
export async function executeCommand(db:D1Database,command:Payload){
 await ensureWorkspace(db);const epoch=await requireWorkspaceEpoch(db,command.workspace_epoch);db=guardWorkspaceWrites(db,epoch);const key=validKey(command.id);const method=clean(command.method).toUpperCase();const path=clean(command.path);const p=structuredClone(command.payload||{}) as Payload;const hash=await digest({method,path,payload:p});
 const done=await previous(db,key,hash);if(done)return commandResult(db,done,true);
 const parts=path.split("/").filter(Boolean);if(parts.shift()!=="api")throw new InputError("Invalid command path.");
 const entity=parts[0],recordId=parts[1];const statements:D1PreparedStatement[]=[];let resultId:string|null=recordId||null;
 let marker=db.prepare("INSERT INTO sync_operations(id,payload_hash,entity,result_id,changed) SELECT ?,?,?,?,changes()").bind(key,hash,entity,resultId);
 if(method==="POST"&&parts.length===1&&tables[entity]){
  if(entity==="adjustments"&&p.confirmed!==true)throw new InputError("Confirm the stock adjustment first.");
  if (["orders","payments","adjustments","transactions"].includes(entity)) {
    const field = {orders:"order_date",payments:"payment_date",adjustments:"adjust_date",transactions:"txn_date"}[entity as "orders"|"payments"|"adjustments"|"transactions"];
    date(p[field]);
    if (["orders","adjustments"].includes(entity))p.quantity=wholeBags(p.quantity,"Quantity",1);
    if (money(["orders","adjustments"].includes(entity)?p.quantity:p.amount)<=0) throw new InputError("Enter a positive quantity or amount.");
  }
  if (["payments","transactions"].includes(entity)&&!["Cash","Bank"].includes((p.account||"Cash") as string))throw new InputError("Choose Cash or Bank.");
  if(entity==="orders"){if(money(p.rate)<0)throw new InputError("Rate cannot be negative.");calculatedTotal(p,money(money(p.quantity)*money(p.rate)));}
  if(["orders","adjustments"].includes(entity))await requireActiveProduct(db,p.product_id);
  statements.push(...(entity==="transactions"&&isTransfer(p)?prepareTransfer(db,p,key):[prepareInsert(db,entity,p)]));
  if(entity==="transactions"&&!isTransfer(p))statements.push(db.prepare("UPDATE transactions SET category=?,reference=? WHERE id=last_insert_rowid()").bind(clean(p.category)||"General",clean(p.reference)));
  marker=db.prepare("INSERT INTO sync_operations(id,payload_hash,entity,result_id,changed) SELECT ?,?,?,CAST(last_insert_rowid() AS TEXT),1").bind(key,hash,entity);
 }else if(entity==="invoices"){
  const invoiceId=method==="POST"&&parts.length===1?validKey(p.id||key):validKey(recordId);resultId=invoiceId;
  const current=recordId?await getInvoice(db,invoiceId):null;
  const guard="EXISTS(SELECT 1 FROM invoices WHERE id=? AND last_op=?)";
  if((method==="POST"&&parts.length===1)||(method==="PATCH"&&parts.length===2)){
   const amounts=invoiceAmounts(p);const settings=await businessSettings(db);
   if(amounts.subtotal>0&&amounts.discount/amounts.subtotal*100>settings.large_discount_percent&&p.confirm_discount!==true)throw new InputError("Confirm the large discount first.");
   const saleDate=date(p.sale_date),newCustomer=p.customer_id==="new",customer=newCustomer?null:positiveId(p.customer_id),account=p.account||"Cash";if(!["Cash","Bank"].includes(account as string))throw new InputError("Choose Cash or Bank.");
   if(current&&(current.items.some((item)=>item.returned_quantity>0)||current.status!=="active"))throw new InputError("Returned or cancelled invoices cannot be edited.",409);
   const invoiceNumber=clean(p.invoice_no)||current?.invoice_no||`AT-${saleDate.replaceAll("-","")}-${invoiceId.replaceAll("-","").slice(-12).toUpperCase()}`;
   if(invoiceNumber.length>100||/[\u0000-\u001f\u007f]/.test(invoiceNumber))throw new InputError("Keep the invoice number within 100 characters on one line.");
   if(await db.prepare('SELECT id FROM invoices WHERE invoice_no=? AND id<>?').bind(invoiceNumber,invoiceId).first())throw new InputError("This invoice number is already in use. Choose another number.",409);
   const selected=newCustomer?null:await db.prepare("SELECT name,mobile,address FROM customers WHERE id=?").bind(customer).first<SqlRow>();
   if(!newCustomer&&!selected)throw new InputError("Customer not found",404);
   const original=current&&current.customer_id===customer?current:null;
   const contact={name:clean(p.customer_name??original?.customer_name??selected?.name),mobile:clean(p.customer_mobile??original?.customer_mobile??selected?.mobile),address:clean(p.customer_address??original?.customer_address??selected?.address)};
   if(!contact.name||contact.name.length>200||contact.mobile.length>50||contact.address.length>1000)throw new InputError("Enter a customer name, mobile number and address within the field limits.");
   if(newCustomer){
    const condition=current?" WHERE EXISTS(SELECT 1 FROM invoices WHERE id=? AND version=? AND status='active')":"";
    statements.push(db.prepare("INSERT INTO customers(name,mobile,address,opening_due) SELECT ?,?,?,0"+condition).bind(contact.name,contact.mobile,contact.address,...(current?[invoiceId,positiveId(p.expected_version)]:[])));
   }
   const customerExpression=newCustomer?"last_insert_rowid()":"?",customerArgs=newCustomer?[]:[customer];
   const productRows:SqlRow[]=[];for(const item of amounts.items){const product=await db.prepare("SELECT id,name,product_code,archived FROM products WHERE id=?").bind(item.product_id).first<SqlRow>();if(!product)throw new InputError("Product not found",404);const requested=amounts.items.filter(i=>i.product_id===item.product_id).reduce((n,i)=>n+i.quantity,0),original=current?.items.filter(i=>i.product_id===item.product_id).reduce((n,i)=>n+i.quantity,0)||0;if(product.archived&&(!current||requested>original))throw new InputError("This product is archived. Choose a current product.",409);productRows.push(product);}
   if(current){
    const version=positiveId(p.expected_version);
    statements.push(db.prepare(`UPDATE invoices SET invoice_no=?,sale_date=?,customer_id=${customerExpression},subtotal=?,discount=?,total_amount=?,paid_amount=?,account=?,notes=?,version=version+1,last_op=? WHERE id=? AND version=? AND status='active'`).bind(invoiceNumber,saleDate,...customerArgs,amounts.subtotal,amounts.discount,amounts.total_amount,amounts.paid_amount,account,clean(p.notes),key,invoiceId,version));
    statements.push(db.prepare(`DELETE FROM invoice_items WHERE invoice_id=? AND ${guard}`).bind(invoiceId,invoiceId,key));
    for(const item of current.items)statements.push(db.prepare(`DELETE FROM sales WHERE id=? AND ${guard}`).bind(item.sale_id,invoiceId,key));
   }else statements.push(db.prepare(`INSERT INTO invoices(id,invoice_no,sale_date,customer_id,subtotal,discount,total_amount,paid_amount,account,notes,last_op) VALUES(?,?,?,${customerExpression},?,?,?,?,?,?,?)`).bind(invoiceId,invoiceNumber,saleDate,...customerArgs,amounts.subtotal,amounts.discount,amounts.total_amount,amounts.paid_amount,account,clean(p.notes),key));
   statements.push(db.prepare(`UPDATE invoices SET customer_name=?,customer_mobile=?,customer_address=? WHERE id=? AND ${guard}`).bind(contact.name,contact.mobile,contact.address,invoiceId,invoiceId,key));
   amounts.items.forEach((item,index:number)=>{
    const product=productRows[index];
    statements.push(db.prepare(`INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account,notes) SELECT ?,(SELECT customer_id FROM invoices WHERE id=?),?,?,?,?,?,?,? WHERE ${guard}`).bind(saleDate,invoiceId,item.product_id,item.quantity,item.rate,item.line_total,item.paid_amount,account,clean(p.notes),invoiceId,key));
    statements.push(db.prepare(`INSERT INTO invoice_items(id,invoice_id,sale_id,product_id,product_name,product_code,quantity,rate,line_total) SELECT ?,?,last_insert_rowid(),?,?,?,?,?,? WHERE ${guard}`).bind(`${invoiceId}-line-${index}`,invoiceId,item.product_id,product.name,product.product_code,item.quantity,item.rate,item.line_total,invoiceId,key));
   });
  }else if(method==="POST"&&parts[2]==="return"&&current){
   if(p.confirmed!==true)throw new InputError("Confirm the return first.");if(current.status!=="active")throw new InputError("Invoice is cancelled.",409);
   if(!Array.isArray(p.items)||!p.items.length||!clean(p.reason))throw new InputError("Choose return quantities and enter a reason.");
   const requested=new Map<string,number>();for(const item of p.items as Payload[]){if(requested.has(item.id as string))throw new InputError("Duplicate return item.");requested.set(clean(item.id),wholeBags(item.quantity,"Return Quantity",0));}
   if([...requested.keys()].some(id=>!current.items.some((item)=>item.id===id)))throw new InputError("Invalid return item.");
   const next=current.items.map((item)=>{const q=requested.get(item.id)||0;if(q<0||q>money(item.quantity-item.returned_quantity))throw new InputError("Return quantity exceeds the remaining quantity.");const returned=money(item.returned_quantity+q),remaining=money(item.quantity-returned);return {...item,returning:q,returned,remaining,net:cents(item.line_total)*remaining/item.quantity};});
   if(!next.some((i)=>i.returning>0))throw new InputError("Enter a return quantity.");
   const netCents=next.map((i)=>Math.round(i.net));const newTotal=netCents.reduce((a:number,b:number)=>a+b,0)/100;const returned=money(current.total_amount-newTotal);const refunded=money(Math.max(0,current.paid_amount-newTotal));const credit=money(returned-current.returned_total),refund=money(refunded-current.refunded);
   const paid=allocate(cents(current.paid_amount-refunded),netCents);const returnDate=date(p.return_date||today());
   statements.push(db.prepare("UPDATE invoices SET returned_total=?,refunded=?,version=version+1,last_op=? WHERE id=? AND version=? AND status='active'").bind(returned,refunded,key,invoiceId,positiveId(p.expected_version)));
   next.forEach((item,index:number)=>{
    statements.push(db.prepare(`UPDATE invoice_items SET returned_quantity=? WHERE id=? AND ${guard}`).bind(item.returned,item.id,invoiceId,key));
    statements.push(db.prepare(`UPDATE sales SET quantity=?,total_amount=?,paid_amount=? WHERE id=? AND ${guard}`).bind(item.remaining,netCents[index]/100,paid[index]/100,item.sale_id,invoiceId,key));
    if(item.returning&&p.restock===false)statements.push(db.prepare(`INSERT INTO stock_adjustments(adjust_date,product_id,type,quantity,notes) SELECT ?,?,'Damage',?,? WHERE ${guard}`).bind(returnDate,item.product_id,item.returning,`Return ${current.invoice_no}: ${clean(p.reason)}`,invoiceId,key));
   });
   statements.push(db.prepare(`INSERT INTO invoice_returns(id,invoice_id,return_date,credit,refund,reason,items_json) SELECT ?,?,?,?,?,?,? WHERE ${guard}`).bind(key,invoiceId,returnDate,credit,refund,clean(p.reason),JSON.stringify(next.filter((i)=>i.returning>0).map((i)=>({id:i.id,product_id:i.product_id,quantity:i.returning,restock:p.restock!==false}))),invoiceId,key));
  }else if(method==="DELETE"&&parts.length===2&&current){
   if(p.confirmed!==true)throw new InputError("Confirm invoice cancellation first.");
   statements.push(db.prepare("UPDATE invoices SET status='void',returned_total=total_amount,refunded=paid_amount,version=version+1,last_op=? WHERE id=? AND version=? AND status='active'").bind(key,invoiceId,positiveId(p.expected_version)));
   for(const item of current.items)statements.push(db.prepare(`UPDATE sales SET quantity=0,total_amount=0,paid_amount=0 WHERE id=? AND ${guard}`).bind(item.sale_id,invoiceId,key));
  }else throw new InputError("Unsupported invoice operation.",404);
  marker=db.prepare("INSERT INTO sync_operations(id,payload_hash,entity,result_id,changed,customer_id) SELECT ?,?,?,?,CASE WHEN EXISTS(SELECT 1 FROM invoices WHERE id=? AND last_op=?) THEN 1 ELSE 0 END,(SELECT customer_id FROM invoices WHERE id=?)").bind(key,hash,entity,invoiceId,invoiceId,key,invoiceId);
 }else if(entity==="settings"&&method==="PUT"&&parts.length===1){
  const row=await db.prepare("SELECT value FROM app_meta WHERE key=?").bind(settingKey).first<{value:string}>();const old=JSON.parse(String(row!.value)) as BusinessSettings;if(Number(p.expected_version)!==old.version)throw new InputError("Settings changed on another device. Refresh first.",409);
  const next={name:clean(p.name),phone:clean(p.phone),address:clean(p.address),large_discount_percent:money(p.large_discount_percent),version:old.version+1};if(!next.name||next.name.length>120||next.phone.length>50||next.address.length>500||next.large_discount_percent<0||next.large_discount_percent>100)throw new InputError("Check the business settings.");
  statements.push(db.prepare("UPDATE app_meta SET value=? WHERE key=? AND value=?").bind(JSON.stringify(next),settingKey,row!.value));resultId="settings";
  marker=db.prepare("INSERT INTO sync_operations(id,payload_hash,entity,result_id,changed) SELECT ?,?,?,?,changes()").bind(key,hash,entity,resultId);
 }else if(tables[entity]&&parts.length===2&&["DELETE","PATCH"].includes(method)){
  const table=tables[entity];const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?`).bind(positiveId(recordId)).first<SqlRow>();if(!row)throw new InputError("Record not found",404);
  if(!p.original||typeof p.original!=="object")throw new InputError("Refresh the record before changing it.",409);
  const original=p.original as Payload;const keys=Object.keys(row);if(keys.some(column=>!(column in original)||!(original[column]===null||["string","number"].includes(typeof original[column]))))throw new InputError("Reload the complete record before changing it.",409);let condition="id=?";const args:unknown[]=[positiveId(recordId)];
  for(const column of keys){if(column in original){condition+=` AND ${column} IS ?`;args.push(original[column]);}}
  if(method==="DELETE"){
   if(p.confirmed!==true)throw new InputError("Confirm deletion first.");
   if(["products","customers"].includes(entity)){const column=entity==="products"?"product_id":"customer_id";const used=await db.prepare(`SELECT id FROM sales WHERE ${column}=? LIMIT 1`).bind(positiveId(recordId)).first();if(used)throw new InputError("This record is used by an invoice and cannot be deleted.",409);}
   if(entity==='transactions'&&row.transfer_id){
    statements.push(db.prepare(`WITH matched AS MATERIALIZED (SELECT transfer_id FROM transactions WHERE ${condition}) DELETE FROM transactions WHERE transfer_id IN (SELECT transfer_id FROM matched)`).bind(...args));
   }else statements.push(db.prepare(`DELETE FROM ${table} WHERE ${condition}`).bind(...args));
  }else if(entity==="products") {
    // Absolute stock edits append one adjustment; the stock snapshot joins the
    // metadata condition in the same atomic batch to reject concurrent sales.
    if(row.archived)throw new InputError("This product is archived. Choose a current product.",409);
    const metadata={...p};delete metadata.current_stock;
    const next=productUpdate(row as ProductRecord,metadata);
    let delta=0,target=0,expected=0,adjustDate="",note="";
    if ("current_stock" in p) {
      target=wholeBags(p.current_stock,"Current Bag",0);
      if (!("current_stock" in original) || !Number.isFinite(Number(original.current_stock))) throw new InputError("Refresh the stock before setting Current Bag.",409);
      expected=money(original.current_stock);delta=money(target-expected);
      if(delta!==0 && p.confirmed_stock!==true)throw new InputError("Confirm the Current Bag adjustment first.");
      adjustDate=date(p.adjust_date||today());const reason=clean(p.stock_reason);if(reason.length>1000)throw new InputError("Keep the stock adjustment note within 1000 characters.");
      note=`Current Bag ${expected} -> ${target}${reason?": "+reason:""}`;
      const stock=`ROUND(products.opening_stock+COALESCE((SELECT SUM(quantity) FROM company_orders o WHERE o.product_id=products.id AND o.status='Delivered'),0)-COALESCE((SELECT SUM(quantity) FROM sales s WHERE s.product_id=products.id),0)+COALESCE((SELECT SUM(CASE WHEN type IN ('Return','Manual Add') THEN quantity ELSE -quantity END) FROM stock_adjustments a WHERE a.product_id=products.id),0),2)`;
      condition+=` AND (${stock}) IS ?`;args.push(expected);
    }
    statements.push(db.prepare(`UPDATE products SET name=?,product_code=?,bag_weight=?,default_rate=?,low_stock_level=?,category=?,feed_size=?,protein_percent=? WHERE ${condition}`).bind(next.name,next.product_code,next.bag_weight,next.default_rate,next.low_stock_level,next.category,next.feed_size,next.protein_percent,...args));
    // changes() is the preceding guarded product update. The final operation
    // marker then captures this insert, so conflicts never append adjustments.
    if(delta!==0)statements.push(db.prepare("INSERT INTO stock_adjustments(adjust_date,product_id,type,quantity,notes) SELECT ?,?,?,?,? WHERE changes()=1").bind(adjustDate,positiveId(recordId),delta>0?"Manual Add":"Manual Minus",Math.abs(delta),note));
  }
  else if(entity==="customers") {
    const next=customerUpdate(row as CustomerRecord,p);
    // Freeze contact details for pre-snapshot invoices before changing the
    // customer. The original-record condition also protects this backfill.
    statements.push(db.prepare(`UPDATE invoices SET customer_name=?,customer_mobile=?,customer_address=? WHERE customer_id=? AND customer_name='' AND EXISTS(SELECT 1 FROM customers WHERE ${condition})`).bind(row.name,row.mobile||"",row.address||"",positiveId(recordId),...args));
    statements.push(db.prepare(`UPDATE customers SET name=?,mobile=?,address=? WHERE ${condition}`).bind(next.name,next.mobile,next.address,...args));
  }
  else if(entity==="payments") {
    if(positiveId(p.customer_id)!==Number(row.customer_id))throw new InputError("A collection must stay with its original customer.");
    const amount=nonnegative(p.amount),notes=clean(p.notes);
    if(amount<=0||!["Cash","Bank"].includes(p.account as string)||notes.length>1000)throw new InputError("Enter a positive collection amount and choose Cash or Bank.");
    statements.push(db.prepare(`UPDATE customer_payments SET payment_date=?,amount=?,account=?,notes=? WHERE ${condition}`).bind(date(p.payment_date),amount,p.account,notes,...args));
  }
  else if(entity==="transactions") {
    if(!["Expense","Transport Cost","Other Expense"].includes(row.type as string)||!["Expense","Transport Cost","Other Expense"].includes(p.type as string)||money(p.amount)<=0||!["Cash","Bank"].includes(p.account as string))throw new InputError("Check the expense details.");
    statements.push(db.prepare(`UPDATE transactions SET txn_date=?,type=?,amount=?,account=?,category=?,reference=?,notes=? WHERE ${condition}`).bind(date(p.txn_date),p.type,money(p.amount),p.account,clean(p.category)||"General",clean(p.reference),clean(p.notes),...args));
  } else throw new InputError("Use the invoice editor to edit a sale.",404);
 }else throw new InputError("Unsupported command.",404);
 try{await db.batch([...statements,marker]);}catch(error){const replay=await previous(db,key,hash);if(replay)return commandResult(db,replay,true);integrityError(error);}
 const result=await previous(db,key,hash);return commandResult(db,result!,false);
}
