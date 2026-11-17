import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import * as exact from '../public/money-allocation.mjs';
import {invoiceAmounts,workspaceBootstrap,executeCommand,getInvoice} from '../lib/workspace.ts';
import {database} from './d1-adapter.mjs';

const cases=JSON.parse(readFileSync(new URL('fixtures/percentage-cases.json',import.meta.url)));
let source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8');
source=source.replace(/let journalReports=null,shares=null(?:,percentageDiscount=null)?;/,'let journalReports=null,shares=testShares,percentageDiscount=testPercentage;')
  .replace('window.WorkspaceStore={','window.DiscountTest={amounts};window.WorkspaceStore={');
const context=vm.createContext({testShares:exact.allocateCents,testPercentage:exact.percentageDiscountCents,window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},structuredClone,Intl,setInterval(){}});
vm.runInContext(source,context);

for(const c of cases)for(const [kind,amounts] of [['server',invoiceAmounts],['browser/offline',context.window.DiscountTest.amounts]])test(`${kind}: ${c.rates.join('+')} at ${c.percent}% rounds half up`,()=>{
  const result=amounts({items:c.rates.map(rate=>({product_id:1,quantity:1,rate})),discount_type:'percent',discount_value:c.percent,paid_amount:0});
  assert.equal(result.discount,c.discount_cents/100);
  assert.equal(result.total_amount,c.total_cents/100);
  assert.equal(result.items.reduce((n,item)=>n+Math.round(item.line_total*100),0),c.total_cents);
});
test('saved percentage invoice, exact replay and edits use the corrected paisa throughout the ledger',async()=>{
  const db=database();try{
    const base=await workspaceBootstrap(db),product=base.products[0];
    db.connection.prepare('UPDATE products SET opening_stock=2 WHERE id=?').run(product.id);
    const payload={id:randomUUID(),sale_date:'2026-11-17',customer_id:base.customers[0].id,items:[{product_id:product.id,quantity:1,rate:50}],discount_type:'percent',discount_value:0.57,paid_amount:37,account:'Cash'};
    const command={id:randomUUID(),method:'POST',path:'/api/invoices',payload};
    await executeCommand(db,command);assert.equal((await executeCommand(db,command)).replayed,true);
    let invoice=await getInvoice(db,payload.id);assert.equal(invoice.discount,.29);assert.equal(invoice.total_amount,49.71);assert.equal(invoice.items[0].line_total,49.71);
    const data=await workspaceBootstrap(db);assert.equal(data.sales[0].total_amount,49.71);assert.equal(data.customers[0].current_due,12.71);assert.equal(data.dashboard.cash_balance,37);
    await executeCommand(db,{id:randomUUID(),method:'PATCH',path:`/api/invoices/${payload.id}`,payload:{...payload,expected_version:invoice.version}});
    invoice=await getInvoice(db,payload.id);assert.equal(invoice.discount,.29);assert.equal(invoice.total_amount,49.71);
  }finally{db.connection.close();}
});
test('percentage bounds are rejected even on a zero-value invoice',()=>{
  const payload={items:[{product_id:1,quantity:1,rate:0}],discount_type:'percent',discount_value:101,paid_amount:0};
  assert.throws(()=>invoiceAmounts(payload),{status:400});
  assert.throws(()=>context.window.DiscountTest.amounts(payload),/discount/i);
  for(const value of [-1,1.5,10001,NaN])assert.throws(()=>exact.percentageDiscountCents(5000,value),/percentage/i);
});
