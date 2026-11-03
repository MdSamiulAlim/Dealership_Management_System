import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';
import {allocateCents} from '../public/money-allocation.mjs';import {invoiceAmounts} from '../lib/workspace.ts';
const cases=JSON.parse(readFileSync(new URL('./fixtures/allocation-cases.json',import.meta.url)));
for(const c of cases)test(`exact allocation ${c.total} cents`,()=>{assert.deepEqual(allocateCents(c.total,c.weights),c.expected);assert.equal(c.expected.reduce((a,b)=>a+b,0),c.total);});
test('111 invoice / 37 payment ties award the first item, independent of magnitude',()=>{
 const a=invoiceAmounts({items:[1,10,100].map(rate=>({product_id:1,quantity:1,rate})),paid_amount:37});
 assert.deepEqual(a.items.map(i=>i.paid_amount),[.34,3.33,33.33]);assert.equal(a.total_amount,111);
});
test('invoice limits reject invalid or oversized arithmetic before allocation',()=>{
 for(const p of [{items:[{product_id:1,quantity:1e12,rate:1e12}]},{items:[{product_id:1,quantity:1,rate:1e12},{product_id:1,quantity:1,rate:1e12}]}])assert.throws(()=>invoiceAmounts(p));
 assert.deepEqual(invoiceAmounts({items:[{product_id:1,quantity:1,rate:5e11},{product_id:1,quantity:1,rate:5e11}],paid_amount:1e12}).items.map(i=>i.paid_amount),[5e11,5e11]);
});
