import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {database} from './d1-adapter.mjs';
import {insertRecord,wholeBags} from '../lib/ledger.ts';
import {executeCommand,workspaceBootstrap,getInvoice} from '../lib/workspace.ts';
const command=(method,path,payload)=>({id:randomUUID(),method,path,payload});
async function setup(){const db=database();const data=await workspaceBootstrap(db);return {db,product:data.products[0],other:data.products[1],customer:data.customers[0]};}
const invoice=(f,quantity=1,extra={})=>({id:randomUUID(),sale_date:'2026-10-19',customer_id:f.customer.id,items:[{product_id:f.product.id,quantity,rate:100.25}],paid_amount:10.25,account:'Cash',...extra});
const product=(data,id)=>data.products.find(p=>p.id===id);

test('Current Bag uses one audited adjustment, supports increase/decrease and replays once',async()=>{
 const f=await setup();try{
  await executeCommand(f.db,command('POST','/api/orders',{product_id:f.product.id,quantity:20,rate:50.25,order_date:'2026-10-19',status:'Delivered'}));
  const sale=invoice(f,3);await executeCommand(f.db,command('POST','/api/invoices',sale));
  const before=await workspaceBootstrap(f.db),original=product(before,f.product.id);assert.equal(original.current_stock,17);
  const edit=command('PATCH',`/api/products/${original.id}`,{name:'Counted product',current_stock:30,original,confirmed_stock:true,adjust_date:'2026-10-19',stock_reason:'Warehouse count'});
  await executeCommand(f.db,edit);assert.equal((await executeCommand(f.db,edit)).replayed,true);
  let after=await workspaceBootstrap(f.db);assert.equal(product(after,original.id).current_stock,30);assert.equal(after.adjustments.length,1);assert.equal(after.adjustments[0].quantity,13);assert.equal(after.adjustments[0].type,'Manual Add');assert.match(after.adjustments[0].notes,/17 -> 30: Warehouse count/);
  await executeCommand(f.db,command('PATCH',`/api/products/${original.id}`,{current_stock:12,original:product(after,original.id),confirmed_stock:true}));
  after=await workspaceBootstrap(f.db);assert.equal(product(after,original.id).current_stock,12);assert.equal(after.adjustments.length,2);assert.ok(after.adjustments.some(a=>a.type==='Manual Minus'&&a.quantity===18));
  assert.equal(product(after,original.id).opening_stock,original.opening_stock);assert.equal(after.dashboard.cash_balance,before.dashboard.cash_balance);assert.equal(after.dashboard.customer_due,before.dashboard.customer_due);assert.equal((await getInvoice(f.db,sale.id)).items[0].quantity,3);
 }finally{f.db.connection.close();}
});

test('Current Bag conflicts with an intervening sale and never partially updates metadata',async()=>{
 const f=await setup();try{
  f.db.connection.prepare('UPDATE products SET opening_stock=1 WHERE id=?').run(f.product.id);f.product=product(await workspaceBootstrap(f.db),f.product.id);
  const edit=command('PATCH',`/api/products/${f.product.id}`,{name:'Must not save',current_stock:10,original:f.product,confirmed_stock:true});
  await executeCommand(f.db,command('POST','/api/invoices',invoice(f)));
  await assert.rejects(executeCommand(f.db,edit),{status:409});await assert.rejects(executeCommand(f.db,edit),{status:409});
  const data=await workspaceBootstrap(f.db);assert.equal(product(data,f.product.id).name,f.product.name);assert.equal(product(data,f.product.id).current_stock,0);assert.equal(data.adjustments.length,0);assert.equal(data.invoices.length,1);
  await assert.rejects(executeCommand(f.db,command('PATCH',`/api/products/${f.other.id}`,{current_stock:5,original:f.other})),/Confirm/);
  await assert.rejects(executeCommand(f.db,command('PATCH',`/api/products/${f.other.id}`,{name:f.product.name,current_stock:5,original:f.other,confirmed_stock:true})),/UNIQUE/);
  assert.equal((await workspaceBootstrap(f.db)).adjustments.length,0);
 }finally{f.db.connection.close();}
});

test('explicit whole-bag correction preserves fractional history instead of rewriting it',async()=>{
 const f=await setup();try{
  // Import fractional history before this migration, then enable its safeguards.
  f.db.connection.exec('DROP TRIGGER guard_adjustment_stock_insert');
  f.db.connection.prepare("INSERT INTO stock_adjustments(adjust_date,product_id,type,quantity) VALUES ('2026-10-18',?,'Damage',.5)").run(f.product.id);
  f.db.connection.exec(readFileSync(new URL('../drizzle/0004_financial_integrity.sql',import.meta.url),'utf8'));
  const original=product(await workspaceBootstrap(f.db),f.product.id);assert.equal(original.current_stock,-.5);
  await executeCommand(f.db,command('PATCH',`/api/products/${original.id}`,{current_stock:4,original,confirmed_stock:true}));
  const data=await workspaceBootstrap(f.db);assert.equal(product(data,original.id).current_stock,4);assert.ok(data.adjustments.some(a=>a.type==='Damage'&&a.quantity===.5));assert.ok(data.adjustments.some(a=>a.type==='Manual Add'&&a.quantity===4.5));
 }finally{f.db.connection.close();}
});

test('customer contact edit preserves balances and both modern and legacy invoice contacts',async()=>{
 const f=await setup();try{
  f.db.connection.prepare('UPDATE products SET opening_stock=10 WHERE id=?').run(f.product.id);
  await insertRecord(f.db,'customers',{name:'Old Customer',mobile:'01700000001',address:'Old address',opening_due:120.75});
  let data=await workspaceBootstrap(f.db);const customer=data.customers.find(c=>c.name==='Old Customer');f.customer=customer;
  const modern=invoice(f,2);await executeCommand(f.db,command('POST','/api/invoices',modern));
  await insertRecord(f.db,'sales',{sale_date:'2026-10-18',customer_id:customer.id,product_id:f.product.id,quantity:1,rate:25.5,paid_amount:5.25,account:'Cash'});
  await insertRecord(f.db,'payments',{payment_date:'2026-10-19',customer_id:customer.id,amount:20.25,account:'Bank'});
  const before=await workspaceBootstrap(f.db),original=before.customers.find(c=>c.id===customer.id),legacy=before.invoices.find(i=>i.id.startsWith('legacy-'));
  const edit=command('PATCH',`/api/customers/${customer.id}`,{name:'Updated Customer',mobile:'01800000002',address:'New address',original});await executeCommand(f.db,edit);assert.equal((await executeCommand(f.db,edit)).replayed,true);
  data=await workspaceBootstrap(f.db);const updated=data.customers.find(c=>c.id===customer.id);assert.equal(updated.name,'Updated Customer');assert.equal(updated.mobile,'01800000002');assert.equal(updated.address,'New address');assert.equal(updated.opening_due,original.opening_due);assert.equal(updated.current_due,original.current_due);assert.equal(updated.total_paid,original.total_paid);assert.equal(data.dashboard.cash_balance,before.dashboard.cash_balance);assert.equal(data.dashboard.bank_balance,before.dashboard.bank_balance);
  for(const id of [modern.id,legacy.id]){const i=await getInvoice(f.db,id);assert.equal(i.customer_name,'Old Customer');assert.equal(i.customer_mobile,'01700000001');assert.equal(i.customer_address,'Old address');}
  assert.equal(f.db.connection.prepare('SELECT customer_name FROM invoices WHERE id=?').get(legacy.id).customer_name,'Old Customer');
  await assert.rejects(executeCommand(f.db,command('PATCH',`/api/customers/${customer.id}`,{name:'Stale customer',original})),{status:409});
  for(const invalid of [{opening_due:0},{current_due:0},{name:'  '},{mobile:'x'.repeat(51)}])await assert.rejects(executeCommand(f.db,command('PATCH',`/api/customers/${customer.id}`,{...invalid,original:updated})),{status:400});
  const next=invoice(f);await executeCommand(f.db,command('POST','/api/invoices',next));assert.equal((await getInvoice(f.db,next.id)).customer_name,'Updated Customer');
 }finally{f.db.connection.close();}
});

test('new quantities reject decimals before rounding while prices and payments retain cents',async()=>{
 const f=await setup();try{
  for(const value of [1.5,1.0001,.9999,Infinity,''])assert.throws(()=>wholeBags(value,'Quantity',1),/whole number/);
  await assert.rejects(executeCommand(f.db,command('POST','/api/invoices',invoice(f,1.5))),/whole number/);
  await assert.rejects(executeCommand(f.db,command('POST','/api/orders',{product_id:f.product.id,quantity:1.5,rate:10,order_date:'2026-10-19'})),/whole number/);
  await assert.rejects(executeCommand(f.db,command('POST','/api/adjustments',{product_id:f.product.id,quantity:.5,type:'Manual Add',adjust_date:'2026-10-19',confirmed:true})),/whole number/);
  await assert.rejects(executeCommand(f.db,command('POST','/api/products',{name:'Invalid opening',opening_stock:1.5})),/whole number/);
  await assert.rejects(executeCommand(f.db,command('PATCH',`/api/products/${f.product.id}`,{current_stock:1.5,confirmed_stock:true,original:f.product})),/whole number/);
  await assert.rejects(executeCommand(f.db,command('PATCH',`/api/products/${f.product.id}`,{low_stock_level:1.5,original:f.product})),/whole number/);
  f.db.connection.prepare("UPDATE products SET opening_stock=2 WHERE id=?").run(f.product.id);
  const sale=invoice(f,2);await executeCommand(f.db,command('POST','/api/invoices',sale));const saved=await getInvoice(f.db,sale.id);assert.equal(saved.total_amount,200.5);assert.equal(saved.paid_amount,10.25);
  await assert.rejects(executeCommand(f.db,command('POST',`/api/invoices/${sale.id}/return`,{items:[{id:saved.items[0].id,quantity:.5}],confirmed:true,reason:'Return',expected_version:1})),/whole number/);
  assert.equal((await workspaceBootstrap(f.db)).returns.length,0);
 }finally{f.db.connection.close();}
});
