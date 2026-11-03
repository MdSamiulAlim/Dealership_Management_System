import {allocateCents} from '../public/money-allocation.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import catalog from '../lib/supplier-catalog-2026.json' with {type:'json'};
import {database} from './d1-adapter.mjs';
import {bootstrap,ensureSeeded,insertRecord} from '../lib/ledger.ts';
import {applySupplierCatalog,removeUnlistedProducts} from '../lib/supplier-catalog.ts';
import {workspaceBootstrap,executeCommand,getInvoice} from '../lib/workspace.ts';
const cmd=(method,path,payload)=>({id:randomUUID(),method,path,payload});
async function fixture(){
 const db=database();await ensureSeeded(db);await applySupplierCatalog(db);
 const product=(await bootstrap(db)).products.find(p=>p.product_code==='700');
 db.connection.prepare('UPDATE products SET opening_stock=20 WHERE id=?').run(product.id);
 await insertRecord(db,'orders',{order_date:'2026-10-22',product_id:product.id,quantity:10,rate:100,status:'Delivered'});
 await insertRecord(db,'sales',{sale_date:'2026-10-22',customer_id:1,product_id:product.id,quantity:2,rate:100,paid_amount:50});
 await insertRecord(db,'adjustments',{adjust_date:'2026-10-22',product_id:product.id,quantity:3,type:'Damage'});
 const before=await bootstrap(db),after=await workspaceBootstrap(db);return {db,product,before,after};
}

test('only the 54 supplied products remain active; archived stock and all accounts survive',async()=>{
 const f=await fixture();try{
  assert.equal(f.after.products.length,54);assert.equal(f.after.archived_products.length,20);
  assert.deepEqual(f.after.products.map(p=>p.product_code).sort(),catalog.products.map(p=>p.code).sort());
  assert.equal(f.after.products.some(p=>p.id===f.product.id),false);
  const old=f.after.archived_products.find(p=>p.id===f.product.id);assert.equal(old.current_stock,25);assert.equal(old.archived,1);
  for(const key of ['cash_balance','bank_balance','customer_due','company_payable'])assert.equal(f.after.dashboard[key],f.before.dashboard[key],key);
  assert.equal(f.after.dashboard.current_stock+f.after.dashboard.archived_stock,f.before.dashboard.current_stock);
  assert.equal(f.after.reports.stock_report.find(p=>p.id===f.product.id).current_stock,25);
  assert.equal((await getInvoice(f.db,'legacy-1')).items[0].product_name,f.product.name);
  await removeUnlistedProducts(f.db);assert.deepEqual((await workspaceBootstrap(f.db)).products,f.after.products);
  const added=await executeCommand(f.db,cmd('POST','/api/products',{name:'Added after cleanup',category:'Fish feed',opening_stock:1}));
  assert.ok((await workspaceBootstrap(f.db)).products.some(p=>String(p.id)===added.id));
 }finally{f.db.connection.close();}
});

test('archived SKUs cannot create new sales, orders or manual stock changes',async()=>{
 const f=await fixture();try{
  const cases=[['sales',{sale_date:'2026-10-22',customer_id:1,product_id:f.product.id,quantity:1,rate:100,paid_amount:0}],['orders',{order_date:'2026-10-22',product_id:f.product.id,quantity:1,rate:100,status:'Delivered'}],['adjustments',{adjust_date:'2026-10-22',product_id:f.product.id,type:'Manual Add',quantity:1,confirmed:true}]];
  for(const [entity,payload] of cases){await assert.rejects(insertRecord(f.db,entity,payload),{status:409});if(entity!=='sales')await assert.rejects(executeCommand(f.db,cmd('POST','/api/'+entity,payload)),{status:409});}
  await assert.rejects(executeCommand(f.db,cmd('POST','/api/invoices',{id:randomUUID(),sale_date:'2026-10-22',customer_id:1,items:[{product_id:f.product.id,quantity:1,rate:100}],paid_amount:0})),{status:409});
  const after=await workspaceBootstrap(f.db);for(const key of ['invoices','sales','orders','adjustments'])assert.deepEqual(after[key],f.after[key]);
 }finally{f.db.connection.close();}
});

test('old invoice edits and returns continue working for archived products without extra sales',async()=>{
 const f=await fixture();try{
  const old=await getInvoice(f.db,'legacy-1'),payload={sale_date:old.sale_date,customer_id:old.customer_id,customer_name:old.customer_name,items:[{product_id:f.product.id,quantity:2,rate:100}],paid_amount:50,account:'Cash',expected_version:old.version,notes:'Updated memo'};
  await executeCommand(f.db,cmd('PATCH','/api/invoices/'+old.id,payload));const edited=await getInvoice(f.db,old.id);assert.equal(edited.items[0].product_id,f.product.id);
  await assert.rejects(executeCommand(f.db,cmd('PATCH','/api/invoices/'+old.id,{...payload,expected_version:edited.version,items:[{product_id:f.product.id,quantity:3,rate:100}]})),{status:409});
  await executeCommand(f.db,cmd('POST',`/api/invoices/${old.id}/return`,{confirmed:true,expected_version:edited.version,return_date:'2026-10-22',reason:'Old stock return',items:[{id:edited.items[0].id,quantity:1}]}));
  const after=await workspaceBootstrap(f.db);assert.equal(after.products.length,54);assert.equal(after.archived_products.find(p=>p.id===f.product.id).current_stock,26);assert.equal(after.dashboard.cash_balance,50);assert.equal(after.dashboard.customer_due,50);
 }finally{f.db.connection.close();}
});

test('offline projections include archived accounts and reject new archived-product sales',async()=>{
 const f=await fixture();try{
  const source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8').replace('let journalReports=null,shares=null','let journalReports=null,shares=testShares').replace('window.WorkspaceStore={','window.ArchiveTest={protectHistoryAndStock,apply,recalculate};window.WorkspaceStore={');
  const context=vm.createContext({testShares:allocateCents,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},structuredClone,Intl,setInterval(){}});vm.runInContext(source,context);
  const api=context.window.ArchiveTest,s=structuredClone(f.after);
  assert.throws(()=>api.protectHistoryAndStock(s,cmd('POST','/api/invoices',{items:[{product_id:f.product.id,quantity:1,rate:100}]})),/archived/);
  const invoice=s.invoices[0],op=cmd('POST',`/api/invoices/${invoice.id}/return`,{confirmed:true,expected_version:invoice.version,return_date:'2026-10-22',reason:'Offline return',items:[{id:invoice.items[0].id,quantity:1}]});
  api.protectHistoryAndStock(s,op);api.apply(s,op);api.recalculate(s);await executeCommand(f.db,op);const server=await workspaceBootstrap(f.db);
  for(const key of ['cash_balance','customer_due','company_payable','current_stock','archived_stock'])assert.equal(s.dashboard[key],server.dashboard[key],key);
  assert.equal(s.archived_products.find(p=>p.id===f.product.id).current_stock,26);
 }finally{f.db.connection.close();}
});

test('downloadable complete list has the 54 image codes and only requested specifications',()=>{
 const csv=readFileSync(new URL('../public/product-list-2026.csv',import.meta.url),'utf8').replace(/^\uFEFF/,'').trim().split(/\r?\n/).map(line=>line.split(','));
 assert.deepEqual(csv[0],['Category','Code','Item','Size','Protein (%)','Pack Size (kg)']);assert.equal(csv.length,55);
 assert.deepEqual(csv.slice(1).map(row=>row[1]).sort(),catalog.products.map(p=>p.code).sort());assert.ok(csv.every(row=>row.length===6));
});
