import {allocateCents as allocate} from './money-allocation.mjs?v=percentage-half-up-2026-v1';
export {allocateCents,percentageDiscountCents} from './money-allocation.mjs?v=percentage-half-up-2026-v1';
const round=n=>Math.round((Number(n||0)+Number.EPSILON)*100)/100;
/** Reports describe events on their actual dates; the live sales ledger remains
 * net of returns for stock and outstanding balances. @param {any} snapshot */
export function journalReports(snapshot,day){
 const invoices=snapshot.invoices||[],customers=snapshot.customers||[];
 const byInvoice=new Map(invoices.map(i=>[i.id,i])),original=new Map();
 for(const inv of invoices){
  if(inv.status!=='active')continue;
  const items=inv.items||[],paid=allocate(Math.round(inv.paid_amount*100),items.map(i=>Math.round(i.line_total*100)));
  items.forEach((item,n)=>original.set(String(item.sale_id),{...item,quantity:Number(item.quantity),total_amount:Number(item.line_total),paid_amount:paid[n]/100,sale_date:inv.sale_date,customer_id:inv.customer_id,account:inv.account,invoice_id:inv.id}));
 }
 const voidLines=new Set(invoices.filter(i=>i.status==='void').flatMap(i=>(i.items||[]).map(item=>String(item.sale_id))));
 const gross=(snapshot.sales||[]).filter(s=>!voidLines.has(String(s.id))).map(s=>original.get(String(s.id))||s);
 const daily=new Map();
 const row=date=>{if(!daily.has(date))daily.set(date,{date,invoice_count:0,bags:0,sales:0,received:0,due:0,return_credit:0,refunds:0,net_sales:0,net_received:0});return daily.get(date);};
 for(const sale of gross){const r=row(sale.sale_date);r.bags+=Number(sale.quantity);r.sales+=Number(sale.total_amount);r.received+=Number(sale.paid_amount);}
 for(const inv of invoices.filter(i=>i.status==='active'))row(inv.sale_date).invoice_count++;
 if(!invoices.length)for(const sale of gross)row(sale.sale_date).invoice_count++;
 const returnJournal=[];
 for(const event of snapshot.returns||[]){
  const inv=byInvoice.get(event.invoice_id);if(!inv||inv.status!=='active')continue;
  const r=row(event.return_date);r.return_credit+=Number(event.credit);r.refunds+=Number(event.refund);
  returnJournal.push({date:event.return_date,invoice_no:inv.invoice_no,customer_id:inv.customer_id,name:inv.customer_name||customers.find(c=>c.id==inv.customer_id)?.name||'',account:inv.account,return_credit:Number(event.credit),refunds:Number(event.refund),reason:event.reason||''});
 }
 const month=new Map();
 for(const r of daily.values()){
  for(const field of ['bags','sales','received','return_credit','refunds'])r[field]=round(r[field]);
  r.due=round(r.sales-r.received);r.net_sales=round(r.sales-r.return_credit);r.net_received=round(r.received-r.refunds);
  const key=r.date.slice(0,7);if(!month.has(key))month.set(key,{month:key,bags:0,sales:0,received:0,return_credit:0,refunds:0,net_sales:0,net_received:0});
  const m=month.get(key);for(const field of ['bags','sales','received','return_credit','refunds','net_sales','net_received'])m[field]=round(m[field]+r[field]);
 }
 const customerTotals=new Map(),productTotals=new Map();
 for(const sale of snapshot.sales||[]){
  const id=String(sale.customer_id);if(!customerTotals.has(id))customerTotals.set(id,{customer_id:sale.customer_id,name:customers.find(c=>String(c.id)===id)?.name||sale.customer_name||'',purchase:0,paid:0,sale_due:0});
  const c=customerTotals.get(id);c.purchase=round(c.purchase+Number(sale.total_amount));c.paid=round(c.paid+Number(sale.paid_amount));c.sale_due=round(c.purchase-c.paid);
  const pid=String(sale.product_id);if(!productTotals.has(pid))productTotals.set(pid,{product_id:sale.product_id,name:sale.product_name||'',bags:0,amount:0});const p=productTotals.get(pid);p.bags=round(p.bags+Number(sale.quantity));p.amount=round(p.amount+Number(sale.total_amount));
 }
 const dailySales=[...daily.values()].sort((a,b)=>b.date.localeCompare(a.date));
 const current=daily.get(day);
 const collections=(snapshot.payments||[]).filter(p=>p.payment_date===day).reduce((n,p)=>n+Number(p.amount),0);
 return {reports:{daily_sales:dailySales,monthly_sales:[...month.values()].sort((a,b)=>b.month.localeCompare(a.month)),return_journal:returnJournal.sort((a,b)=>b.date.localeCompare(a.date)),customer_sales:[...customerTotals.values()].sort((a,b)=>b.purchase-a.purchase),product_sales:[...productTotals.values()].sort((a,b)=>b.amount-a.amount)},today:{total_sales_today:current?.net_sales||0,received_today:round((current?.net_received||0)+collections)}};
}
