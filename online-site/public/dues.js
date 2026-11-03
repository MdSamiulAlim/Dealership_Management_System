/* Customer account statements: calculated totals, linked edits, collections and receipts. */
(async()=>{
 const {customerDueStatement,allCustomerDues}=await import('/customer-due.mjs?v=financial-security-2026-v1');
 const store=window.WorkspaceStore,i18n=window.AppI18n,A=window.AdvancedWorkspace;
 const q=(s,root=document)=>root.querySelector(s),qa=(s,root=document)=>[...root.querySelectorAll(s)];
 const t=value=>i18n.text(value),html=escapeHtml,record=recordText;
 const ctx={customerId:null,editing:false,payment:null,commandId:null,busy:false,dirty:false};
 const localDate=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const date=value=>value?new Intl.DateTimeFormat(i18n.language==='bn'?'bn-BD':'en-GB',{timeZone:'Asia/Dhaka',year:'numeric',month:'short',day:'2-digit'}).format(new Date(value+'T00:00:00+06:00')):'—';
 const lookup=id=>state.customers.find(c=>String(c.id)===String(store.resolveId(id)));
 const statement=id=>customerDueStatement(lookup(id),state.invoices||[],state.payments||[],state.returns||[]);
 const money=value=>formatMoney(value);
 const balanceLabel=s=>s.credit?t('Customer credit'):s.due?t('Outstanding Due'):t('Settled');
 const amountCell=(label,value)=>`<td class="number" data-label="${label}">${money(value)}</td>`;
 function render(){
  const all=allCustomerDues(state),outstanding=all.filter(s=>s.due>0),query=normalized(q('#dueSearch').value);
  const rows=outstanding.filter(s=>!query||normalized([s.customer.name,s.customer.mobile,...s.invoices.map(i=>i.invoice_no)].join(' ')).includes(query));
  const sum=key=>all.reduce((n,s)=>n+Math.round(s[key]*100),0)/100;
  const cards=[['Outstanding Due',money(sum('due'))],['Customers with due',formatQty(outstanding.length)],['Customer credit',money(sum('credit'))],['Net Balance',money(sum('balance'))]];
  q('#dueMetrics').innerHTML=cards.map(([label,value],i)=>`<article class="metric ${i===0?'featured':''}"><div class="metric-top"><span>${t(label)}</span></div><strong>${value}</strong><small>${t('All customers · all recorded transactions')}</small></article>`).join('');
  q('#dueCount').textContent=formatQty(outstanding.length);q('#dueResultCount').textContent=i18n.format('{visible} of {total} records',{visible:rows.length,total:outstanding.length});
  q('#dueRows').innerHTML=rows.length?rows.map(s=>`<tr><td data-label="Customer"><strong>${record(s.customer.name)}</strong><span class="row-date">${record(s.customer.mobile||'')}</span>${s.pending?`<span class="pill warning">${t('Pending Sync')}</span>`:''}</td>${amountCell('Opening balance',s.opening_balance)}${amountCell('Net sales',s.net_sales)}${amountCell('Payments with sales',s.sale_payments)}${amountCell('Customer collections',s.collections)}<td class="number due-balance-cell" data-label="Balance"><strong>${money(Math.abs(s.balance))}</strong><span class="row-date">${balanceLabel(s)}</span></td><td data-label="Actions"><div class="row-actions"><button type="button" class="button secondary" data-due-view="${s.customer.id}">View</button><button type="button" class="button secondary" data-due-edit="${s.customer.id}">Edit</button><button type="button" class="button secondary" data-due-download="${s.customer.id}" ${s.pending||store.status().pending?'disabled':''}>Download</button></div></td></tr>`).join(''):emptyRow(7,outstanding.length?'No matching customers with outstanding due. Clear the search to see all dues.':all.length?'No outstanding customer dues.':'No customers yet. Add a customer to start tracking dues.');
  if(q('#dueStatementDialog').open&&ctx.customerId!==null){if(lookup(ctx.customerId))renderStatement();else reset();}
  i18n.apply(q('#dues'));i18n.apply(q('#dueStatementDialog'));
 }
 function ledgerMarkup(s,editing=false,print=false){
  const rowActions=entry=>{
   if(!editing||print)return '';
   if(entry.kind==='payment')return `<button type="button" class="button secondary" data-due-payment-edit="${entry.id}">${t('Edit Collection')}</button>`;
   if(entry.kind==='invoice'){const inv=s.invoices.find(i=>String(i.id)===String(entry.id)),locked=inv?.status==='void'||inv?.items?.some(i=>Number(i.returned_quantity)>0)||Number(inv?.returned_total)>0;return `<div class="row-actions"><button type="button" class="button secondary" data-due-invoice-view="${entry.id}">${t('View Invoice')}</button><button type="button" class="button secondary" data-due-invoice-edit="${entry.id}" ${locked?'disabled':''}>${t('Edit Invoice')}</button></div>`;}
   return `<button type="button" class="button secondary" data-due-invoice-view="${entry.invoice_id}">${t('View Invoice')}</button>`;
  };
  return `<div class="table-wrap"><table class="due-history"><thead><tr><th>${t('Date / Reference')}</th><th>${t('Entry')}</th><th class="number">${t('Charge / Refund')}</th><th class="number">${t('Paid / Credit')}</th><th class="number">${t('Balance')}</th>${editing&&!print?`<th>${t('Actions')}</th>`:''}</tr></thead><tbody><tr><td data-label="Date / Reference">—</td><td data-label="Entry">${t('Opening balance')}</td>${amountCell('Charge / Refund',Math.max(0,s.opening_balance))}${amountCell('Paid / Credit',Math.max(0,-s.opening_balance))}${amountCell('Balance',s.opening_balance)}${editing&&!print?'<td></td>':''}</tr>${s.entries.map(e=>`<tr><td data-label="Date / Reference">${date(e.date)}<span class="row-date">${record(e.reference||t('Pending Sync'))}</span></td><td data-label="Entry">${t(e.kind==='invoice'?'Sale':e.kind==='return'?'Return / Refund':'Collection')}${e.account?`<span class="row-date">${t(e.account)}</span>`:''}${e.notes?`<span class="row-date">${record(e.notes)}</span>`:''}${e.pending?`<span class="pill warning">${t('Pending Sync')}</span>`:''}</td>${amountCell('Charge / Refund',e.debit)}${amountCell('Paid / Credit',e.credit)}${amountCell('Balance',e.balance)}${editing&&!print?`<td data-label="Actions">${rowActions(e)}</td>`:''}</tr>`).join('')}</tbody></table></div>`;
 }
 function statementMarkup(s,editing=false,print=false){
  const settings=state.settings||{name:'Arafat Traders',phone:'+8801646130402',address:''};
  return `<article class="due-sheet"><div class="due-store"><img src="/brand/arafat-growth-logo.png" alt="Arafat Traders" width="72" height="72"/><div><strong>${record(settings.name)}</strong><p>${record(settings.phone)}</p>${settings.address?`<p>${record(settings.address)}</p>`:''}</div><img class="due-partner" src="/akij-feed-logo.svg" alt="AKIJ Feed" width="100" height="42"/></div><div class="due-customer-heading"><div><h3>${record(s.customer.name)}</h3><p>${record(s.customer.mobile||'')}</p><p>${record(s.customer.address||'')}</p></div>${editing&&!print?`<button type="button" class="button secondary" id="dueEditContact">${t('Edit Customer')}</button>`:''}</div><p class="helper-text">${t('Generated')}: ${new Intl.DateTimeFormat(i18n.language==='bn'?'bn-BD':'en-GB',{timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'}).format(new Date(s.generated_at))}</p>${s.pending||store.status().pending?`<p class="due-pending pill warning">${t('Pending device changes exist. Sync before downloading the final PDF.')}</p>`:''}<div class="due-statement-totals">${[['Opening balance',s.opening_balance],['Net sales',s.net_sales],['Payments with sales',s.sale_payments],['Customer collections',s.collections],[balanceLabel(s),Math.abs(s.balance)]].map(([label,value])=>`<div><span>${t(label)}</span><strong>${money(value)}</strong></div>`).join('')}</div><p class="helper-text">${t('Balance = opening balance + net sales − payments with sales − customer collections.')}</p>${editing&&!print?`<p class="helper-text">${t('Edit the related invoice or collection to update this statement automatically. Customer collections reduce the account balance separately from invoice payments.')}</p>`:''}<h3>${t('Account history')}</h3>${ledgerMarkup(s,editing,print)}<p class="helper-text">${t('This statement includes all recorded customer transactions as of the generated time.')}</p></article>`;
 }
 function renderStatement(){const s=statement(ctx.customerId);q('#dueStatementContent').innerHTML=statementMarkup(s,ctx.editing);q('#dueDownload').disabled=s.pending||store.status().pending>0||Number(s.customer.id)<0;q('#dueStatementEdit').hidden=ctx.editing;q('#dueStatementTitle').textContent=t(ctx.editing?'Edit Customer Due':'Customer Due Statement');i18n.apply(q('#dueStatementDialog'));}
 function openStatement(id,edit=false){ctx.customerId=store.resolveId(id);ctx.editing=edit;q('#dueStatementError').textContent='';renderStatement();if(!q('#dueStatementDialog').open)q('#dueStatementDialog').showModal();}
 async function download(id){const s=statement(id);if(s.pending||store.status().pending>0||Number(s.customer.id)<0)throw Error('Sync pending customer records before downloading the final receipt.');const blob=await store.download(`/api/customers/${s.customer.id}/due/receipt?lang=${i18n.language}`);await A.saveBlob(`Arafat-Customer-Due-${s.customer.id}.pdf`,blob);}
 function paymentPreview(){const form=q('#duePaymentForm'),customer=lookup(form.elements.customer_id.value);if(!customer)return;const s=statement(customer.id),next=Math.round((s.balance+(ctx.payment?Number(ctx.payment.amount):0)-Number(form.elements.amount.value||0))*100)/100;q('#duePaymentPreview').innerHTML=`<span>${t('Current balance')}: <strong>${money(s.balance)}</strong></span><span>${t('Balance after collection')}: <strong>${money(next)}</strong></span>`;}
 function startPayment(customerId=null,payment=null){
  if(!state.customers.length){toast('Add a customer before receiving a collection.');return;}
  ctx.payment=payment?structuredClone(payment):null;ctx.commandId=store.uuid();ctx.dirty=false;A.markDirty('due-payment',false);
  const form=q('#duePaymentForm');form.reset();form.elements.customer_id.innerHTML=state.customers.map(c=>`<option value="${c.id}" translate="no">${html(c.name)} — ${money(c.current_due)}</option>`).join('');
  const selected=customerId??allCustomerDues(state).find(s=>s.due>0)?.customer.id??state.customers[0].id;
  form.elements.customer_id.value=String(store.resolveId(selected));form.elements.customer_id.disabled=!!payment;form.elements.payment_date.value=payment?.payment_date||localDate();form.elements.amount.value=payment?.amount??'';form.elements.account.value=payment?.account||'Cash';form.elements.notes.value=payment?.notes||'';
  q('#duePaymentTitle').textContent=t(payment?'Edit Collection':'Receive Payment');q('#saveDuePayment').textContent=t(payment?'Save Changes':'Save Collection');q('#duePaymentError').textContent='';q('#dueStatementDialog').close();paymentPreview();i18n.apply(q('#duePaymentDialog'));q('#duePaymentDialog').showModal();form.elements.amount.focus();
 }
 async function cancelPayment(){if(ctx.busy)return;if(ctx.dirty&&!await A.confirm('Discard unsaved collection changes?'))return;q('#duePaymentDialog').close();ctx.dirty=false;A.markDirty('due-payment',false);}
 q('#duePaymentForm').addEventListener('input',()=>{ctx.dirty=true;A.markDirty('due-payment',true);paymentPreview();});q('#duePaymentForm').addEventListener('change',()=>{ctx.dirty=true;A.markDirty('due-payment',true);paymentPreview();});
 q('#duePaymentForm').addEventListener('submit',async event=>{
  event.preventDefault();const form=event.currentTarget;if(ctx.busy||!form.reportValidity())return;ctx.busy=true;
  for(const e of qa('button',q('#duePaymentDialog')))e.disabled=true;
  try{
   const payload=Object.fromEntries(new FormData(form));payload.customer_id=Number(form.elements.customer_id.value);payload.amount=Number(payload.amount);if(ctx.payment)payload.original=structuredClone(ctx.payment);
   if(ctx.payment&&!await A.confirm([t('Save collection changes?'),lookup(payload.customer_id)?.name,money(ctx.payment.amount)+' → '+money(payload.amount),t(payload.account)].join('\n')))return;
   const result=await api(ctx.payment?`/api/payments/${store.resolveId(ctx.payment.id)}`:'/api/payments',{method:ctx.payment?'PATCH':'POST',commandId:ctx.commandId,body:JSON.stringify(payload)});
   Object.assign(state,result);ctx.dirty=false;A.markDirty('due-payment',false);q('#duePaymentDialog').close();renderAll();openStatement(store.resolveId(payload.customer_id),true);toast(store.status().pending?'Saved on this device; pending Sync.':'Collection saved and balances updated.');
  }catch(error){q('#duePaymentError').textContent=error.message;q('#duePaymentError').focus();}finally{ctx.busy=false;for(const e of qa('button',q('#duePaymentDialog')))e.disabled=false;i18n.apply(q('#duePaymentDialog'));}
 });
 q('#duePaymentDialog').addEventListener('cancel',event=>{event.preventDefault();cancelPayment();});q('#closeDuePayment').addEventListener('click',cancelPayment);q('#cancelDuePayment').addEventListener('click',cancelPayment);
 q('#dueSearch').addEventListener('input',render);q('#dueStatementEdit').addEventListener('click',()=>{ctx.editing=true;renderStatement();});q('#dueReceivePayment').addEventListener('click',()=>startPayment(ctx.customerId));
 q('#duePrint').addEventListener('click',async()=>{try{q('#invoicePrintArea').innerHTML=`<div class="memo-sheet">${statementMarkup(statement(ctx.customerId),false,true)}</div>`;i18n.apply(q('#invoicePrintArea'));await document.fonts?.ready;if(window.NativeWorkspace?.printInvoice)window.NativeWorkspace.printInvoice();else window.print();}catch(error){q('#dueStatementError').textContent=error.message;}});
 q('#dueDownload').addEventListener('click',()=>download(ctx.customerId).catch(e=>q('#dueStatementError').textContent=e.message));
 document.addEventListener('click',async event=>{
  const button=event.target.closest('button');if(!button)return;
  try{
   if(button.dataset.dueView)openStatement(button.dataset.dueView);
   else if(button.dataset.dueEdit)openStatement(button.dataset.dueEdit,true);
   else if(button.dataset.dueDownload)await download(button.dataset.dueDownload);
   else if(button.dataset.duePaymentEdit){const row=state.payments.find(p=>String(p.id)===button.dataset.duePaymentEdit);if(row)startPayment(row.customer_id,row);}
   else if(button.dataset.dueInvoiceEdit){q('#dueStatementDialog').close();await A.editInvoice(button.dataset.dueInvoiceEdit);}
   else if(button.dataset.dueInvoiceView){q('#dueStatementDialog').close();await A.openInvoice(button.dataset.dueInvoiceView);}
   else if(button.id==='dueEditContact'){q('#dueStatementDialog').close();A.editCustomer(ctx.customerId);}
  }catch(error){toast(error.message);}
 });
 function reset(){q('#dueSearch').value='';ctx.customerId=null;ctx.payment=null;ctx.commandId=null;ctx.editing=false;ctx.dirty=false;A.markDirty('due-payment',false);q('#dueStatementContent').innerHTML='';q('#duePaymentForm').reset();q('#dueStatementDialog').close();q('#duePaymentDialog').close();}
 window.CustomerDues={render,startPayment,openStatement,reset};
 window.addEventListener('workspace:signed-out',reset);window.addEventListener('workspace:sign-in-required',reset);
 q('#languageSelect').addEventListener('change',()=>{render();if(q('#duePaymentDialog').open){q('#duePaymentTitle').textContent=t(ctx.payment?'Edit Collection':'Receive Payment');paymentPreview();i18n.apply(q('#duePaymentDialog'));}});
 render();
})().catch(error=>{console.error('Customer Due unavailable',error);toast('Customer Due could not load. Reload the app.');});
