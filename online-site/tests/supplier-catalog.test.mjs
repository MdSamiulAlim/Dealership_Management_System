import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import catalog from '../lib/supplier-catalog-2026.json' with {type:'json'};
import {database,D1Adapter} from './d1-adapter.mjs';
import {ensureSeeded,bootstrap,updateProduct,insertRecord} from '../lib/ledger.ts';
import {applySupplierCatalog,supplierCatalogState} from '../lib/supplier-catalog.ts';
import {workspaceBootstrap,getInvoice,executeCommand} from '../lib/workspace.ts';
import {resetWorkspace} from '../lib/workspace-access.ts';
const command=(method,path,payload)=>({id:randomUUID(),method,path,payload});

test('supplied images contain all 54 codes, exact specifications and no prices',()=>{
 const groups=Object.groupBy(catalog.products,p=>p.category);
 assert.deepEqual(Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),{'Poultry feed':15,'Cattle feed':8,'Fish feed':31});
 assert.equal(new Set(catalog.products.map(p=>p.code)).size,54);assert.equal(new Set(catalog.products.map(p=>p.name)).size,54);
 const p=code=>catalog.products.find(p=>p.code===code);
 for(const code of ['101','102','103','201','202','203','208','204','205','206','207','301','302','901','902','402','403','404','405','406','407','401','408','801','802','501','503','505','506','507','541','542','512','513','514','515','521','522','523','525','526','531','532','534','535','536','537','601','611','612','614','615','622','623'])assert.ok(p(code),code);
 assert.equal(p('203').feed_size,'Mash');assert.equal(p('208').feed_size,'Pellet');assert.equal(p('407').pack_kg,40);assert.equal(p('401').pack_kg,5);
 assert.deepEqual(['801','802','501','503','505','506','507','541','542','512','513','514','515','521','522','523','525','526','531','532','534','535','536','537','601','611','612','614','615','622','623'].map(code=>p(code).protein_percent),[40,35,40,40,37,37,35,34,33,30,28,27,25,30,28,26,26,25,25,24,22,22,24,21,28,28,27,26,25,24,22]);
 assert.equal(p('501').feed_size,'0.6 mm');assert.equal(p('542').feed_size,'2.5 mm');
 assert.ok(catalog.products.filter(p=>p.category!=='Fish feed').every(p=>p.protein_percent===null));
 assert.ok(catalog.products.every(p=>Object.keys(p).every(key=>!/price|rate|mrp|commission/i.test(key))));
});

test('image import reuses product IDs and preserves rates, stock, cash, due and old invoice text',async()=>{
 const db=database();try{
  await ensureSeeded(db);
  db.connection.prepare('UPDATE products SET opening_stock=12,default_rate=1234.56 WHERE id=9').run();
  db.connection.prepare("INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account) VALUES('2026-10-22',1,9,2,100,200,50,'Cash')").run();
  const before=await bootstrap(db),old=before.products.find(p=>p.id===9),after=await workspaceBootstrap(db);
  const ids=new Set(after.supplier_catalog.product_ids);assert.equal(ids.size,54);
  const imported=after.products.filter(p=>ids.has(p.id));
  for(const entry of catalog.products){const p=imported.find(p=>p.product_code===entry.code);assert.ok(p,entry.code);assert.equal(p.name,entry.name);assert.equal(p.category,entry.category);assert.equal(p.feed_size,entry.feed_size);assert.equal(p.protein_percent,entry.protein_percent);assert.equal(p.bag_weight,entry.pack_kg);}
  const current=after.products.find(p=>p.product_code==='102');assert.equal(current.id,9);assert.equal(current.current_stock,old.current_stock);assert.equal(current.default_rate,1234.56);
  for(const previous of before.products){const current=[...after.products,...after.archived_products].find(p=>p.id===previous.id);assert.ok(current);for(const key of ['opening_stock','received_stock','sold_stock','current_stock','default_rate','bag_weight'])assert.equal(current[key],previous[key],key);}
  for(const key of ['cash_balance','bank_balance','customer_due','company_payable','current_stock'])assert.equal(after.dashboard[key],before.dashboard[key],key);
  const invoice=await getInvoice(db,'legacy-1');assert.equal(invoice.items[0].product_name,old.name);assert.equal(invoice.items[0].rate,100);
  assert.equal(after.supplier_catalog.previous_ids.length,20);
  for(const p of after.products.filter(p=>!before.products.some(old=>old.id===p.id))){assert.equal(p.default_rate,0);assert.equal(p.opening_stock,0);}
 }finally{db.connection.close();}
});

test('import replays once across devices; custom records and subsequent edits survive',async()=>{
 const db=database();try{
  await ensureSeeded(db);await insertRecord(db,'products',{name:'My custom product',category:'Fish feed',opening_stock:3,default_rate:77});
  // D1 serializes atomic batches; emulate that across two adapter clients.
  let pending=Promise.resolve();const device=()=>({prepare:db.prepare.bind(db),batch:statements=>{const next=pending.then(()=>db.batch(statements));pending=next.catch(()=>{});return next;}});
  await Promise.all([applySupplierCatalog(device()),applySupplierCatalog(device())]);
  let snapshot=await workspaceBootstrap(db),p=snapshot.products.find(p=>p.product_code==='513');
  assert.equal(snapshot.supplier_catalog.product_ids.length,54);
  const custom=snapshot.archived_products.find(p=>p.name==='My custom product');assert.ok(custom);assert.equal(custom.current_stock,3);
  await updateProduct(db,p.id,{feed_size:'Custom size',protein_percent:29,default_rate:777,original:p});
  await applySupplierCatalog(new D1Adapter(db.connection));snapshot=await workspaceBootstrap(db);p=snapshot.products.find(row=>row.id===p.id);
  assert.equal(p.feed_size,'Custom size');assert.equal(p.protein_percent,29);assert.equal(p.default_rate,777);
 }finally{db.connection.close();}
});

test('specification edits reject invalid protein and preserve optimistic edit protection',async()=>{
 const db=database();try{
  const snapshot=await workspaceBootstrap(db),p=snapshot.products.find(p=>p.product_code==='513');
  for(const patch of [{protein_percent:-1},{protein_percent:-.001},{protein_percent:100.001},{protein_percent:101},{protein_percent:true},{feed_size:'x'.repeat(101)}])await assert.rejects(executeCommand(db,command('PATCH',`/api/products/${p.id}`,{...patch,original:p})),{status:400});
  await executeCommand(db,command('PATCH',`/api/products/${p.id}`,{protein_percent:30,feed_size:'4 mm',original:p}));
  await assert.rejects(updateProduct(db,p.id,{protein_percent:31,original:p}),{status:409});
  const current=(await workspaceBootstrap(db)).products.find(row=>row.id===p.id);await updateProduct(db,p.id,{protein_percent:'',original:current});assert.equal((await workspaceBootstrap(db)).products.find(row=>row.id===p.id).protein_percent,null);
 }finally{db.connection.close();}
});

test('a reset before or racing the first import preserves products without reimporting',async()=>{
 const db=database();try{
  await ensureSeeded(db);const before=await bootstrap(db);await resetWorkspace(db,{username:'Fixture',role:'admin'},{id:randomUUID(),workspace_epoch:0,confirmation:'RESET ALL DATA'});
  const after=await workspaceBootstrap(db);assert.deepEqual(after.products.map(p=>p.id),before.products.map(p=>p.id));assert.ok(after.products.every(p=>p.current_stock===0));assert.equal((await supplierCatalogState(db)).product_ids.length,0);
 }finally{db.connection.close();}
 const racing=database();try{
  await ensureSeeded(racing);const before=await bootstrap(racing);
  await applySupplierCatalog({prepare:racing.prepare.bind(racing),batch:async statements=>{racing.connection.exec("INSERT INTO app_meta(key,value) VALUES('workspace_epoch_v1','1')");return racing.batch(statements);}});
  assert.deepEqual((await bootstrap(racing)).products,before.products);
  await applySupplierCatalog(racing);assert.equal((await supplierCatalogState(racing)).product_ids.length,0);
 }finally{racing.connection.close();}
});
