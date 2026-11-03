/* Task-focused UI helpers. Business writes continue through the invoice form. */
(() => {
  const q = (s, root = document) => root.querySelector(s);
  const qa = (s, root = document) => [...root.querySelectorAll(s)];
  const form = q('#invoiceForm'), entry = q('#entry-sales');
  const dock = q('#saleSaveDock'), picker = q('#productPickerDialog');
  let targetLine = null, scheduled = false;
  const text = (node, value) => { const output = window.AppI18n.text(value); if (node && node.textContent !== output) node.textContent = output; };
  const helper = (bn, en) => q('#languageSelect').value === 'en' ? en : bn;
  const shellParts = [['.app-header', '--app-header-height'], ['.workspace-credit', '--app-credit-height'], ['.mobile-nav', '--bottom-nav-height']];
  function measureShell() {
    for (const [selector, variable] of shellParts) {
      const value = `${Math.ceil(q(selector).getBoundingClientRect().height)}px`;
      if (document.documentElement.style.getPropertyValue(variable) !== value) document.documentElement.style.setProperty(variable, value);
    }
    schedule();
  }

  function refresh() {
    scheduled = false;
    for (const kind of ['sales', 'orders', 'expenses']) {
      const panel = q(`[data-filter-panel="${kind}"]`);
      if (!panel) continue;
      const count = qa(`[data-kind="${kind}"]`).filter(el => el.value.trim()).length;
      text(q('[data-filter-summary]', panel), count ? `${count} active` : 'All records');
      panel.classList.toggle('has-filters', count > 0);
    }
    qa('.invoice-line', form).forEach((line, index) => {
      text(q('[data-line-number]', line), `Product ${index + 1}`);
      const button = q('[data-find-product]', line);
      if (button) button.setAttribute('aria-label', `Find product for item ${index + 1}`);
    });
    const save = q('#saveInvoiceButton');
    const error = q('#invoiceFormError').textContent.trim();
    const state = error ? helper('তথ্য ঠিক করে আবার Save করুন', 'Check the details before saving') : form.dataset.dirty === 'true' ? 'Unsaved changes' : form.dataset.editing ? 'Editing invoice' : 'Draft';
    text(q('#saleDraftBadge'), state);
    q('#saleDraftBadge').classList.toggle('is-error', Boolean(error));
    text(q('#dockSaleTotal'), error ? '—' : q('#invoiceTotals>span:nth-child(3) strong')?.textContent || '—');
    text(q('#dockSaleState'), state);
    text(q('#dockSaveInvoice'), save.textContent);
    q('#dockSaveInvoice').disabled = save.disabled;
    const bounds = entry.getBoundingClientRect(), actions = q('.invoice-form-actions').getBoundingClientRect();
    const barBottom = q('.app-header').getBoundingClientRect().bottom;
    const screenBottom = window.visualViewport?.height || window.innerHeight;
    const contentBottom = Math.min(screenBottom, q('.workspace-credit').getBoundingClientRect().top);
    const actionsVisible = actions.top >= barBottom && actions.bottom <= contentBottom - 12;
    const keyboardOpen = window.visualViewport && window.innerHeight - window.visualViewport.height > 150;
    const visible = window.matchMedia('(max-width:760px)').matches && ui.active === 'sales' && entry.open && bounds.top < contentBottom - 80 && bounds.bottom > barBottom + 100 && !actionsVisible && !keyboardOpen && !q('dialog[open]');
    dock.hidden = !visible;
    document.body.classList.toggle('has-sale-dock', visible);
  }
  function schedule() { if (!scheduled) { scheduled = true; requestAnimationFrame(refresh); } }

  function renderProducts() {
    const query = normalized(q('#productPickerSearch').value).trim();
    const category=q('#productPickerCategory').value;
    const products = selectableProducts().filter(p => (!category || productCategory(p)===category) && (!query || normalized(`${p.name} ${p.product_code || ''}`).includes(query)));
    text(q('#productPickerCount'), helper(`${products.length}টি পণ্য পাওয়া গেছে`, `${products.length} products found`));
    q('#productPickerResults').innerHTML = products.length ? products.map(p => `<button type="button" class="product-choice" data-choose-product="${p.id}"><span class="product-choice-icon">${icon('box')}</span><span class="product-choice-info"><strong>${recordText(p.name)}</strong><span class="product-category">${productCategoryLabel(p)}</span><span class="row-date">${productSpecifications(p)}</span><small>${p.product_code?recordText(p.product_code):window.AppI18n.text('No packet code')} · ${formatMoney(p.default_rate)} <span>/ Bag</span></small><span class="pill ${Number(p.current_stock) <= Number(p.low_stock_level) ? 'warning' : ''}">${formatQty(p.current_stock)} Bag available</span></span><span class="product-choice-action">Choose ${icon('chevron')}</span></button>`).join('') : `<p class="picker-empty">${helper('এই নামে কোনো পণ্য পাওয়া যায়নি। নাম বা কোড বদলে খুঁজুন।', 'No products found. Try another name or packet code.')}</p>`;
  }
  function openProductPicker(line) {
    if (!line) return;
    targetLine = line;
    q('#productPickerSearch').value = '';
    q('#productPickerCategory').value = '';
    renderProducts();
    picker.showModal();
    q('#productPickerSearch').focus();
    schedule();
  }

  document.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-find-product')) openProductPicker(button.closest('.invoice-line'));
    else if (button.dataset.chooseProduct) {
      const product = state.products.find(p => String(p.id) === button.dataset.chooseProduct);
      if (targetLine?.isConnected && product) {
        const select = q('[data-item-product]', targetLine);
        select.value = product.id;
        select.dispatchEvent(new Event('change', {bubbles: true}));
        picker.close();
        q('[data-item-quantity]', targetLine).focus();
        q('[data-item-quantity]', targetLine).select();
      }
      targetLine = null;
    }
    schedule();
  });
  q('#productPickerSearch').addEventListener('input', renderProducts);
  q('#productPickerCategory').addEventListener('change', renderProducts);
  picker.addEventListener('close', () => { targetLine = null; schedule(); });
  document.addEventListener('input', schedule);
  document.addEventListener('change', schedule);
  document.addEventListener('toggle', schedule, true);
  document.addEventListener('close', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('scroll', schedule, {passive: true});
  window.visualViewport?.addEventListener('resize', schedule);
  window.addEventListener('workspace:status', schedule);
  window.addEventListener('workspace:data', schedule);
  new MutationObserver(schedule).observe(form, {subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'data-dirty', 'data-editing']});
  const navigate = navigateTo;
  navigateTo = (page, quick = false, remember = true) => { navigate(page, quick, remember); schedule(); if (!quick) q('#mainContent').focus({preventScroll: true}); };
  const render = renderAll;
  renderAll = () => { const result = render(); schedule(); return result; };
  const shellObserver = new ResizeObserver(measureShell);
  for (const [selector] of shellParts) shellObserver.observe(q(selector));
  measureShell();
  schedule();
})();
