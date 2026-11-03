import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database,D1Adapter} from './d1-adapter.mjs';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';
import {bootstrap,deleteRecord,insertRecord,ensureSeeded} from '../lib/ledger.ts';
import {reserveLoginAttempt} from '../lib/login-limiter.ts';
import {journalReports,allocateCents} from '../public/report-journal.mjs';
const command=(method,path,payload)=>({id:randomUUID(),method,path,payload,created_at:Date.now()});
const txn=(type,amount,account='Cash')=>({txn_date:'2026-10-23',type,amount,account});

test('a transfer conserves total funds, replays once and deletes both sides from either row',async()=>{
 for(const side of ['Cash','Bank']){
  const db=database();try{
   await workspaceBootstrap(db);await insertRecord(db,'transactions',txn('Other Income',1000));
   const transfer=command('POST','/api/transactions',txn('Bank Deposit',100));
   await executeCommand(db,transfer);await executeCommand(db,transfer);
   let s=await workspaceBootstrap(db);
   assert.equal(s.dashboard.cash_balance,900);assert.equal(s.dashboard.bank_balance,100);
   const pair=s.transactions.filter(t=>t.transfer_id===transfer.id);assert.equal(pair.length,2);
   assert.deepEqual(pair.map(r=>r.account).sort(),['Bank','Cash']);
   const withdraw=command('POST','/api/transactions',txn('Bank Withdraw',25));
   await executeCommand(db,withdraw);s=await workspaceBootstrap(db);
   assert.equal(s.dashboard.cash_balance,925);assert.equal(s.dashboard.bank_balance,75);
   const row=s.transactions.find(t=>t.transfer_id===transfer.id&&t.account===side);
   await executeCommand(db,command('DELETE',`/api/transactions/${row.id}`,{original:row,confirmed:true}));
   s=await workspaceBootstrap(db);assert.equal(s.transactions.filter(t=>t.transfer_id===transfer.id).length,0);
   assert.equal(s.dashboard.cash_balance+s.dashboard.bank_balance,1000);
   const remaining=s.transactions.find(t=>t.transfer_id===withdraw.id&&t.account===side);
   await deleteRecord(db,'transactions',remaining.id);s=await workspaceBootstrap(db);
   assert.equal(s.transactions.length,1);assert.equal(s.dashboard.cash_balance,1000);assert.equal(s.dashboard.bank_balance,0);
  }finally{db.connection.close();}
 }
});

test('a failed counterpart rolls back the debit and operation marker together',async()=>{
 const db=database();try{
  await workspaceBootstrap(db);await insertRecord(db,'transactions',txn('Other Income',1000));
  db.connection.exec("CREATE TRIGGER fail_transfer BEFORE INSERT ON transactions WHEN NEW.account='Bank' BEGIN SELECT RAISE(ABORT,'fixture counterpart failure'); END");
  const transfer=command('POST','/api/transactions',txn('Bank Deposit',100));
  await assert.rejects(executeCommand(db,transfer),/counterpart failure/);
  const s=await workspaceBootstrap(db);assert.equal(s.dashboard.cash_balance,1000);assert.equal(s.transactions.length,1);
  assert.equal(db.connection.prepare('SELECT id FROM sync_operations WHERE id=?').get(transfer.id),undefined);
 }finally{db.connection.close();}
});

test('old unpaired transfers are repaired once without duplicating already balanced imports',async()=>{
 const db=database();try{
  await ensureSeeded(db);db.connection.exec("DELETE FROM app_meta WHERE key='balanced_transfers_v1'");
  const put=db.connection.prepare('INSERT INTO transactions(txn_date,type,amount,account) VALUES (?,?,?,?)');
  put.run('2026-10-22','Bank Deposit',100,'Cash');
  put.run('2026-10-22','Bank Withdraw',25,'Bank');put.run('2026-10-22','Bank Withdraw',25,'Cash');
  await ensureSeeded(new D1Adapter(db.connection));
  let s=await bootstrap(db);assert.equal(s.transactions.length,4);
  assert.equal(s.dashboard.cash_balance,-75);assert.equal(s.dashboard.bank_balance,75);
  await ensureSeeded(new D1Adapter(db.connection));s=await bootstrap(db);assert.equal(s.transactions.length,4);
 }finally{db.connection.close();}
});

test('a lost payment response reconciles by operation ID and never collects twice',async()=>{
 const db=database();try{
  const s=await workspaceBootstrap(db),op=command('POST','/api/payments',{payment_date:'2026-10-23',customer_id:s.customers[0].id,amount:100,account:'Cash'});
  await executeCommand(db,op); // The client never receives this response.
  assert.equal((await executeCommand(db,structuredClone(op))).replayed,true);
  const after=await workspaceBootstrap(db);assert.equal(after.payments.length,1);assert.equal(after.dashboard.cash_balance,100);
  await assert.rejects(executeCommand(db,{...op,payload:{...op.payload,amount:101}}),{status:409});
 }finally{db.connection.close();}
});

test('40 concurrent login reservations share an atomic budget across database clients',async()=>{
 const db=database();try{
  const now=Date.now(),other=new D1Adapter(db.connection);
  const result=await Promise.allSettled(Array.from({length:40},(_,i)=>reserveLoginAttempt(i%2?db:other,'fixture-ip',now)));
  assert.equal(result.filter(r=>r.status==='fulfilled').length,10);
  assert.equal(result.filter(r=>r.status==='rejected'&&r.reason.status===429).length,30);
  await assert.rejects(reserveLoginAttempt(new D1Adapter(db.connection),'fixture-ip',now+59999),{status:429});
  assert.ok(await reserveLoginAttempt(other,'fixture-ip',now+60000));
  assert.ok(await reserveLoginAttempt(other,'different-ip',now));
 }finally{db.connection.close();}
});

function offlineTools(){
 let source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8');
 source=source.replace('let journalReports=null,shares=null','let journalReports=testJournal,shares=testShares');
 source=source.replace('window.WorkspaceStore={','window.Check={apply,recalculate,setData:d=>data=d};window.WorkspaceStore={');
 const context=vm.createContext({testJournal:journalReports,testShares:allocateCents,window:{addEventListener(){},dispatchEvent(){}},navigator:{},localStorage:{getItem(){return null}},structuredClone,Intl,setInterval(){}});
 vm.runInContext(source,context);return context.window.Check;
}

test('a later return keeps the original sales day and month immutable and journals its refund',async()=>{
 const db=database();try{
  let s=await workspaceBootstrap(db);const p=s.products[0],customer=s.customers[0];
  db.connection.prepare('UPDATE products SET opening_stock=5 WHERE id=?').run(p.id);
  const invoice={id:randomUUID(),sale_date:'2026-10-31',customer_id:customer.id,items:[{product_id:p.id,quantity:2,rate:100}],paid_amount:200,account:'Cash'};
  await executeCommand(db,command('POST','/api/invoices',invoice));s=await workspaceBootstrap(db);
  const original=structuredClone(s.reports.daily_sales.find(r=>r.date==='2026-10-31'));
  const inv=s.invoices[0];const returnCommand=command('POST',`/api/invoices/${inv.id}/return`,{expected_version:inv.version,return_date:'2026-11-01',confirmed:true,reason:'Later return',items:[{id:inv.items[0].id,quantity:1}]});
  const local=structuredClone(s),tools=offlineTools();tools.apply(local,returnCommand);tools.recalculate(local);
  await executeCommand(db,returnCommand);const after=await workspaceBootstrap(db);
  assert.deepEqual(after.reports.daily_sales.find(r=>r.date==='2026-10-31'),original);
  const later=after.reports.daily_sales.find(r=>r.date==='2026-11-01');
  assert.equal(later.sales,0);assert.equal(later.received,0);assert.equal(later.return_credit,100);assert.equal(later.refunds,100);assert.equal(later.net_sales,-100);assert.equal(later.net_received,-100);
  assert.equal(after.reports.monthly_sales.find(r=>r.month==='2026-10').sales,200);
  assert.equal(after.reports.monthly_sales.find(r=>r.month==='2026-11').refunds,100);
  assert.equal(after.reports.return_journal[0].date,'2026-11-01');
  assert.equal(after.dashboard.cash_balance,100);assert.equal(after.products.find(r=>r.id===p.id).current_stock,4);
  assert.deepEqual(JSON.parse(JSON.stringify(local.reports.daily_sales)),after.reports.daily_sales);
 }finally{db.connection.close();}
});

test('offline customer reports keep identical names separate by ID and agree with server reports',async()=>{
 const db=database();try{
  let s=await workspaceBootstrap(db);const p=s.products[0];db.connection.prepare('UPDATE products SET opening_stock=5 WHERE id=?').run(p.id);
  for(const amount of [100,250]){
   const created=await executeCommand(db,command('POST','/api/customers',{name:'Same customer name'}));
   await executeCommand(db,command('POST','/api/invoices',{id:randomUUID(),sale_date:'2026-10-23',customer_id:created.id,items:[{product_id:p.id,quantity:1,rate:amount}],paid_amount:0,account:'Cash'}));
  }
  s=await workspaceBootstrap(db);const local=structuredClone(s),tools=offlineTools();tools.recalculate(local);
  assert.equal(local.reports.customer_sales.length,2);assert.deepEqual(local.reports.customer_sales.map(r=>r.purchase).sort((a,b)=>a-b),[100,250]);
  assert.equal(new Set(local.reports.customer_sales.map(r=>r.customer_id)).size,2);
  assert.deepEqual(JSON.parse(JSON.stringify(local.reports.customer_sales)),s.reports.customer_sales);
  tools.apply(local,{...command('POST','/api/transactions',txn('Bank Deposit',100)),temp_id:-1});tools.recalculate(local);
  assert.equal(local.dashboard.cash_balance,-100);assert.equal(local.dashboard.bank_balance,100);
 }finally{db.connection.close();}
});
