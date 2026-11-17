import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {database} from './d1-adapter.mjs';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';

const command = (method,path,payload) => ({id:randomUUID(),method,path,payload});
async function fixture() {
  const db=database(), data=await workspaceBootstrap(db);
  const product=data.products[0];
  db.connection.prepare('UPDATE products SET opening_stock=20 WHERE id=?').run(product.id);
  return {db,product};
}
async function create(f,entity,payload) {
  const result=await executeCommand(f.db,command('POST',`/api/${entity}`,payload));
  return (await workspaceBootstrap(f.db))[entity].find(r=>String(r.id)===String(result.id));
}
test('order edit recalculates stock/payable, replays once and rejects stale or invalid changes',async()=>{
  const f=await fixture();try {
    const row=await create(f,'orders',{product_id:f.product.id,order_date:'2026-11-16',quantity:5,bag_weight:25,rate:100,status:'Delivered'});
    const edit=command('PATCH',`/api/orders/${row.id}`,{...row,quantity:8,rate:150,total_amount:1200,original:row,confirmed:true});
    await executeCommand(f.db,edit);assert.equal((await executeCommand(f.db,edit)).replayed,true);
    let data=await workspaceBootstrap(f.db);assert.equal(data.products.find(p=>p.id===f.product.id).current_stock,28);assert.equal(data.dashboard.company_payable,1200);
    await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...edit.payload,notes:'Stale device'})),{status:409});
    const latest=data.orders[0];
    for(const changes of [{quantity:1.5},{rate:-1},{order_date:'2026-02-30'},{total_amount:1}]) await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...latest,...changes,original:latest,confirmed:true})),{status:400});
    data=await workspaceBootstrap(f.db);assert.equal(data.orders[0].total_amount,1200);
  }finally{f.db.connection.close();}
});
test('adjustment edits reverse the old effect and atomically block insufficient stock on either product',async()=>{
  const f=await fixture();try {
    const original=await create(f,'adjustments',{product_id:f.product.id,adjust_date:'2026-11-16',quantity:5,type:'Manual Add',notes:'Count',confirmed:true});
    const edit=command('PATCH',`/api/adjustments/${original.id}`,{...original,quantity:4,type:'Manual Minus',notes:'Corrected count',original,confirmed:true});
    await executeCommand(f.db,edit);
    let data=await workspaceBootstrap(f.db);assert.equal(data.products.find(p=>p.id===f.product.id).current_stock,16);
    const latest=data.adjustments[0],other=data.products[1];
    await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...latest,product_id:other.id,quantity:1,original:latest,confirmed:true})),{status:409});
    await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...latest,quantity:21,original:latest,confirmed:true})),{status:409});
    data=await workspaceBootstrap(f.db);assert.equal(data.adjustments[0].quantity,4);assert.equal(data.products.find(p=>p.id===f.product.id).current_stock,16);
    await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...latest,quantity:1,original:latest})),/Confirm/);
  }finally{f.db.connection.close();}
});
test('Cash/Bank transfer edits update both entries and preserve total balance with safe retry',async()=>{
  const f=await fixture();try {
    await create(f,'transactions',{txn_date:'2026-11-16',type:'Other Income',amount:1000,account:'Cash'});
    const original=await create(f,'transactions',{txn_date:'2026-11-16',type:'Bank Deposit',amount:100,account:'Cash'});
    const before=await workspaceBootstrap(f.db),partner=before.transactions.find(t=>t.transfer_id===original.transfer_id&&t.id!==original.id);
    const edit=command('PATCH',`/api/transactions/${original.id}`,{txn_date:'2026-11-15',type:'Bank Deposit',amount:250,account:original.account,notes:'Correct transfer',original,original_transfer:partner,confirmed:true});
    await executeCommand(f.db,edit);await executeCommand(f.db,edit);
    const after=await workspaceBootstrap(f.db),pair=after.transactions.filter(t=>t.transfer_id===original.transfer_id);
    assert.equal(pair.length,2);assert.ok(pair.every(t=>t.amount===250&&t.txn_date==='2026-11-15'&&t.notes==='Correct transfer'));
    assert.equal(after.dashboard.cash_balance,750);assert.equal(after.dashboard.bank_balance,250);
    await assert.rejects(executeCommand(f.db,command('PATCH',edit.path,{...edit.payload,amount:1})),{status:409});
  }finally{f.db.connection.close();}
});
test('a stale transfer counterpart or failure on the second side changes neither entry',async()=>{
  const f=await fixture();try {
    const original=await create(f,'transactions',{txn_date:'2026-11-16',type:'Bank Deposit',amount:100,account:'Cash'});
    let data=await workspaceBootstrap(f.db),partner=data.transactions.find(t=>t.transfer_id===original.transfer_id&&t.id!==original.id);
    const payload={...original,amount:200,original,original_transfer:partner,confirmed:true};
    await assert.rejects(executeCommand(f.db,command('PATCH',`/api/transactions/${original.id}`,{...payload,original_transfer:original})),{status:409});
    f.db.connection.prepare('UPDATE transactions SET notes=? WHERE id=?').run('Another device',partner.id);
    await assert.rejects(executeCommand(f.db,command('PATCH',`/api/transactions/${original.id}`,payload)),{status:409});
    data=await workspaceBootstrap(f.db);assert.ok(data.transactions.every(t=>t.amount===100));
    partner=data.transactions.find(t=>t.id===partner.id);
    f.db.connection.exec(`CREATE TRIGGER reject_transfer_update BEFORE UPDATE ON transactions WHEN NEW.id=${partner.id} AND NEW.amount=200 BEGIN SELECT RAISE(ABORT,'fixture rejection'); END;`);
    await assert.rejects(executeCommand(f.db,command('PATCH',`/api/transactions/${original.id}`,{...payload,original_transfer:partner})),/fixture rejection/);
    assert.ok((await workspaceBootstrap(f.db)).transactions.every(t=>t.amount===100));
  }finally{f.db.connection.close();}
});
test('company payments and other income are editable without introducing unbalanced transfers',async()=>{
  const f=await fixture();try {
    for(const type of ['Company Payment','Other Income','Other Expense']){
      const original=await create(f,'transactions',{txn_date:'2026-11-16',type,amount:10,account:'Cash'});
      await executeCommand(f.db,command('PATCH',`/api/transactions/${original.id}`,{...original,amount:25,account:'Bank',original}));
      const row=(await workspaceBootstrap(f.db)).transactions.find(t=>t.id===original.id);
      assert.equal(row.amount,25);assert.equal(row.account,'Bank');
      await assert.rejects(executeCommand(f.db,command('PATCH',`/api/transactions/${row.id}`,{...row,type:'Bank Deposit',original:row,confirmed:true})),/new transfer/);
    }
  }finally{f.db.connection.close();}
});
