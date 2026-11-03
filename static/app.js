const state = {
  products: [],
  customers: [],
  orders: [],
  sales: [],
  payments: [],
  adjustments: [],
  transactions: [],
  dashboard: {},
  reports: {},
};

const taka = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  maximumFractionDigits: 0,
});

const qty = new Intl.NumberFormat("en-BD", {
  maximumFractionDigits: 2,
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function formatMoney(value) {
  return taka.format(Number(value || 0));
}

function formatQty(value) {
  return qty.format(Number(value || 0));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function load() {
  const data = await api("/api/bootstrap");
  Object.assign(state, data);
  renderAll();
}

function renderSyncStatus(sync) {
  const node = document.getElementById("syncStatus");
  if (!node || !sync) return;
  const ocr = sync.ocr_available ? "OCR ready" : "OCR not installed";
  node.textContent = `Akij sync: ${sync.remote_count} products checked, ${sync.updated_count} code updated (${ocr})`;
}

function setDefaultDates() {
  const today = new Date().toISOString().slice(0, 10);
  $$('input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today;
  });
}

function productLabel(item) {
  return item.product_code ? `[${item.product_code}] ${item.name}` : item.name;
}

function fillOptions() {
  $$("select[data-options]").forEach((select) => {
    const collection = state[select.dataset.options] || [];
    const current = select.value;
    select.innerHTML = collection
      .map((item) => `<option value="${item.id}">${escapeHtml(productLabel(item))}</option>`)
      .join("");
    if (current) select.value = current;
    if (!select.value && collection[0]) select.value = collection[0].id;
    syncProductMeta(select);
  });
}

function syncProductMeta(select) {
  if (select.dataset.options !== "products") return;
  const product = state.products.find((item) => String(item.id) === String(select.value));
  if (!product) return;
  const rateTarget = select.dataset.rateTarget ? document.getElementById(select.dataset.rateTarget) : null;
  const weightTarget = select.dataset.weightTarget ? document.getElementById(select.dataset.weightTarget) : null;
  if (rateTarget && !rateTarget.value) rateTarget.value = product.default_rate || 0;
  if (weightTarget) weightTarget.value = product.bag_weight || 50;
}

function renderMetrics() {
  const d = state.dashboard;
  const metrics = [
    ["আজকের Sales", formatMoney(d.total_sales_today)],
    ["আজকের Order", formatQty(d.today_orders || 0)],
    ["Current Stock", `${formatQty(d.current_stock)} Bag`],
    ["আজ Received", formatMoney(d.received_today)],
    ["Customer Due", formatMoney(d.customer_due)],
    ["Company Payable", formatMoney(d.company_payable)],
    ["Cash Balance", formatMoney(d.cash_balance)],
    ["Bank Balance", formatMoney(d.bank_balance)],
  ];
  $("#metricGrid").innerHTML = metrics
    .map(([label, value]) => `<article class="metric"><span>${label}</span><strong>${value}</strong></article>`)
    .join("");
}

function deleteButton(endpoint, id) {
  return `<button class="danger" data-delete="${endpoint}" data-id="${id}" title="Delete record">Delete</button>`;
}

function emptyRow(cols, message = "No data yet") {
  return `<tr><td class="empty" colspan="${cols}">${message}</td></tr>`;
}

function renderDashboardTables() {
  $("#lowStockRows").innerHTML = state.dashboard.low_stock?.length
    ? state.dashboard.low_stock
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td class="number"><span class="pill danger">${formatQty(row.current_stock)} Bag</span></td>
              <td class="number">${formatQty(row.low_stock_level)} Bag</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(3, "Low stock product nei");

  $("#recentSalesRows").innerHTML = state.sales.length
    ? state.sales
        .slice(0, 8)
        .map(
          (row) => `
            <tr>
              <td>${row.sale_date}</td>
              <td>${escapeHtml(row.customer_name)}</td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td class="number">${formatMoney(row.due_amount)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(4);
}

function renderSales() {
  $("#salesRows").innerHTML = state.sales.length
    ? state.sales
        .map(
          (row) => `
            <tr>
              <td>${row.sale_date}</td>
              <td>${escapeHtml(row.customer_name)}</td>
              <td>${escapeHtml(row.product_name)}</td>
              <td class="number">${formatQty(row.quantity)}</td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td class="number">${formatMoney(row.paid_amount)}</td>
              <td class="number">${formatMoney(row.due_amount)}</td>
              <td>${deleteButton("sales", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(9);
}

function renderOrders() {
  $("#ordersRows").innerHTML = state.orders.length
    ? state.orders
        .map(
          (row) => `
            <tr>
              <td>${row.order_date}</td>
              <td>${escapeHtml(row.product_name)}</td>
              <td class="number">${formatQty(row.quantity)}</td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td><span class="pill ${row.status === "Delivered" ? "" : "warning"}">${row.status}</span></td>
              <td>${escapeHtml(row.invoice_no)}</td>
              <td>${deleteButton("orders", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(8);
}

function renderProducts() {
  $("#productsRows").innerHTML = state.products.length
    ? state.products
        .map((row) => {
          const low = Number(row.current_stock) <= Number(row.low_stock_level);
          return `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td><input class="code-input" data-code-input="${row.id}" value="${escapeHtml(row.product_code || '')}" aria-label="Packet code for ${escapeHtml(row.name)}" /></td>
              <td class="number">${formatQty(row.opening_stock)}</td>
              <td class="number">${formatQty(row.received_stock)}</td>
              <td class="number">${formatQty(row.sold_stock)}</td>
              <td class="number"><span class="pill ${low ? "danger" : ""}">${formatQty(row.current_stock)}</span></td>
              <td>
                <div class="rate-control">
                  <input data-rate-input="${row.id}" type="number" min="0" step="0.01" value="${Number(row.default_rate || 0)}" aria-label="Default rate for ${escapeHtml(row.name)}" />
                  <button data-rate-save="${row.id}" title="Save packet code and default rate">Save</button>
                </div>
              </td>
              <td class="number">${formatQty(row.low_stock_level)}</td>
              <td>${deleteButton("products", row.id)}</td>
            </tr>
          `;
        })
        .join("")
    : emptyRow(7);
}

function renderCustomers() {
  $("#customersRows").innerHTML = state.customers.length
    ? state.customers
        .map(
          (row) => `
            <tr>
              <td>${escapeHtml(row.name)}</td>
              <td>${escapeHtml(row.mobile)}</td>
              <td class="number">${formatMoney(row.total_purchase)}</td>
              <td class="number">${formatMoney(row.total_paid)}</td>
              <td class="number"><span class="pill ${Number(row.current_due) > 0 ? "warning" : ""}">${formatMoney(row.current_due)}</span></td>
              <td>${deleteButton("customers", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(6);
}

function renderMoney() {
  $("#paymentsRows").innerHTML = state.payments.length
    ? state.payments
        .map(
          (row) => `
            <tr>
              <td>${row.payment_date}</td>
              <td>${escapeHtml(row.customer_name)}</td>
              <td class="number">${formatMoney(row.amount)}</td>
              <td>${row.account}</td>
              <td>${deleteButton("payments", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(5);

  $("#transactionsRows").innerHTML = state.transactions.length
    ? state.transactions
        .map(
          (row) => `
            <tr>
              <td>${row.txn_date}</td>
              <td>${row.type}</td>
              <td class="number">${formatMoney(row.amount)}</td>
              <td>${row.account}</td>
              <td>${deleteButton("transactions", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(5);
}

const reportSchemas = {
  daily_sales: ["date", "invoice_count", "bags", "sales", "received", "due"],
  monthly_sales: ["month", "bags", "sales", "received"],
  product_sales: ["name", "bags", "amount"],
  customer_sales: ["name", "purchase", "paid", "sale_due"],
  stock_report: ["name", "opening_stock", "received_stock", "sold_stock", "current_stock"],
  due_report: ["name", "mobile", "total_purchase", "total_paid", "current_due"],
  order_report: ["status", "order_count", "bags", "amount"],
  cash_bank: ["account", "balance"],
};

const reportTitles = {
  daily_sales: "Daily Sales",
  monthly_sales: "Monthly Sales",
  product_sales: "Product-wise Sales",
  customer_sales: "Customer-wise Sales",
  stock_report: "Stock Report",
  due_report: "Due / Outstanding",
  order_report: "Company Order",
  cash_bank: "Cash / Bank",
};

function formatReportCell(key, value) {
  if (["sales", "received", "due", "amount", "purchase", "paid", "sale_due", "balance", "total_purchase", "total_paid", "current_due", "opening_due"].includes(key)) {
    return formatMoney(value);
  }
  if (["bags", "quantity", "opening_stock", "received_stock", "sold_stock", "current_stock"].includes(key)) {
    return formatQty(value);
  }
  return escapeHtml(value);
}

function renderReports() {
  $("#reportGrid").innerHTML = Object.entries(reportSchemas)
    .map(([name, columns]) => {
      const rows = state.reports[name] || [];
      return `
        <article class="report-block">
          <h2>${reportTitles[name]}</h2>
          <div class="table-wrap">
            <table>
              <thead><tr>${columns.map((column) => `<th>${column.replaceAll("_", " ")}</th>`).join("")}</tr></thead>
              <tbody>
                ${
                  rows.length
                    ? rows
                        .map(
                          (row) => `
                            <tr>${columns
                              .map((column) => `<td class="${typeof row[column] === "number" ? "number" : ""}">${formatReportCell(column, row[column])}</td>`)
                              .join("")}</tr>
                          `
                        )
                        .join("")
                    : emptyRow(columns.length)
                }
              </tbody>
            </table>
          </div>
        </article>
      `;
    })
    .join("");
}

function renderAll() {
  fillOptions();
  renderMetrics();
  renderDashboardTables();
  renderSales();
  renderOrders();
  renderProducts();
  renderCustomers();
  renderMoney();
  renderReports();
  setDefaultDates();
}

function formPayload(form) {
  return Object.fromEntries(new FormData(form).entries());
}

async function handleSubmit(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const endpoint = form.dataset.endpoint;
  const submit = $("button[type='submit']", form);
  submit.disabled = true;
  try {
    const data = await api(`/api/${endpoint}`, {
      method: "POST",
      body: JSON.stringify(formPayload(form)),
    });
    Object.assign(state, data);
    form.reset();
    renderAll();
    toast("Saved successfully");
  } catch (error) {
    toast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function handleAkijSync() {
  const button = document.getElementById("syncAkijBtn");
  const status = document.getElementById("syncStatus");
  button.disabled = true;
  if (status) status.textContent = "Akij sync: checking website and product images...";
  try {
    const data = await api("/api/sync-akij", { method: "POST", body: JSON.stringify({}) });
    Object.assign(state, data);
    renderAll();
    renderSyncStatus(data.sync);
    const warning = data.sync?.errors?.[0];
    toast(warning || "Akij sync completed");
  } catch (error) {
    if (status) status.textContent = `Akij sync failed: ${error.message}`;
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleRateSave(button) {
  const id = button.dataset.rateSave;
  const input = document.querySelector(`[data-rate-input="${id}"]`);
  const codeInput = document.querySelector(`[data-code-input="${id}"]`);
  button.disabled = true;
  try {
    const data = await api(`/api/products/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ product_code: codeInput?.value || "", default_rate: input.value || 0, original: state.products.find(p => String(p.id) === String(id)) }),
    });
    Object.assign(state, data);
    renderAll();
    toast("Saved");
  } catch (error) {
    toast(error.message);
  } finally {
    button.disabled = false;
  }
}

async function handleDelete(button) {
  const endpoint = button.dataset.delete;
  const id = button.dataset.id;
  const yes = window.confirm("Delete this record?");
  if (!yes) return;
  try {
    const data = await api(`/api/${endpoint}/${id}`, { method: "DELETE" });
    Object.assign(state, data);
    renderAll();
    toast("Deleted");
  } catch (error) {
    toast(error.message);
  }
}

function syncTransferForm(form) {
  const type=form.elements.type.value,transfer=['Bank Deposit','Bank Withdraw'].includes(type);
  form.elements.account.disabled=transfer;
  if(transfer)form.elements.account.value=type==='Bank Deposit'?'Cash':'Bank';
  const hint=form.querySelector('[data-transfer-hint]');
  hint.hidden=!transfer;
  hint.textContent=transfer?(type==='Bank Deposit'?'Cash → Bank':'Bank → Cash')+' · Both accounts update together.':'';
}

function bindEvents() {
  const transferForm=document.querySelector('form[data-endpoint="transactions"]');
  transferForm.elements.type.addEventListener('change',()=>syncTransferForm(transferForm));
  transferForm.addEventListener('reset',()=>setTimeout(()=>syncTransferForm(transferForm),0));
  syncTransferForm(transferForm);
  $$(".tab").forEach((button) => {
    button.addEventListener("click", () => {
      $$(".tab").forEach((tab) => tab.classList.remove("active"));
      $$(".view").forEach((view) => view.classList.remove("active"));
      button.classList.add("active");
      document.getElementById(button.dataset.tab).classList.add("active");
    });
  });

  $$(".entry-form").forEach((form) => form.addEventListener("submit", handleSubmit));

  document.addEventListener("click", (event) => {
    const rateButton = event.target.closest("[data-rate-save]");
    if (rateButton) {
      handleRateSave(rateButton);
      return;
    }
    const button = event.target.closest("[data-delete]");
    if (button) handleDelete(button);
  });

  document.addEventListener("change", (event) => {
    const select = event.target.closest("select[data-options='products']");
    if (select) {
      const rateTarget = select.dataset.rateTarget ? document.getElementById(select.dataset.rateTarget) : null;
      if (rateTarget) rateTarget.value = "";
      syncProductMeta(select);
    }
  });

  $("#refreshBtn").addEventListener("click", () => load().then(() => toast("Refreshed")));
  $("#syncAkijBtn")?.addEventListener("click", handleAkijSync);
}

bindEvents();
load().catch((error) => toast(error.message));
