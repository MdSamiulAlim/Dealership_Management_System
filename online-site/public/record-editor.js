/* Shared editors for orders, collections, stock adjustments and money. */
(() => {
  const A = window.AdvancedWorkspace;
  const translate = text => window.AppI18n.text(text);
  const definitions = {
    orders: [['order_date','Order date','date'],['product_id','Product','products'],['quantity','Bags','integer'],['bag_weight','Pack weight (kg)','positive'],['rate','Company rate per bag','money'],['status','Status',['Pending','Confirmed','Delivered']],['delivery_date','Delivery date','optionalDate'],['invoice_no','Challan number','text'],['notes','Notes','note']],
    payments: [['payment_date','Payment date','date'],['customer_id','Customer','customers'],['amount','Amount','positive'],['account','Account',['Cash','Bank']],['notes','Notes','note']],
    adjustments: [['adjust_date','Adjustment date','date'],['product_id','Product','products'],['type','Adjustment type',['Manual Add','Manual Minus','Damage','Loss','Return']],['quantity','Bags','integer'],['notes','Reason / notes','reason']],
    transactions: [['txn_date','Transaction date','date'],['type','Type',['Company Payment','Expense','Transport Cost','Other Income','Other Expense','Bank Deposit','Bank Withdraw']],['amount','Amount','positive'],['account','Account',['Cash','Bank']],['category','Category','text'],['reference','Reference','text'],['notes','Notes','note']],
  };
  let editing = null, busy = false;
  document.body.insertAdjacentHTML('beforeend', `<dialog id="recordEditDialog" aria-labelledby="recordEditTitle"><div class="dialog-heading"><h2 id="recordEditTitle">Edit record</h2><button type="button" class="icon-button" id="closeRecordEdit" aria-label="Close">${icon('close')}</button></div><form id="recordEditForm"><div id="recordEditFields" class="form-grid"></div><p id="recordEditError" class="form-error" role="alert"></p><div class="dialog-actions"><button type="button" class="button secondary" id="cancelRecordEdit">Cancel</button><button type="submit" class="button primary" id="saveRecordEdit">Save changes</button></div></form></dialog>`);
  const dialog = $('#recordEditDialog'), form = $('#recordEditForm');
  function clear() {
    editing = null; busy = false; A.markDirty('record-editor', false);
    form.reset(); $('#recordEditFields').innerHTML = ''; $('#recordEditError').textContent = '';
    $('#saveRecordEdit').disabled = false;
  }
  async function close() {
    if (busy) return;
    if (editing?.dirty && !await A.confirm('Discard unsaved form changes?')) return;
    dialog.close();
  }
  async function open(entity, id) {
    const row = state[entity]?.find(r => String(r.id) === String(id));
    if (!row || !definitions[entity]) throw Error('Record not found. Refresh and try again.');
    if (row.pending) throw Error('Sync this record before editing or deleting.');
    if (dialog.open) { await close(); if (dialog.open) return; }
    editing = {entity, original: structuredClone(row), dirty: false, commandId: crypto.randomUUID()};
    if (row.transfer_id) {
      const pair = state.transactions.filter(r => r.transfer_id === row.transfer_id && r.id !== row.id);
      if (pair.length !== 1 || pair[0].pending) { clear(); throw Error('Reload the complete transfer before editing.'); }
      editing.partner = structuredClone(pair[0]);
    }
    $('#recordEditTitle').textContent = translate('Edit record');
    $('#recordEditFields').innerHTML = definitions[entity].map(([name, label, kind]) => {
      const value = row[name] ?? '';
      let input;
      if (Array.isArray(kind) || ['products','customers'].includes(kind)) {
        let options = Array.isArray(kind) ? kind.map(v => [v, translate(v)]) : [...state[kind], ...(kind === 'products' ? state.archived_products || [] : [])].filter(r => !r.archived || String(r.id) === String(value)).map(r => [r.id, r.name]);
        if (entity === 'transactions' && name === 'type') options = options.filter(([v]) => ['Bank Deposit','Bank Withdraw'].includes(v) === !!row.transfer_id);
        input = `<select name="${name}" required ${entity === 'payments' && name === 'customer_id' || row.transfer_id && name === 'account' ? 'disabled' : ''}>${options.map(([v,t]) => `<option value="${escapeHtml(v)}" ${String(v) === String(value) ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select>`;
      } else if (['note','reason'].includes(kind)) {
        input = `<textarea name="${name}" maxlength="1000" ${kind === 'reason' ? 'required' : ''}>${escapeHtml(value)}</textarea>`;
      } else {
        const numeric = ['integer','positive','money'].includes(kind);
        input = `<input name="${name}" type="${numeric ? 'number' : kind === 'optionalDate' ? 'date' : kind}" value="${escapeHtml(value)}" ${numeric ? `min="${kind === 'integer' ? '1' : kind === 'positive' ? '0.01' : '0'}" max="1000000000000" step="${kind === 'integer' ? '1' : '0.01'}"` : 'maxlength="200"'} ${['date','integer','positive','money'].includes(kind) ? 'required' : ''}>`;
      }
      return `<label>${escapeHtml(translate(label))}${input}</label>`;
    }).join('');
    dialog.showModal(); A.translate(); form.querySelector('input,select,textarea')?.focus();
  }
  form.addEventListener('input', () => { if (editing) { editing.dirty = true; A.markDirty('record-editor', true); } });
  form.addEventListener('change', () => { if (editing) { editing.dirty = true; A.markDirty('record-editor', true); } });
  form.addEventListener('submit', async event => {
    event.preventDefault(); if (!editing || busy || !form.reportValidity()) return;
    const current = editing;
    const payload = Object.fromEntries(new FormData(form));
    if (current.entity === 'payments') payload.customer_id = current.original.customer_id;
    if (current.partner) { payload.account = current.original.account; payload.original_transfer = current.partner; }
    payload.original = current.original;
    busy = true; $('#saveRecordEdit').disabled = true; $('#recordEditError').textContent = '';
    try {
      const title = current.entity === 'transactions' && current.partner ? 'Both transfer entries will be updated together.' : 'Stock and financial balances will be recalculated.';
      if (!await A.confirm(title, translate('Confirm changes'))) return;
      if (editing !== current) return;
      payload.confirmed = true;
      const data = await api(`/api/${current.entity}/${current.original.id}`, {method: 'PATCH', commandId: current.commandId, body: JSON.stringify(payload)});
      if (editing !== current) return;
      Object.assign(state, data); dialog.close(); renderAll(); toast(translate('Saved successfully'));
    } catch (error) {
      if (editing === current) $('#recordEditError').textContent = translate(error.message);
    } finally { busy = false; $('#saveRecordEdit').disabled = false; }
  });
  $('#closeRecordEdit').addEventListener('click', close);
  $('#cancelRecordEdit').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', clear);
  document.addEventListener('click', async event => {
    const button = event.target.closest('[data-record-edit]'); if (!button) return;
    try { await open(button.dataset.recordEdit, button.dataset.id); } catch (error) { toast(translate(error.message)); }
  });
  window.addEventListener('workspace:status', () => {
    const s = window.WorkspaceStore.status();
    if ((s.locked || s.signedOut) && dialog.open) dialog.close();
  });
  $('#stock').insertAdjacentHTML('beforeend', `<article class="card" id="adjustmentHistory"><div class="data-toolbar"><h2>Stock adjustment history</h2><label>Search<input type="search" id="adjustmentSearch" placeholder="Product name or notes"></label></div><div class="table-wrap"><table><thead><tr><th>Date</th><th>Product</th><th>Type</th><th>Bags</th><th>Reason / notes</th><th>Actions</th></tr></thead><tbody id="adjustmentRows"></tbody></table></div></article>`);
  $('#adjustmentSearch').addEventListener('input', () => { ui.search.adjustments = $('#adjustmentSearch').value; render(); A.translate(); });
  function render() {
    const list = (state.adjustments || []).filter(r => `${r.product_name || ''} ${r.notes || ''} ${r.type || ''}`.toLowerCase().includes((ui.search.adjustments || '').toLowerCase()));
    $('#adjustmentRows').innerHTML = list.length ? paginateRows('adjustments', list, '#adjustmentRows').map(r => `<tr><td>${escapeHtml(r.adjust_date)}</td><td>${recordText(r.product_name)}</td><td>${escapeHtml(translate(r.type))}</td><td class="number">${formatQty(r.quantity)}</td><td>${recordText(r.notes)}</td><td><div class="row-actions">${editButton('adjustments',r.id)}${deleteButton('adjustments',r.id)}</div></td></tr>`).join('') : emptyRow(6);
  }
  window.RecordEditor = {open, render}; render(); A.translate();
})();
