import assert from 'node:assert/strict';
import test from 'node:test';
import {database} from './d1-adapter.mjs';
import {auditedDatabase,auditPage} from '../lib/audit.ts';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';
import {replicaStart,replicaPage,replicaBundle,replicaChanges} from '../lib/replica.ts';
import {initialReplica,pullChanges} from '../public/replica.mjs';
import {captureBackup,sha256,verifyBackup,restoreIntoEmptyDatabase,createCloudBackup,downloadCloudBackup} from '../lib/cloud-backup.ts';
import {securityHeaders,recordRequest,operationsStatus} from '../lib/operations.ts';
const user={username:'FixtureAdmin',role:'admin'};
function requester(db){return async path=>{const url=new URL(path,'https://fixture.test');if(url.pathname.endsWith('/start'))return replicaStart(db,url.searchParams.get('packed')==='1');if(url.pathname.endsWith('/bundle'))return replicaBundle(db,url);if(url.pathname.endsWith('/rows'))return replicaPage(db,url);return replicaChanges(db,url);};}

test('verified actor and exact before/after are atomic, immutable and retry-safe',async()=>{
 const db=database();try{
  const base=await workspaceBootstrap(db),customer=base.customers[0],op={id:'audit-payment-001',workspace_epoch:0,method:'POST',path:'/api/payments',payload:{payment_date:'2026-10-23',customer_id:customer.id,amount:100,account:'Cash',actor:'Spoofed'}};
  const scoped=auditedDatabase(db,user,op.id);
  await executeCommand(scoped,op);await executeCommand(scoped,op);
  const events=(await db.prepare("SELECT * FROM audit_events WHERE operation_id=?").bind(op.id).all()).results;
  assert.equal(events.length,1);assert.equal(events[0].actor,user.username);assert.equal(events[0].before_json,null);assert.equal(JSON.parse(events[0].after_json).amount,100);
  const payment=JSON.parse(events[0].after_json);await auditedDatabase(db,{username:'FixtureStaff',role:'general'},'edit-payment-001').prepare('UPDATE customer_payments SET amount=90 WHERE id=?').bind(payment.id).run();
  const edited=await db.prepare("SELECT * FROM audit_events WHERE operation_id='edit-payment-001'").first();assert.equal(JSON.parse(edited.before_json).amount,100);assert.equal(JSON.parse(edited.after_json).amount,90);
  const n=(await db.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n;
  await assert.rejects(scoped.batch([scoped.prepare('UPDATE customer_payments SET amount=50 WHERE id=?').bind(payment.id),scoped.prepare('INSERT INTO app_meta(key,value) VALUES (?,NULL)').bind('fail')]));
  assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM audit_events').first()).n,n);
  assert.equal((await db.prepare('SELECT amount FROM customer_payments').first()).amount,90);
  await assert.rejects(db.prepare('DELETE FROM audit_events').run(),/append-only/);
  await assert.rejects(db.prepare("UPDATE audit_events SET actor='fake'").run(),/append-only/);
  assert.ok((await auditPage(db,new URL('https://fixture.test?actor=FixtureStaff'))).rows.every(r=>r.actor==='FixtureStaff'));
 }finally{db.connection.close();}
});

test('5,000 sales: bounded initial pages, tiny incremental response and convergent changes',async()=>{
 const db=database();try{
  const base=await workspaceBootstrap(db),product=base.products[0],customer=base.customers[0];
  await db.prepare('UPDATE products SET opening_stock=10000 WHERE id=?').bind(product.id).run();
  const insert=db.connection.prepare('INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account,notes) VALUES (?,?,?,?,?,?,?,?,?)');
  db.connection.exec('BEGIN');for(let i=0;i<5000;i++)insert.run('2026-10-23',customer.id,product.id,1,100,100,50,'Cash','Fixture sale '+i+' '+'.'.repeat(100));db.connection.exec('COMMIT');
  const full=await workspaceBootstrap(db),sizes=[];let active=0,maxActive=0;const raw=requester(db),request=async path=>{active++;maxActive=Math.max(maxActive,active);try{const result=await raw(path);sizes.push(Buffer.byteLength(JSON.stringify(result)));return result;}finally{active--;}};
  let replica=await initialReplica(request,user);assert.equal(replica.sales.length,5000);assert.equal(replica.invoices.length,5000);assert.equal(replica.invoices.reduce((n,i)=>n+i.items.length,0),5000);
  assert.ok(Math.max(...sizes)<128*1024);assert.ok(sizes.length>60);assert.ok(maxActive>=2&&maxActive<=4);
  const idle=await raw(`/api/replica/changes?after=${replica.sync_revision}&epoch=0`);assert.equal(idle.changes.length,0);assert.ok(Buffer.byteLength(JSON.stringify(idle))<500);
  const op={id:'performance-payment-001',workspace_epoch:0,method:'POST',path:'/api/payments',payload:{payment_date:'2026-10-23',customer_id:customer.id,amount:100,account:'Cash'}};
  await executeCommand(auditedDatabase(db,user,op.id),op);
  const delta=await raw(`/api/replica/changes?after=${replica.sync_revision}&epoch=0`);assert.equal(delta.changes.length,1);assert.ok(Buffer.byteLength(JSON.stringify(delta))<2000);
  replica=await pullChanges(replica,raw);assert.equal(replica.payments.at(-1).amount,100);
  const id=replica.payments[0].id;await auditedDatabase(db,user,'delete-payment-001').prepare('DELETE FROM customer_payments WHERE id=?').bind(id).run();replica=await pullChanges(replica,raw);assert.equal(replica.payments.length,0);
  console.log(JSON.stringify({benchmark:'5000-sales',legacy_snapshot_bytes:Buffer.byteLength(JSON.stringify(full)),largest_page_bytes:Math.max(...sizes),pages:sizes.length,idle_bytes:Buffer.byteLength(JSON.stringify(idle)),one_payment_delta_bytes:Buffer.byteLength(JSON.stringify(delta))}));
  // Writes between keyset pages are reconciled, including inserts behind a cursor.
  let changed=false;const racing=await initialReplica(async path=>{const result=await raw(path);if(!changed&&(path.includes('entity=products')||path.includes('start?packed'))){changed=true;await db.prepare('UPDATE products SET default_rate=123 WHERE id=?').bind(product.id).run();}return result;},user);assert.equal([...racing.products,...racing.archived_products].find(p=>p.id===product.id).default_rate,123);
  await db.prepare("INSERT OR REPLACE INTO app_meta(key,value) VALUES ('workspace_epoch_v1','1')").run();await assert.rejects(pullChanges(replica,raw),/Workspace changed/);
 }finally{db.connection.close();}
});

test('private cloud backup roundtrip, checksum failure and isolated restore preserve every business row',async()=>{
 const db=database(),restored=database();try{
  const base=await workspaceBootstrap(db),op={id:'backup-payment-001',workspace_epoch:0,method:'POST',path:'/api/payments',payload:{payment_date:'2026-10-23',customer_id:base.customers[0].id,amount:100,account:'Cash'}};
  await executeCommand(auditedDatabase(db,user,op.id),op);
  const objects=new Map(),bucket={put:async(k,v)=>objects.set(k,v),get:async k=>objects.has(k)?{text:async()=>objects.get(k)}:null};
  const saved=await createCloudBackup(db,bucket,user),download=await downloadCloudBackup(db,bucket,saved.id),backup=await verifyBackup(download.text,saved.sha256);
  assert.ok(!download.text.includes('app_sessions'));assert.ok(!download.text.includes('PASSWORD_RECORD'));
  await assert.rejects(verifyBackup(download.text+' ',saved.sha256),/checksum/);
  await restoreIntoEmptyDatabase(restored,backup);
  const copy=await captureBackup(restored,'drill');assert.deepEqual(copy.tables,backup.tables);
  assert.deepEqual(copy.audit.slice(0,backup.audit.length),backup.audit);
  const replay=await executeCommand(auditedDatabase(restored,user,op.id),op);assert.equal(replay.replayed,true);assert.equal((await restored.prepare('SELECT COUNT(*) AS n FROM customer_payments').first()).n,1);
  const before=await workspaceBootstrap(db),after=await workspaceBootstrap(restored);assert.deepEqual(after.dashboard,before.dashboard);assert.deepEqual(after.reports,before.reports);
  await assert.rejects(restoreIntoEmptyDatabase(db,backup),/empty isolated/);
  objects.set('workspace/v1/'+saved.id+'.json','corrupt');await assert.rejects(downloadCloudBackup(db,bucket,saved.id),/checksum/);
  assert.equal(await sha256(download.text),saved.sha256);
 }finally{db.connection.close();restored.connection.close();}
});

test('monitoring aggregates routes without customer data; security headers protect responses',async()=>{
 const db=database();try{
  const request=new Request('https://fixture.test/api/invoices/private-customer?secret=hidden');
  await recordRequest(db,request,200,11);await recordRequest(db,request,500,20);
  const status=await operationsStatus(db,true);assert.equal(status.metrics.length,2);assert.ok(status.metrics.every(row=>row.route==='/api/invoices'));assert.ok(!JSON.stringify(status).includes('private-customer'));
  const response=securityHeaders(request,Response.json({ok:true}));assert.equal(response.headers.get('X-Frame-Options'),'DENY');assert.ok(response.headers.get('Strict-Transport-Security'));assert.match(response.headers.get('Content-Security-Policy'),/object-src 'none'/);
 }finally{db.connection.close();}
});


test('restore stock funded by adjustment credits before sales and damage debits',async()=>{
 const db=database(),restored=database();try{
  const base=await workspaceBootstrap(db),product=base.products[0],customer=base.customers[0];
  const scoped=auditedDatabase(db,user,'restore-stock-regression');
  await executeCommand(scoped,{id:'restore-stock-credit',workspace_epoch:0,method:'POST',path:'/api/adjustments',payload:{adjust_date:'2026-10-23',product_id:product.id,type:'Manual Add',quantity:10,confirmed:true}});
  await executeCommand(scoped,{id:'restore-stock-sale',workspace_epoch:0,method:'POST',path:'/api/invoices',payload:{id:'restore-stock-invoice',sale_date:'2026-10-23',customer_id:customer.id,items:[{product_id:product.id,quantity:6,rate:100}],paid_amount:100,account:'Cash'}});
  await executeCommand(scoped,{id:'restore-stock-damage',workspace_epoch:0,method:'POST',path:'/api/adjustments',payload:{adjust_date:'2026-10-23',product_id:product.id,type:'Damage',quantity:1,confirmed:true}});
  const backup=await captureBackup(db,user.username);await restoreIntoEmptyDatabase(restored,backup);
  assert.deepEqual((await captureBackup(restored,'drill')).tables,backup.tables);
  assert.equal((await restored.prepare('SELECT available FROM inventory_guard_stock WHERE id=?').bind(product.id).first()).available,3);
 }finally{db.connection.close();restored.connection.close();}
});


test('legacy negative stock requires explicit isolated recovery and keeps sale guards intact',async()=>{
 const db=database(),restored=database();try{
  const base=await workspaceBootstrap(db),product=base.products[0],customer=base.customers[0];
  const guard=await db.prepare("SELECT sql FROM sqlite_schema WHERE name='guard_sale_stock_insert'").first();
  db.connection.exec('DROP TRIGGER guard_sale_stock_insert');
  await db.prepare('INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account) VALUES (?,?,?,?,?,?,?,?)').bind('2026-10-23',customer.id,product.id,2,100,200,0,'Cash').run();
  db.connection.exec(guard.sql);await workspaceBootstrap(db);
  const backup=await captureBackup(db,user.username);
  await assert.rejects(restoreIntoEmptyDatabase(restored,backup),/historical negative stock/);
  const result=await restoreIntoEmptyDatabase(restored,backup,{preserveLegacyStock:true});
  assert.deepEqual(result.historical_negative_stock,[{product_id:product.id,available:-2}]);
  assert.deepEqual((await captureBackup(restored,'drill')).tables,backup.tables);
  await assert.rejects(restored.prepare('INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account) VALUES (?,?,?,?,?,?,?,?)').bind('2026-10-23',customer.id,product.id,1,100,100,0,'Cash').run(),/insufficient_stock/);
  assert.equal((await restored.prepare("SELECT sql FROM sqlite_schema WHERE name='guard_sale_stock_insert'").first()).sql,guard.sql);
 }finally{db.connection.close();restored.connection.close();}
});


test('small initial replica is packed without an entity-by-entity waterfall',async()=>{
 const db=database();try{
  await workspaceBootstrap(db);const calls=[],raw=requester(db);
  const replica=await initialReplica(async path=>{calls.push(path);return raw(path);},user);
  assert.equal(calls.length,2);assert.equal(calls[0],'/api/replica/start?packed=1');assert.ok(calls[1].includes('/changes?'));assert.equal(replica.products.length,54);
  const page=await replicaStart(db,true);assert.ok(Buffer.byteLength(JSON.stringify(page))<128*1024);assert.equal(page.initial_page.done,true);
  await assert.rejects(replicaBundle(db,new URL('https://fixture.test?index=100')),/cursor/);
  await assert.rejects(replicaBundle(db,new URL('https://fixture.test?epoch=1')),/Workspace changed/);
 }finally{db.connection.close();}
});

test('ready startup uses two read batches and still initializes after reset or a legacy sale',async()=>{
 const db=database();try{
  await replicaStart(db,true);let batches=0;
  const counted=new Proxy(db,{get(target,name){if(name==='batch')return async statements=>{batches++;return target.batch(statements);};const value=Reflect.get(target,name);return typeof value==='function'?value.bind(target):value;}});
  await replicaStart(counted,true);assert.equal(batches,2);
  await db.prepare("DELETE FROM app_meta WHERE key='business_settings_v1'").run();
  assert.equal((await replicaStart(db,true)).settings.name,'Arafat Traders');
  const base=await workspaceBootstrap(db),product=base.products[0],customer=base.customers[0];
  await db.prepare('UPDATE products SET opening_stock=10 WHERE id=?').bind(product.id).run();
  const sale=await db.prepare('INSERT INTO sales(sale_date,customer_id,product_id,quantity,rate,total_amount,paid_amount,account) VALUES (?,?,?,?,?,?,?,?)').bind('2026-10-23',customer.id,product.id,1,100,100,0,'Cash').run();
  const initial=await replicaStart(db,true);
  assert.ok(initial.initial_page.groups.find(group=>group.entity==='invoices').rows.some(row=>row.id==='legacy-'+sale.meta.last_row_id));
 }finally{db.connection.close();}
});

test('large UTF-8 notes survive initial/bundle/row sync, incremental edits and audit paging',async()=>{
 const db=database();try{
  const base=await workspaceBootstrap(db),product=base.products[0],customer=base.customers[0];
  await db.prepare('UPDATE products SET opening_stock=50 WHERE id=?').bind(product.id).run();
  const notes='বাংলা নোট 🌾 "quoted"\n'.repeat(6000).trim();
  const op={id:'large-note-sale-operation',method:'POST',path:'/api/invoices',workspace_epoch:0,payload:{id:'large-note-invoice-001',sale_date:'2026-10-24',customer_id:customer.id,items:[{product_id:product.id,quantity:2,rate:100}],notes,paid_amount:50,account:'Cash'}};
  assert.ok(Buffer.byteLength(JSON.stringify(op))<1024*1024);assert.ok(Buffer.byteLength(notes)>128*1024);
  await executeCommand(auditedDatabase(db,user,op.id),op);
  const raw=requester(db),pages=[];
  let replica=await initialReplica(async path=>{const page=await raw(path);pages.push(page);return page;},user);
  assert.equal(replica.invoices.find(i=>i.id===op.payload.id).notes,notes);assert.equal(replica.sales[0].notes,notes);
  for(const page of pages)if(Buffer.byteLength(JSON.stringify(page))>128*1024){
   const rows=page.rows||page.changes||page.initial_page?.groups.flatMap(group=>group.rows)||[];
   assert.equal(rows.length,1,'large records must be isolated on one page');
  }
  const nextNotes=notes+'edited';
  await executeCommand(auditedDatabase(db,user,'large-note-edit-operation'),{...op,id:'large-note-edit-operation',method:'PATCH',path:'/api/invoices/'+op.payload.id,payload:{...op.payload,notes:nextNotes,expected_version:1}});
  replica=await pullChanges(replica,raw);assert.equal(replica.invoices.find(i=>i.id===op.payload.id).notes,nextNotes);
  const payments=await executeCommand(auditedDatabase(db,user,'large-note-next-payment'),{id:'large-note-next-payment',method:'POST',path:'/api/payments',workspace_epoch:0,payload:{customer_id:customer.id,payment_date:'2026-10-24',amount:25,account:'Cash'}});
  assert.ok(payments.id);replica=await pullChanges(replica,raw);assert.equal(replica.payments[0].amount,25);
  const audit=await auditPage(db,new URL('https://fixture.test?entity=invoices'));assert.ok(audit.rows.length);assert.ok(audit.rows[0].after_json.includes('edited'));
 }finally{db.connection.close();}
});
