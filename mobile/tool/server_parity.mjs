// Regenerate with Node 24 from the full project checkout. Uses only an in-memory test DB.
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from '../../online-site/tests/d1-adapter.mjs';
import {ensureSeeded} from '../../online-site/lib/ledger.ts';
import {workspaceBootstrap,executeCommand} from '../../online-site/lib/workspace.ts';
const db=database(),fixtures=[];
try{
 await ensureSeeded(db);let before=await workspaceBootstrap(db);
 const product=before.products[0].id,customer=before.customers[0].id;
 db.connection.prepare('UPDATE products SET opening_stock=100 WHERE id=?').run(product);
 async function run(name,method,path,payload){before=await workspaceBootstrap(db);const operation={id:randomUUID(),method,path,payload,workspace_epoch:before.workspace_epoch,temp_id:-123,created_at:0};await executeCommand(db,operation);const expected=await workspaceBootstrap(db);fixtures.push({name,before,operation,expected});return expected;}
 await run('Income','POST','/api/transactions',{txn_date:'2026-10-28',type:'Other Income',account:'Cash',amount:1000,category:'General'});
 await run('Atomic transfer','POST','/api/transactions',{txn_date:'2026-10-28',type:'Bank Deposit',account:'Cash',amount:100,category:'General'});
 await run('Delivered order adds whole bags','POST','/api/orders',{order_date:'2026-10-28',product_id:product,quantity:7,bag_weight:25,rate:50,total_amount:350,status:'Delivered',delivery_date:'2026-10-28'});
 await run('Damage reduces stock','POST','/api/adjustments',{adjust_date:'2026-10-28',product_id:product,quantity:2,type:'Damage',notes:'Test damage',confirmed:true});
 const invoice=randomUUID();let after=await run('Invoice cents allocation','POST','/api/invoices',{id:invoice,sale_date:'2026-10-28',customer_id:customer,invoice_no:'FLUTTER-42',items:[{product_id:product,quantity:3,rate:100.01},{product_id:product,quantity:2,rate:50.03}],discount_type:'amount',discount_value:10.07,paid_amount:350,account:'Cash'});
 after=await run('Partial return without restocking','POST',`/api/invoices/${invoice}/return`,{expected_version:after.invoices[0].version,confirmed:true,return_date:'2026-10-29',restock:false,reason:'Parity test return',items:[{id:after.invoices[0].items[0].id,quantity:1}]});
 await run('Separate customer collection','POST','/api/payments',{customer_id:customer,payment_date:'2026-10-29',amount:10,account:'Bank',notes:'Parity collection'});
 after=await workspaceBootstrap(db);const payment=after.payments[0];await run('Edit customer collection','PATCH',`/api/payments/${payment.id}`,{...payment,amount:12,original:payment});
 after=await workspaceBootstrap(db);await run('Cancel returned invoice','DELETE',`/api/invoices/${invoice}`,{expected_version:after.invoices[0].version,confirmed:true});
 after=await workspaceBootstrap(db);const transfer=after.transactions.find(t=>t.type==='Bank Deposit');await run('Delete transfer pair','DELETE',`/api/transactions/${transfer.id}`,{original:transfer,confirmed:true});
 writeFileSync(new URL('../test/fixtures/server-parity.json',import.meta.url),JSON.stringify(fixtures));console.log(`Generated ${fixtures.length} server parity cases from in-memory DB.`);
}finally{db.connection.close();}
