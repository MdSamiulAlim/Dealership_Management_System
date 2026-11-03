import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {database} from './d1-adapter.mjs';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';
import {guardWorkspaceWrites,resetWorkspace,workspaceEpoch} from '../lib/workspace-access.ts';
const admin={username:'TestMaster',role:'admin'},general={username:'TestStaff',role:'general'};
const command=(method,path,payload,epoch=0)=>({id:randomUUID(),method,path,payload,workspace_epoch:epoch});
const reset=(epoch=0)=>({id:randomUUID(),workspace_epoch:epoch,confirmation:'RESET ALL DATA'});
const catalog=db=>db.connection.prepare('SELECT * FROM products ORDER BY id').all().map(p=>({...p}));
async function fixture(){
 const db=database(),before=await workspaceBootstrap(db);
 db.connection.prepare('UPDATE products SET opening_stock=20,default_rate=777,low_stock_level=3 WHERE id=?').run(before.products[0].id);
 db.connection.prepare('UPDATE products SET opening_stock=7 WHERE id=?').run(before.archived_products[0].id);
 await executeCommand(db,command('POST','/api/products',{name:'Custom retained feed',product_code:'CUSTOM',category:'Fish feed',feed_size:'2 mm',protein_percent:30,bag_weight:25,opening_stock:9,default_rate:123.45,low_stock_level:4}));
 const invoice={id:randomUUID(),sale_date:'2026-10-19',customer_id:before.customers[0].id,items:[{product_id:before.products[0].id,quantity:1,rate:100}],paid_amount:50,account:'Cash'};
 await executeCommand(db,command('POST','/api/invoices',invoice));
 const inv=(await workspaceBootstrap(db)).invoices[0];
 await executeCommand(db,command('POST',`/api/invoices/${inv.id}/return`,{expected_version:1,confirmed:true,reason:'Fixture return',return_date:'2026-10-19',items:[{id:inv.items[0].id,quantity:1}]}));
 await executeCommand(db,command('POST','/api/transactions',{txn_date:'2026-10-19',type:'Expense',amount:12.5,account:'Cash'}));
 return db;
}

test('only Admin can reset, and a missing typed confirmation changes nothing',async()=>{
 const db=await fixture();try{
  const before=await workspaceBootstrap(db);
  await assert.rejects(resetWorkspace(db,general,reset()),{status:403});
  await assert.rejects(resetWorkspace(db,admin,{...reset(),confirmation:'reset'}),/Type RESET/);
  const after=await workspaceBootstrap(db);
  for(const key of ['products','archived_products','invoices','transactions'])assert.deepEqual(after[key],before[key],key);
  assert.equal(after.workspace_epoch,0);
 }finally{db.connection.close();}
});

test('reset preserves the complete catalog and prices, zeros stock, clears ledgers and replays once',async()=>{
 const db=await fixture();try{
  const before=await workspaceBootstrap(db),products=catalog(db),r=reset();
  await resetWorkspace(db,admin,r);
  const data=await workspaceBootstrap(db);
  assert.deepEqual(catalog(db),products.map(p=>({...p,opening_stock:0})));
  assert.equal(data.products.length,before.products.length);
  assert.equal(data.archived_products.length,before.archived_products.length);
  for(const p of [...data.products,...data.archived_products])for(const key of ['opening_stock','current_stock','received_stock','sold_stock'])assert.equal(p[key],0,`${p.id}: ${key}`);
  for(const key of ['customers','invoices','sales','returns','orders','adjustments','payments','transactions'])assert.equal(data[key].length,0,key);
  for(const key of ['cash_balance','bank_balance','customer_due','company_payable','current_stock','archived_stock'])assert.equal(data.dashboard[key],0,key);
  assert.equal(data.workspace_epoch,1);assert.equal(data.settings.name,'Arafat Traders');
  assert.ok(db.connection.prepare('SELECT value FROM app_meta WHERE key=?').get('initial_records_v1'));
  assert.equal((await resetWorkspace(db,admin,r)).replayed,true);assert.equal(await workspaceEpoch(db),1);
  await workspaceBootstrap(db);
  assert.deepEqual(catalog(db),products.map(p=>({...p,opening_stock:0})));
  const created=await executeCommand(db,command('POST','/api/products',{name:'After reset',opening_stock:0,default_rate:1,low_stock_level:5,bag_weight:50},1));
  assert.ok(Number(created.id)>Math.max(...products.map(p=>p.id)));
 }finally{db.connection.close();}
});

test('old pending work and racing writes cannot restore pre-reset stock or records',async()=>{
 const db=await fixture();try{
  const before=await workspaceBootstrap(db),product=before.products[0];
  const stale=command('POST','/api/products',{name:'Stale',opening_stock:1});
  const racing=guardWorkspaceWrites(db,0);
  await resetWorkspace(db,admin,reset());
  await assert.rejects(executeCommand(db,stale),{status:409});
  delete stale.workspace_epoch;await assert.rejects(executeCommand(db,stale),{status:409});
  await assert.rejects(racing.prepare('INSERT INTO customers(name) VALUES (?)').bind('Late writer').run(),{status:409});
  await assert.rejects(racing.prepare('UPDATE products SET opening_stock=20 WHERE id=?').bind(product.id).run(),{status:409});
  const after=await workspaceBootstrap(db);
  assert.equal(after.products.length,before.products.length);assert.equal(after.customers.length,0);
  assert.ok(after.products.every(p=>p.current_stock===0));
  await assert.rejects(resetWorkspace(db,admin,reset(0)),{status:409});
 }finally{db.connection.close();}
});

test('a failed reset rolls back product balances, invoices, ledgers, audit and epoch together',async()=>{
 const db=await fixture();try{
  const before=await workspaceBootstrap(db);
  db.connection.exec("CREATE TRIGGER fail_reset BEFORE UPDATE OF opening_stock ON products BEGIN SELECT RAISE(ABORT,'fixture rollback'); END");
  await assert.rejects(resetWorkspace(db,admin,reset()),/fixture rollback/);
  const after=await workspaceBootstrap(db);
  for(const key of ['products','archived_products','customers','invoices','sales','returns','transactions'])assert.deepEqual(after[key],before[key],key);
  assert.equal(after.workspace_epoch,0);
  assert.equal(db.connection.prepare("SELECT value FROM app_meta WHERE key='workspace_last_reset_v1'").get(),undefined);
 }finally{db.connection.close();}
});
