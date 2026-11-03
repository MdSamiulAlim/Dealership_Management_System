// Shared by browser, server receipts and ledger tests. All arithmetic is cents.
const cents=value=>Math.round((Number(value||0)+Number.EPSILON)*100);
const same=(a,b)=>String(a)===String(b);
export function customerDueStatement(customer,invoices=[],payments=[],returns=[],generatedAt=new Date().toISOString()) {
  if(!customer)throw Error('Customer not found. Refresh and try again.');
  const bills=invoices.filter(i=>same(i.customer_id,customer.id));
  const active=bills.filter(i=>i.status!=='void');
  const ids=new Set(active.map(i=>String(i.id)));
  const collections=payments.filter(p=>same(p.customer_id,customer.id));
  const credits=returns.filter(r=>ids.has(String(r.invoice_id)));
  const sum=(rows,fn)=>rows.reduce((total,row)=>total+cents(fn(row)),0);
  const opening=cents(customer.opening_due);
  const netSales=sum(active,i=>Number(i.total_amount)-Number(i.returned_total||0));
  const salePaid=sum(active,i=>Number(i.paid_amount)-Number(i.refunded||0));
  const received=sum(collections,p=>p.amount);
  const balance=opening+netSales-salePaid-received;
  const entries=active.map(i=>({kind:'invoice',id:i.id,invoice_id:i.id,date:i.sale_date,created_at:i.created_at||'',reference:i.invoice_no,debit:cents(i.total_amount),credit:cents(i.paid_amount),account:i.account,notes:i.notes||'',pending:!!i.pending}));
  for(const r of credits){const invoice=active.find(i=>same(i.id,r.invoice_id));entries.push({kind:'return',id:r.id,invoice_id:r.invoice_id,date:r.return_date,created_at:r.created_at||'',reference:invoice?.invoice_no||'',debit:cents(r.refund),credit:cents(r.credit),notes:r.reason||'',pending:!!r.pending||!!invoice?.pending});}
  for(const p of collections)entries.push({kind:'payment',id:p.id,date:p.payment_date,created_at:p.created_at||'',reference:Number(p.id)>0?'CP-'+p.id:'',debit:0,credit:cents(p.amount),account:p.account,notes:p.notes||'',pending:!!p.pending});
  const rank={invoice:0,return:1,payment:2};
  entries.sort((a,b)=>String(a.date).localeCompare(String(b.date))||String(a.created_at).localeCompare(String(b.created_at))||rank[a.kind]-rank[b.kind]||String(a.id).localeCompare(String(b.id)));
  let running=opening;
  const ledger=entries.map(entry=>{running+=entry.debit-entry.credit;return {...entry,debit:entry.debit/100,credit:entry.credit/100,balance:running/100};});
  return {customer,generated_at:generatedAt,opening_balance:opening/100,net_sales:netSales/100,sale_payments:salePaid/100,collections:received/100,balance:balance/100,due:Math.max(0,balance)/100,credit:Math.max(0,-balance)/100,invoice_count:active.length,invoices:bills,payments:collections,entries:ledger,pending:!!customer.pending||bills.some(i=>i.pending)||collections.some(p=>p.pending)||credits.some(r=>r.pending)};
}
export function allCustomerDues(snapshot){return (snapshot.customers||[]).map(customer=>customerDueStatement(customer,snapshot.invoices||[],snapshot.payments||[],snapshot.returns||[])).sort((a,b)=>b.balance-a.balance||a.customer.name.localeCompare(b.customer.name));}
