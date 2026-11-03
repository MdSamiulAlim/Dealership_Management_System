const state = {
  products: [],
  archived_products: [],
  customers: [],
  orders: [],
  sales: [],
  payments: [],
  adjustments: [],
  transactions: [],
  dashboard: {},
  reports: {},
};

const ui = { search: {}, categoryFilters: {products:"",stock:""}, salesFilter: "all", stockFilter: "all", chartPeriod: 7, active: "dashboard", menuOpen: false, lastSync: null, navigationHistory: [], navigationReady: false };
const pages = {
  dashboard: ["Overview", "Business overview", "আজকের ব্যবসার সব গুরুত্বপূর্ণ হিসাব, এক জায়গায়।", "YOUR BUSINESS, AT A GLANCE"],
  sales: ["Sales", "Sales & memos", "প্রতিটি বিক্রি, পেমেন্ট ও মেমো—সব গুছিয়ে রাখুন।", "SELL SMARTER, EVERY DAY"],
  orders: ["Orders", "Company orders", "অর্ডার থেকে ডেলিভারি, প্রতিটি ধাপের হিসাব।", "PLAN YOUR NEXT DELIVERY"],
  products: ["Products", "Product catalogue", "আপনার সব পণ্য, প্যাকেট কোড ও বিক্রির দাম।", "YOUR PRODUCTS, ORGANIZED"],
  stock: ["Stock", "Inventory overview", "কোন পণ্যের কত বস্তা আছে, সহজেই দেখে নিন।", "KNOW WHAT IS IN STOCK"],
  customers: ["Customers", "Your customers", "কাস্টমারের যোগাযোগ, কেনাকাটা ও বাকি টাকার হিসাব।", "BUILD BETTER RELATIONSHIPS"],
  dues: ["Customer Due", "Customer dues", "Every customer’s sales, collections and current balance in one place.", "KEEP CUSTOMER BALANCES CLEAR"],
  money: ["Money", "Money & payments", "ক্যাশ, ব্যাংক, পেমেন্ট ও খরচের পরিষ্কার হিসাব।", "EVERY TRANSACTION MATTERS"],
  reports: ["Reports", "Business reports", "বিক্রি, মজুত ও টাকার হিসাব থেকে সঠিক সিদ্ধান্ত নিন।", "SEE THE BIGGER PICTURE"],
};
function icon(name) { return `<svg class="icon" aria-hidden="true"><use href="/ui-icons.svg#${name}"></use></svg>`; }

const taka = new Intl.NumberFormat("en-BD", {
  style: "currency",
  currency: "BDT",
  currencyDisplay: "narrowSymbol",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const qty = new Intl.NumberFormat("en-BD", {
  maximumFractionDigits: 2,
});

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function formatMoney(value) {
  return window.AppI18n ? window.AppI18n.number(value, 'money') : taka.format(Number(value || 0));
}

function formatQty(value) {
  return window.AppI18n ? window.AppI18n.number(value) : qty.format(Number(value || 0));
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
  node.textContent = window.AppI18n?.text(message) ?? message;
  node.classList.add("show");
  window.setTimeout(() => node.classList.remove("show"), 2600);
}

async function api(path, options = {}) {
  if (window.WorkspaceStore) return window.WorkspaceStore.request(path, options);
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  if (response.status === 401) {
    throw new Error("লগইন প্রয়োজন। পেজ রিফ্রেশ করে আপনার User ID ও পাসওয়ার্ড দিন।");
  }
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Request failed");
  }
  return payload;
}

async function load() {
  setSyncState("loading");
  try {
    const data = await api("/api/bootstrap");
    Object.assign(state, data);
    renderAll();
  } catch (error) { setSyncState("error"); throw error; }
}

function renderSyncStatus(sync) {
  const node = document.getElementById("syncStatus");
  if (!node || !sync) return;
  const ocr = sync.ocr_available ? "OCR ready" : "OCR not installed";
  node.textContent = `Akij sync: ${sync.remote_count} products checked, ${sync.updated_count} code updated (${ocr})`;
}

function setDefaultDates() {
  const today = state.dashboard.today || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  $$('form input[type="date"]').forEach((input) => {
    if (!input.value) input.value = today;
  });
}

const feedCategories = ["Fish feed", "Cattle feed", "Poultry feed"];
function productCategory(item) {
  if (feedCategories.includes(item.category)) return item.category;
  const name = String(item.name || "").toLocaleLowerCase();
  if (/\b(?:cattle|beef|dairy|cow)\b|গরু/.test(name)) return "Cattle feed";
  if (/\b(?:poultry|broiler|layer|sonali|cock|chicken|duck|quail)\b|মুরগি|হাঁস|কোয়েল/.test(name)) return "Poultry feed";
  if (/\b(?:fish|tilapia|pangus|pangas|carp|koi|sing|pabda|gulsha|galda|shrimp|hatchery|nursery|common|floating|sinking)\b|মাছ|তেলাপিয়া|পাঙ্গাস|কার্প|পাবদা|শিং|চিংড়ি/.test(name)) return "Fish feed";
  return "";
}
function productCategoryLabel(item) {
  const category = productCategory(item) || "Uncategorized";
  return window.AppI18n?.text(category) || category;
}

function selectableProducts() { return state.products.filter(p=>!p.archived); }
function findProduct(id) { return [...state.products,...(state.archived_products||[])].find(p=>String(p.id)===String(id)); }
function productSpecifications(item) {
  return [item.feed_size,item.protein_percent==null||item.protein_percent===''?'':formatQty(item.protein_percent)+'%'].filter(Boolean).map(escapeHtml).join(' · ');
}
function productLabel(item) {
  return item.product_code ? `[${item.product_code}] ${item.name}` : item.name;
}

// Saved names, contacts, references and notes are data, never interface labels.
function recordText(value) { return `<span translate="no">${escapeHtml(value)}</span>`; }

function fillOptions() {
  $$("select[data-options]").forEach((select) => {
    const collection = select.dataset.options==="products" ? selectableProducts() : state[select.dataset.options] || [];
    const current = window.WorkspaceStore?.resolveId?.(select.value) ?? select.value;
    select.innerHTML = collection
      .map((item) => `<option translate="no" value="${item.id}">${escapeHtml(productLabel(item) + (select.dataset.stockCount ? ` — ${window.AppI18n?.text(formatQty(item.current_stock) + ' Bag') || formatQty(item.current_stock) + ' Bag'}` : ""))}</option>`)
      .join("") + (select.dataset.allowNew ? '<option value="new">+ New Customer</option>' : "");
    if (current) select.value = current;
    if (!select.value && collection[0]) select.value = collection[0].id;
    const rate = select.closest("form")?.querySelector("input[name=rate]");
    if (!current || String(current) !== select.value || (rate && !rate.value)) syncProductMeta(select);
  });
}

function syncProductMeta(select) {
  if (select.dataset.options !== "products") return;
  const product = findProduct(select.value);
  if (!product) return;
  const rateTarget = select.dataset.rateTarget ? document.getElementById(select.dataset.rateTarget) : null;
  const weightTarget = select.dataset.weightTarget ? document.getElementById(select.dataset.weightTarget) : null;
  if (rateTarget && !rateTarget.value) rateTarget.value = product.default_rate || 0;
  if (weightTarget) weightTarget.value = product.bag_weight || 50;
}

function renderMetrics() {
  const d = state.dashboard;
  const count = state.sales.filter((sale) => sale.sale_date === d.today).length;
  const lowCount = (d.low_stock || []).length;
  const metrics = [
    ["Today's sales", formatMoney(d.total_sales_today), "sales", `${count} মেমো • আজকের বিক্রি`, "featured"],
    ["Today's collection", formatMoney(d.received_today), "wallet", "ক্যাশ ও ব্যাংকে আজকের প্রাপ্তি", ""],
    ["Available stock", `${formatQty(d.current_stock)} <span class="metric-unit">Bag</span>`, "stock", `${state.products.length} পণ্য • ${lowCount}টি low stock`, ""],
    ["Customer due", formatMoney(d.customer_due), "users", `${state.customers.filter((customer) => Number(customer.current_due) > 0).length} কাস্টমারের কাছে পাওনা`, ""],
  ];
  $("#metricGrid").innerHTML = metrics.map(([label, value, image, note, style]) => `<article class="metric ${style}"><div class="metric-top"><span>${label}</span><div class="metric-icon">${icon(image)}</div></div><strong>${value}</strong><small>${escapeHtml(note)}</small></article>`).join("");
  $("#metricGrid").setAttribute("aria-busy", "false");
  $("#balanceTotal").textContent = formatMoney(Number(d.cash_balance || 0) + Number(d.bank_balance || 0));
  $("#accountLines").innerHTML = [["Cash", d.cash_balance, "wallet"], ["Bank", d.bank_balance, "bank"]].map(([label, value, image]) => `<div class="account-line"><span>${icon(image)}${label}</span><strong>${formatMoney(value)}</strong></div>`).join("");
  $("#companyPayable").textContent = formatMoney(d.company_payable);
  $("#todayOrdersCount").textContent = formatQty(d.today_orders);
  const badge = $("#stockNavCount");
  badge.textContent = lowCount;
  badge.hidden = !lowCount;
  $("#lowStockSummary").textContent = lowCount ? `${lowCount}টি পণ্যের মজুত কম • নিচে প্রথম ${Math.min(5, lowCount)}টি` : "সব পণ্যের মজুত Alert Level-এর ওপরে";
  renderCurrentClock();
}

function salesSeries(days = 7) {
  const today = state.dashboard.today || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const current = new Date(`${today}T12:00:00Z`);
  const records = new Map((state.reports.daily_sales || []).map((row) => [row.date, row]));
  return Array.from({ length: days }, (_, index) => {
    const date = new Date(current);
    date.setUTCDate(date.getUTCDate() - (days - index - 1));
    const key = date.toISOString().slice(0, 10);
    const record = records.get(key);
    return { date: key, sales: Number(record?.sales || 0), received: Number(record?.received || 0) };
  });
}

function renderSalesChart() {
  const node = $("#salesChart");
  const series = salesSeries(ui.chartPeriod);
  const total = series.reduce((sum, row) => sum + row.sales, 0);
  const max = Math.max(1, ...series.map((row) => row.sales));
  const width = Math.max(290, (node.clientWidth || 620) - 40);
  const height = 168, left = 40, top = 12, bottom = 142;
  const step = (width - left - 10) / series.length;
  const barWidth = Math.min(30, step * .48);
  const labelEvery = Math.max(1, Math.ceil(series.length / (width < 480 ? 4 : 7)));
  const axis = (number) => number >= 1000000 ? `${Math.round(number / 100000) / 10}m` : number >= 1000 ? `${Math.round(number / 100) / 10}k` : formatQty(number);
  const grid = [0, 1, 2, 3].map((i) => {
    const y = bottom - i / 3 * (bottom - top);
    return `<line class="chart-gridline" x1="${left}" x2="${width - 5}" y1="${y}" y2="${y}"/><text class="chart-axis-label" x="${left - 8}" y="${y + 3}" text-anchor="end">${axis(i / 3 * (series.some((row) => row.sales > 0) ? max : 0))}</text>`;
  }).join("");
  const bars = series.map((row, index) => {
    const x = left + index * step + step / 2;
    const barHeight = row.sales / max * (bottom - top);
    const label = new Intl.DateTimeFormat(window.AppI18n?.language === "bn" ? "bn-BD" : "en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${row.date}T12:00:00Z`));
    const showLabel = (index % labelEvery === 0 && index < series.length - labelEvery) || index === series.length - 1;
    return `<g><title>${label}: ${formatMoney(row.sales)}</title><rect class="chart-bar ${index === series.length - 1 ? "latest" : ""}" x="${x - barWidth / 2}" y="${bottom - Math.max(barHeight, 1)}" width="${barWidth}" height="${Math.max(barHeight, 1)}" rx="3"/>${showLabel ? `<text class="chart-axis-label" x="${x}" y="${bottom + 20}" text-anchor="middle">${label}</text>` : ""}</g>`;
  }).join("");
  node.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Last ${ui.chartPeriod} days sales: ${formatMoney(total)}">${grid}${bars}</svg>${total === 0 ? '<span class="chart-empty">বিক্রি যোগ করলে এখানে আপনার ট্রেন্ড দেখা যাবে।</span>' : ""}`;
  $("#chartTotal").textContent = formatMoney(total);
  $("#chartCaption").textContent = `${series[0].date} — ${series.at(-1).date} • প্রতিদিনের মোট বিক্রি (BDT)`;
}

function normalized(value) { return String(value ?? "").normalize("NFKC").toLocaleLowerCase().replace(/[০-৯]/g, (digit) => "০১২৩৪৫৬৭৮৯".indexOf(digit)); }
const listPages=new Map();
function paginateRows(kind,rows,target=`#${kind}Rows`){
  const fingerprint=[ui.search[kind]||'',JSON.stringify(window.AdvancedWorkspace?.filters||{}),rows.length,rows[0]?.id,rows.at(-1)?.id].join('|');
  let page=listPages.get(kind);if(!page||page.fingerprint!==fingerprint)page={index:0,fingerprint};
  page.total=rows.length;page.index=Math.min(page.index,Math.max(0,Math.ceil(rows.length/50)-1));listPages.set(kind,page);
  const body=document.querySelector(target),wrap=body?.closest('.table-wrap')||body?.closest('table')?.parentElement;
  if(wrap){let control=wrap.nextElementSibling;if(!control?.matches(`[data-pager="${kind}"]`)){control=document.createElement('nav');control.dataset.pager=kind;control.className='list-pagination';wrap.after(control);}
    const bn=window.AppI18n?.language==='bn';control.hidden=rows.length<=50;control.setAttribute('aria-label',bn?'তালিকার পৃষ্ঠা':'List pages');
    control.innerHTML=`<button type="button" class="button secondary" data-page-list="${kind}" data-page-step="-1" ${page.index===0?'disabled':''}>${bn?'আগের':'Previous'}</button><span>${page.index*50+1}–${Math.min((page.index+1)*50,rows.length)} / ${rows.length}</span><button type="button" class="button secondary" data-page-list="${kind}" data-page-step="1" ${(page.index+1)*50>=rows.length?'disabled':''}>${bn?'পরের':'Next'}</button>`;
  }
  return rows.slice(page.index*50,(page.index+1)*50);
}

function filteredRows(kind, rows) {
  const query = normalized(ui.search[kind] || "").trim();
  return paginateRows(kind,rows.filter((row) => {
    const text = normalized([row.name, row.product_code, row.product_name, row.customer_name, row.mobile, row.sale_date, row.order_date, row.invoice_no, memoNumber(row.id)].join(" "));
    if (query && !text.includes(query)) return false;
    if (["products","stock"].includes(kind) && ui.categoryFilters[kind] && productCategory(row) !== ui.categoryFilters[kind]) return false;
    if (window.AdvancedWorkspace && !window.AdvancedWorkspace.matches(kind, row)) return false;
    if (kind === "stock") {
      if (ui.stockFilter === "low") return Number(row.current_stock) <= Number(row.low_stock_level);
      if (ui.stockFilter === "available") return Number(row.current_stock) > 0;
      if (ui.stockFilter === "empty") return Number(row.current_stock) <= 0;
    }
    if (kind === "sales") {
      if (ui.salesFilter === "due") return Number(row.due_amount) > 0;
      if (ui.salesFilter === "paid") return Number(row.due_amount) <= 0;
    }
    return true;
  }));
}
function updateListCount(kind, total, visible) {
  visible=listPages.get(kind)?.total??visible;
  const count = $(`#${kind}Count`), result = $(`#${kind}ResultCount`);
  if (count) count.textContent = total;
  if (result) result.textContent = visible === total ? `${total}টি রেকর্ড` : `${total}টির মধ্যে ${visible}টি দেখানো হচ্ছে`;
}

function deleteButton(endpoint, id) {
  return `<button class="danger" data-delete="${endpoint}" data-id="${id}" title="Delete record">Delete</button>`;
}

function emptyRow(cols, message = "এখনও কোনো রেকর্ড নেই। নতুন তথ্য যোগ করে শুরু করুন।") {
  return `<tr><td class="empty" colspan="${cols}">${icon("box")}${message}</td></tr>`;
}

function renderDashboardTables() {
  $("#lowStockRows").innerHTML = state.dashboard.low_stock?.length
    ? state.dashboard.low_stock.slice(0, 5)
        .map(
          (row) => `
            <tr>
              <td>${recordText(row.name)}</td>
              <td class="number"><span class="pill danger">${formatQty(row.current_stock)} Bag</span></td>
              <td class="number">${formatQty(row.low_stock_level)} Bag</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(3, "এই মুহূর্তে কোনো পণ্যের মজুত কম নেই।");

  $("#recentSalesRows").innerHTML = state.sales.length
    ? state.sales
        .slice(0, 5)
        .map(
          (row) => `
            <tr>
              <td>${recordText(row.customer_name)}<span class="row-date">${escapeHtml(row.sale_date)}</span></td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td class="number">${formatMoney(row.due_amount)}</td>
              <td><button class="icon-button" data-sale-view="${row.id}" aria-label="View memo ${memoNumber(row.id)}">${icon("chevron")}</button></td>
            </tr>
          `
        )
        .join("")
    : emptyRow(4);
}

function renderSales() {
  const rows = filteredRows("sales", state.sales);
  updateListCount("sales", state.sales.length, rows.length);
  $("#salesRows").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td><strong>${memoNumber(row.id)}</strong><span class="row-date">${escapeHtml(row.sale_date)}</span></td>
              <td>${recordText(row.customer_name)}</td>
              <td>${recordText(row.product_name)}</td>
              <td class="number">${formatQty(row.quantity)}</td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td class="number">${formatMoney(row.paid_amount)}</td>
              <td class="number">${formatMoney(row.due_amount)}</td>
              <td><div class="row-actions"><button class="ghost dark" data-sale-view="${row.id}">View Memo</button><button class="ghost dark" data-sale-edit="${row.id}">Edit</button><a class="button" href="/api/sales/${row.id}/receipt" download>Memo PDF</a>${deleteButton("sales", row.id)}</div></td>
            </tr>
          `
        )
        .join("")
    : emptyRow(8);
}

function memoNumber(id) { return `AT-${String(id).padStart(6, "0")}`; }

async function openSaleView(id) {
  const sale = await api(`/api/sales/${id}`);
  const due = Math.round((Number(sale.total_amount) - Number(sale.paid_amount)) * 100) / 100;
  $("#saleMemoContent").innerHTML = `
    <article class="memo-sheet">
      <div class="memo-brand"><div class="memo-store-brand"><img class="memo-store-logo" src="/brand/arafat-growth-logo.png" alt="Arafat Traders" width="84" height="84" /><div><h3>Arafat Traders</h3><p>মোবাইল: +8801646130402</p></div></div><img class="memo-partner-logo" src="/akij-feed-logo.svg" alt="AKIJ Feed" width="140" height="58" /></div>
      <div class="memo-meta"><strong>${memoNumber(sale.id)}</strong><span>Date: ${escapeHtml(sale.sale_date)}</span></div>
      <dl class="memo-details">
        <dt>Customer</dt><dd>${recordText(sale.customer_name)}</dd>
        ${sale.customer_mobile ? `<dt>Mobile</dt><dd>${recordText(sale.customer_mobile)}</dd>` : ""}
        ${sale.customer_address ? `<dt>Address</dt><dd>${recordText(sale.customer_address)}</dd>` : ""}
        <dt>Product</dt><dd>${recordText(sale.product_name)}</dd>
        ${sale.product_code ? `<dt>Packet Code</dt><dd>${recordText(sale.product_code)}</dd>` : ""}
        <dt>Quantity</dt><dd>${formatQty(sale.quantity)} Bag</dd>
        <dt>Rate / Bag</dt><dd>${formatMoney(sale.rate)}</dd>
        <dt>Total</dt><dd><strong>${formatMoney(sale.total_amount)}</strong></dd>
        <dt>Paid at sale</dt><dd>${formatMoney(sale.paid_amount)}</dd>
        <dt>Due at sale</dt><dd>${formatMoney(due)}</dd>
        <dt>Account</dt><dd>${escapeHtml(sale.account)}</dd>
      </dl>
      ${sale.notes ? `<p class="memo-notes"><strong>Notes:</strong> ${recordText(sale.notes)}</p>` : ""}
      <p class="memo-footnote">এই মেমোতে বিক্রির সময়ের পরিশোধিত টাকা ও বাকি দেখানো হয়েছে।</p>
    </article>`;
  $("#saleMemoActions").innerHTML = `<button class="ghost dark" data-sale-edit="${sale.id}">Edit Sale</button><a class="button" href="/api/sales/${sale.id}/receipt?lang=${window.AppI18n?.language||'en'}" download>Download PDF</a>`;
  $("#saleViewDialog").showModal();
}

async function openSaleEdit(id) {
  const sale = await api(`/api/sales/${id}`);
  const form = $("#saleEditForm");
  form.reset();
  for (const select of $$("select[data-options]", form)) {
    select.innerHTML = state[select.dataset.options].map((item) => `<option translate="no" value="${item.id}">${escapeHtml(productLabel(item))}</option>`).join("");
  }
  for (const key of ["sale_date", "customer_id", "product_id", "quantity", "rate", "paid_amount", "account", "notes"]) {
    form.elements.namedItem(key).value = sale[key] ?? "";
  }
  state.editingSale = sale;
  $("#saleEditTitle").textContent = `Edit Sale — ${memoNumber(sale.id)}`;
  $("#saleEditError").textContent = "";
  updateSaleEditTotals();
  $("#saleViewDialog").close();
  $("#saleEditDialog").showModal();
}

function updateSaleEditTotals() {
  const form = $("#saleEditForm");
  const total = Math.round(Number(form.elements.namedItem("quantity").value || 0) * Number(form.elements.namedItem("rate").value || 0) * 100) / 100;
  const paid = Number(form.elements.namedItem("paid_amount").value || 0);
  $("#saleEditTotals").textContent = `Total: ${formatMoney(total)}  •  Due: ${formatMoney(total - paid)}`;
}

async function handleSaleEditSubmit(event) {
  event.preventDefault();
  const original = state.editingSale;
  if (!original) return;
  const form = event.currentTarget;
  const button = $('button[type="submit"]', form);
  button.disabled = true;
  $("#saleEditError").textContent = "";
  try {
    const data = await api(`/api/sales/${original.id}`, { method: "PATCH", body: JSON.stringify({ ...formPayload(form), original }) });
    Object.assign(state, data);
    $("#saleEditDialog").close();
    state.editingSale = null;
    renderAll();
    toast("Sale updated — stock ও হিসাব আপডেট হয়েছে।");
    await openSaleView(original.id);
  } catch (error) {
    $("#saleEditError").textContent = error.message;
    toast(error.message);
  } finally { button.disabled = false; }
}

function renderOrders() {
  const rows = filteredRows("orders", state.orders);
  updateListCount("orders", state.orders.length, rows.length);
  $("#ordersRows").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td>${row.order_date}</td>
              <td>${recordText(row.product_name)}</td>
              <td class="number">${formatQty(row.quantity)}</td>
              <td class="number">${formatMoney(row.total_amount)}</td>
              <td><span class="pill ${row.status === "Delivered" ? "" : "warning"}">${row.status}</span></td>
              <td>${recordText(row.invoice_no)}</td>
              <td>${deleteButton("orders", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(7);
}

function renderProducts() {
  for (const select of $$("[data-product-category]")) select.value = ui.categoryFilters[select.dataset.productCategory] || "";
  const collection = selectableProducts();
  const products = filteredRows("products", collection);
  const stock = filteredRows("stock", state.products);
  updateListCount("products", collection.length, products.length);
  updateListCount("stock", state.products.length, stock.length);
  $("#productsRows").innerHTML = products.length
    ? products
        .map((row) => {
          return `
            <tr>
              <td data-label="Product"><strong>${recordText(row.name)}</strong><span class="row-date product-category">${productCategoryLabel(row)}</span></td>
              <td data-label="Code"><input class="code-input" data-code-input="${row.id}" value="${escapeHtml(row.product_code || '')}" aria-label="Packet code for ${escapeHtml(row.name)}" /></td>
              <td data-label="Size">${recordText(row.feed_size || "—")}</td><td data-label="Protein (%)" class="number">${row.protein_percent == null || row.protein_percent === "" ? "—" : formatQty(row.protein_percent)+"%"}</td><td data-label="Pack Size" class="number">${formatQty(row.bag_weight)} kg</td>
              <td data-label="Default Rate">
                <div class="rate-control">
                  <input data-rate-input="${row.id}" type="number" min="0" step="0.01" value="${Number(row.default_rate || 0)}" aria-label="Default rate for ${escapeHtml(row.name)}" />
                  <button data-rate-save="${row.id}" title="Save packet code and default rate">Save</button>
                </div>
              </td>
              <td data-label="Low Alert" class="number">${formatQty(row.low_stock_level)}</td>
              <td data-label="Actions"><div class="row-actions"><button type="button" class="button secondary" data-product-edit="${row.id}">${icon("edit")}Edit</button>${deleteButton("products", row.id)}</div></td>
            </tr>
          `;
        })
        .join("")
    : emptyRow(8);
  $("#stockRows").innerHTML = stock.length ? stock.map((row) => {
    const stock = Number(row.current_stock);
    const low = stock <= Number(row.low_stock_level);
    const label = stock < 0 ? `${formatQty(Math.abs(stock))} বস্তা ঘাটতি` : `${formatQty(stock)} বস্তা আছে`;
    return `<tr><td><div class="stock-product"><div class="stock-product-heading"><div class="stock-product-details"><strong>${recordText(row.name)}</strong><span class="row-date product-category">${productCategoryLabel(row)}</span><div class="stock-product-badges"><span class="pill ${low ? "danger" : ""}">${label}</span>${row.pending ? '<span class="pill warning">Pending Sync</span>' : ""}${row.stock_conflict ? '<span class="pill danger">Review Stock Sync</span>' : ""}</div></div><button type="button" class="button secondary" data-product-edit="${row.id}" aria-label="Edit ${escapeHtml(row.name)}">${icon("edit")}Edit</button></div></div></td>
      <td>${recordText(row.product_code)}</td><td class="number">${formatQty(row.opening_stock)}</td>
      <td class="number">${formatQty(row.received_stock)}</td><td class="number">${formatQty(row.sold_stock)}</td>
      <td class="number">${formatQty(stock)}</td><td class="number">${formatQty(row.low_stock_level)}</td></tr>`;
  }).join("") : emptyRow(7);
}

function renderCustomers() {
  const rows = filteredRows("customers", state.customers);
  updateListCount("customers", state.customers.length, rows.length);
  $("#customersRows").innerHTML = rows.length
    ? rows
        .map(
          (row) => `
            <tr>
              <td><div class="customer-name-heading"><strong>${recordText(row.name)}</strong><button type="button" class="button secondary" data-customer-edit="${row.id}" aria-label="Edit ${escapeHtml(row.name)}">${icon("edit")}Edit</button></div>${row.address?`<span class="row-date customer-address">${recordText(row.address)}</span>`:""}${row.pending?'<span class="pill warning">Pending Sync</span>':""}</td>
              <td>${recordText(row.mobile)}</td>
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
    ? paginateRows("payments",state.payments)
        .map(
          (row) => `
            <tr>
              <td>${row.payment_date}</td>
              <td>${recordText(row.customer_name)}</td>
              <td class="number">${formatMoney(row.amount)}</td>
              <td>${row.account}</td>
              <td>${deleteButton("payments", row.id)}</td>
            </tr>
          `
        )
        .join("")
    : emptyRow(5);

  $("#transactionsRows").innerHTML = state.transactions.length
    ? paginateRows("transactions",state.transactions)
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
  daily_sales: ["date", "invoice_count", "bags", "sales", "return_credit", "net_sales", "received", "refunds", "net_received", "due"],
  monthly_sales: ["month", "bags", "sales", "return_credit", "net_sales", "received", "refunds", "net_received"],
  product_sales: ["name", "bags", "amount"],
  customer_sales: ["customer_id", "name", "purchase", "paid", "sale_due"],
  stock_report: ["name", "opening_stock", "received_stock", "sold_stock", "current_stock"],
  due_report: ["name", "mobile", "total_purchase", "total_paid", "current_due"],
  order_report: ["status", "order_count", "bags", "amount"],
  cash_bank: ["account", "balance"],
  return_journal: ["date", "invoice_no", "customer_id", "name", "account", "return_credit", "refunds", "reason"],
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
  return_journal: "Returns & Refunds",
};

const numericReportColumns = new Set(["return_credit", "refunds", "net_sales", "net_received", "sales", "received", "due", "amount", "purchase", "paid", "sale_due", "balance", "total_purchase", "total_paid", "current_due", "opening_due", "bags", "quantity", "opening_stock", "received_stock", "sold_stock", "current_stock", "invoice_count", "order_count"]);

function formatReportCell(key, value) {
  if (["return_credit", "refunds", "net_sales", "net_received", "sales", "received", "due", "amount", "purchase", "paid", "sale_due", "balance", "total_purchase", "total_paid", "current_due", "opening_due"].includes(key)) {
    return formatMoney(value);
  }
  if (["bags", "quantity", "opening_stock", "received_stock", "sold_stock", "current_stock"].includes(key)) {
    return formatQty(value);
  }
  return ['name', 'mobile', 'invoice_no', 'reason'].includes(key) ? recordText(value) : escapeHtml(value);
}

function renderReports() {
  const selected = $("#reportFilter")?.value || "all";
  $("#reportGrid").classList.toggle("single", selected !== "all");
  $("#reportGrid").innerHTML = Object.entries(reportSchemas)
    .filter(([name]) => selected === "all" || name === selected)
    .map(([name, columns]) => {
      const rows = state.reports[name] || [];
      return `
        <article class="report-block">
          <h2>${reportTitles[name]}</h2>
          <div class="table-wrap">
            <table>
              <thead><tr>${columns.map((column) => `<th scope="col" class="${numericReportColumns.has(column) ? "number" : ""}">${column.replaceAll("_", " ")}</th>`).join("")}</tr></thead>
              <tbody>
                ${
                  rows.length
                    ? rows
                        .map(
                          (row) => `
                            <tr>${columns
                              .map((column) => `<td class="${numericReportColumns.has(column) ? "number" : ""}">${formatReportCell(column, row[column])}</td>`)
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
  renderSalesChart();
  setSyncState("ready");
  window.AdvancedWorkspace?.render();
  window.CustomerDues?.render();
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
      body: JSON.stringify({ product_code: codeInput?.value || "", default_rate: input.value || 0, original: state.products.find(p=>String(p.id)===String(id)) }),
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

function setSyncState(status) {
  const button = $("#refreshBtn"), label = $("#lastSyncLabel"), error = $("#loadError");
  if (button) { button.disabled = status === "loading"; button.classList.toggle("is-loading", status === "loading"); }
  if (error) error.hidden = status !== "error";
  $("#syncIndicator")?.classList.toggle("is-error", status === "error");
  if (status === "ready") ui.lastSync = new Date();
  if (label) label.textContent = status === "loading" ? "আপডেট হচ্ছে..." : status === "error" ? "সংযোগ হয়নি" : `Updated ${new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Dhaka" }).format(ui.lastSync)}`;
}

function setSidebar(open, restoreFocus = true) {
  const sidebar = $("#sidebar"), mobile = window.matchMedia("(max-width: 760px)").matches;
  if (open) ui.menuTrigger = document.activeElement;
  ui.menuOpen = Boolean(open && mobile);
  sidebar.classList.toggle("is-open", ui.menuOpen);
  sidebar.inert = mobile && !ui.menuOpen;
  $("#sidebarScrim").hidden = !ui.menuOpen;
  $("#menuBtn").setAttribute("aria-expanded", String(ui.menuOpen));
  $("#mobileMore").setAttribute("aria-expanded", String(ui.menuOpen));
  if (ui.menuOpen) { sidebar.setAttribute("role", "dialog"); sidebar.setAttribute("aria-modal", "true"); }
  else { sidebar.removeAttribute("role"); sidebar.removeAttribute("aria-modal"); }
  $(".workspace-main").inert = ui.menuOpen;
  $(".mobile-nav").inert = ui.menuOpen;
  document.body.style.overflow = ui.menuOpen ? "hidden" : "";
  if (ui.menuOpen) sidebar.querySelector("[data-tab].active")?.focus();
  else if (restoreFocus && mobile && ui.menuTrigger) ui.menuTrigger.focus();
}

const pageActions = {
  dashboard: {label:"New Sale",page:"sales",entry:"sales"},
  sales: {label:"New Sale",page:"sales",entry:"sales"},
  orders: {label:"New Order",page:"orders",entry:"orders"},
  products: {label:"New Product",page:"products",entry:"products"},
  stock: {label:"Adjust Stock",page:"stock",entry:"adjustments"},
  customers: {label:"New Customer",page:"customers",entry:"customers"},
  dues: {label:"Receive Payment",page:"dues"},
  money: {label:"Receive Payment",page:"money",entry:"payments"},
  reports: {label:"Select Report",icon:"filter"},
  expenses: {label:"Record Expense",page:"expenses",entry:"expenses"},
  settings: {label:"Save Settings",icon:"check"},
};
function updatePageAction(page) {
  const button = $("#pageActionButton"), action = pageActions[page];
  if (!button || !action) return;
  button.innerHTML = `${icon(action.icon || "plus")}<span>${action.label}</span>`;
  button.setAttribute("aria-label", action.label);
}
function performPageAction() {
  const action = pageActions[ui.active];
  if (!action) return;
  if (ui.active === "dues") { window.CustomerDues?.startPayment(); }
  else if (ui.active === "reports") { const select = $("#reportFilter"); select.scrollIntoView({block:"center",behavior:"smooth"}); select.focus({preventScroll:true}); }
  else if (ui.active === "settings") { const form = $("#settingsForm"); if (form.dataset.version) form.requestSubmit(); else toast("Load Settings before saving."); }
  else if (action.page === "sales" && window.AdvancedWorkspace?.startNewSale) window.AdvancedWorkspace.startNewSale().catch(error=>toast(error.message));
  else navigateTo(action.page, action.entry);
}
function renderCurrentClock(now = new Date()) {
  const node = $("#currentDateTime");
  if (!node) return;
  node.dateTime = now.toISOString();
  const bangla = window.AppI18n?.language === 'bn', locale = bangla ? 'bn-BD' : 'en-GB';
  $("[data-current-date]",node).textContent = new Intl.DateTimeFormat(locale,{timeZone:"Asia/Dhaka",weekday:"long",day:"2-digit",month:"short",year:"numeric"}).format(now);
  $("[data-current-time]",node).textContent = new Intl.DateTimeFormat(locale,{timeZone:"Asia/Dhaka",hour:"2-digit",minute:"2-digit",second:"2-digit",hourCycle:"h12"}).format(now) + (bangla ? " · বাংলাদেশ সময়" : " · BDT");
}

function updateBackButton() {
  const status = window.WorkspaceStore?.status();
  const authenticated = !!state.user && !status?.signedOut && !status?.locked;
  $("#backButton").disabled = !authenticated || (!ui.navigationHistory.length && ui.active === "dashboard");
}
function resetNavigationHistory() {
  ui.navigationHistory = [];
  ui.navigationReady = false;
  updateBackButton();
}
function goBack() {
  if ($("#backButton").disabled) return;
  const previous = ui.navigationHistory.pop() || {page: "dashboard", scrollY: 0};
  navigateTo(previous.page, false, false);
  window.scrollTo({top: previous.scrollY, behavior: "instant"});
}
function navigateTo(page, quick = false, remember = true) {
  if (!pages[page]) return;
  if (remember && ui.navigationReady && page !== ui.active) {
    ui.navigationHistory.push({page: ui.active, scrollY: window.scrollY});
    if (ui.navigationHistory.length > 50) ui.navigationHistory.shift();
  }
  ui.navigationReady = true;
  ui.active = page;
  updateBackButton();
  $$(".view").forEach((view) => view.classList.toggle("active", view.id === page));
  $$("[data-tab]").forEach((button) => {
    const active = button.dataset.tab === page;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page"); else button.removeAttribute("aria-current");
  });
  $("#mobileMore").classList.toggle("active", !["dashboard", "sales", "stock", "reports"].includes(page));
  const [label, title, description, eyebrow] = pages[page];
  $("#activeSectionLabel").textContent = label;
  $("#pageTitle").innerHTML = `${title}<span class="heading-dot">.</span>`;
  $("#pageDescription").textContent = description;
  $("#pageEyebrow").textContent = eyebrow;
  updatePageAction(page);
  document.title = `${label} | Arafat Traders`;
  window.history.replaceState(null, "", `#${page}`);
  setSidebar(false, false);
  window.scrollTo({ top: 0, behavior: "instant" });
  if (page === "dashboard" && ui.lastSync) renderSalesChart();
  if (quick) {
    const target = document.getElementById(`entry-${quick === true ? page : quick}`);
    if (target) { target.open = true; target.scrollIntoView({ block: "start", behavior: "smooth" }); target.querySelector("input,select")?.focus({ preventScroll: true }); }
  }
}

function openSearch() {
  setSidebar(false, false);
  $("#searchDialog").showModal();
  $("#globalSearch").value = "";
  renderSearchResults();
  $("#globalSearch").focus();
}

function searchRecords(value) {
  const query = normalized(value).trim();
  if (!query) return [];
  const results = [];
  for (const product of state.products) if (normalized(`${product.name} ${product.product_code}`).includes(query)) results.push({ type: "products", id: product.id, label: product.name, description: `${product.product_code || window.AppI18n.text("Product")} • ${window.AppI18n.text(formatQty(product.current_stock) + " Bag available")}`, icon: "box" });
  for (const customer of state.customers) if (normalized(`${customer.name} ${customer.mobile}`).includes(query)) results.push({ type: "customers", id: customer.id, label: customer.name, description: `${customer.mobile || window.AppI18n.text("Customer")} • ${window.AppI18n.text("Due")} ${formatMoney(customer.current_due)}`, icon: "users" });
  if (Array.isArray(state.invoices)) {
    for (const invoice of state.invoices) if (normalized(`${invoice.invoice_no} ${invoice.customer_name} ${invoice.sale_date} ${(invoice.items||[]).map(item=>`${item.product_name} ${item.product_code||''}`).join(' ')}`).includes(query)) results.push({type:'sales',id:invoice.id,label:`${invoice.invoice_no} • ${invoice.customer_name}`,description:`${invoice.sale_date} • ${formatMoney(invoice.status==='void'?0:invoice.total_amount-Number(invoice.returned_total||0))}`,icon:'receipt'});
  } else for (const sale of state.sales) if (normalized(`${memoNumber(sale.id)} ${sale.customer_name} ${sale.product_name} ${sale.sale_date}`).includes(query)) results.push({ type: "sales", id: sale.id, label: `${memoNumber(sale.id)} • ${sale.customer_name}`, description: `${sale.sale_date} • ${formatMoney(sale.total_amount)}`, icon: "receipt" });
  return results.slice(0, 12);
}

function renderSearchResults() {
  const value = $("#globalSearch").value;
  const records = searchRecords(value);
  $("#searchResults").innerHTML = records.length ? records.map((record) => `<button class="search-result" data-search-type="${record.type}" data-search-id="${record.id}">${icon(record.icon)}<span><strong>${recordText(record.label)}</strong><small>${recordText(record.description)}</small></span>${icon("chevron")}</button>`).join("") : `<p class="search-hint">${value.trim() ? "এই নামে কোনো পণ্য, কাস্টমার বা মেমো পাওয়া যায়নি।" : "নাম, প্যাকেট কোড বা মেমো নম্বর লিখুন।"}</p>`;
}

function syncTransferForm(form) {
  const type=form.elements.type.value,transfer=['Bank Deposit','Bank Withdraw'].includes(type);
  const account=form.elements.account;account.disabled=transfer;
  if(transfer)account.value=type==='Bank Deposit'?'Cash':'Bank';
  const hint=form.querySelector('[data-transfer-hint]');
  if(hint){hint.hidden=!transfer;hint.innerHTML=transfer?`<span>${type==='Bank Deposit'?'Cash → Bank':'Bank → Cash'}</span><span> · </span><span>Both accounts update together.</span>`:'';window.AppI18n?.apply(hint);}
}

function bindEvents() {
  document.addEventListener('click',event=>{const button=event.target.closest('[data-page-list]');if(!button)return;const page=listPages.get(button.dataset.pageList);if(page){page.index+=Number(button.dataset.pageStep);renderAll();}});
  const transferForm=document.querySelector('form[data-endpoint="transactions"]');
  if(transferForm){
    transferForm.elements.type.addEventListener('change',()=>syncTransferForm(transferForm));
    transferForm.addEventListener('reset',()=>setTimeout(()=>syncTransferForm(transferForm),0));
    syncTransferForm(transferForm);
  }
  $("#backButton").addEventListener("click", goBack);
  $("#pageActionButton").addEventListener("click", performPageAction);
  renderCurrentClock();
  setInterval(renderCurrentClock, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) renderCurrentClock(); });
  $("#menuBtn").addEventListener("click", () => setSidebar(!ui.menuOpen));
  $("#mobileMore").addEventListener("click", () => setSidebar(!ui.menuOpen));
  $("#closeSidebarBtn").addEventListener("click", () => setSidebar(false));
  $("#sidebarScrim").addEventListener("click", () => setSidebar(false));
  $("#searchBtn").addEventListener("click", openSearch);
  $("#globalSearch").addEventListener("input", renderSearchResults);
  $("#chartPeriod").addEventListener("change", (event) => { ui.chartPeriod = Number(event.target.value); renderSalesChart(); });
  $$("[data-product-category]").forEach(select => select.addEventListener("change", () => { ui.categoryFilters[select.dataset.productCategory] = select.value; renderProducts(); window.AppI18n?.apply(); }));
  $("#stockFilter").addEventListener("change", (event) => { ui.stockFilter = event.target.value; renderProducts(); });
  $("#salesFilter").addEventListener("change", (event) => { ui.salesFilter = event.target.value; renderSales(); });
  $("#reportFilter").addEventListener("change", renderReports);
  $$("[data-table-search]").forEach((input) => input.addEventListener("input", () => {
    const kind = input.dataset.tableSearch;
    ui.search[kind] = input.value;
    ({ sales: renderSales, orders: renderOrders, products: renderProducts, stock: renderProducts, customers: renderCustomers })[kind]();
  }));
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !$("dialog[open]")) { event.preventDefault(); openSearch(); }
    if (event.key === "Escape" && ui.menuOpen) { event.preventDefault(); setSidebar(false); }
    if (event.key === "Tab" && ui.menuOpen) {
      const targets = $$("button:not(:disabled), a[href], select, input", $("#sidebar")).filter(el => el.getClientRects().length);
      const first = targets[0], last = targets[targets.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  });
  window.matchMedia("(max-width: 760px)").addEventListener("change", () => setSidebar(false, false));
  if (typeof ResizeObserver !== "undefined") {
    let chartWidth = 0;
    new ResizeObserver((entries) => { const width = entries[0].contentRect.width; if (width > 0 && width !== chartWidth && ui.lastSync) { chartWidth = width; renderSalesChart(); } }).observe($("#salesChart"));
  }
  navigateTo(window.location.hash.slice(1) || "dashboard");

  $("#saleEditForm").addEventListener("submit", handleSaleEditSubmit);
  $("#saleEditForm").addEventListener("input", updateSaleEditTotals);
  $$(".entry-form[data-endpoint]").forEach((form) => form.addEventListener("submit", handleSubmit));

  document.addEventListener("click", async (event) => {
    const navigation = event.target.closest("[data-tab], [data-go], [data-quick]");
    if (navigation) {
      event.preventDefault();
      const quick = navigation.dataset.quick;
      navigateTo(navigation.dataset.tab || navigation.dataset.go || (quick === "payments" ? "money" : quick), quick || false);
      return;
    }
    const result = event.target.closest("[data-search-type]");
    if (result) {
      $("#searchDialog").close();
      const type = result.dataset.searchType, id = type === 'sales' ? result.dataset.searchId : Number(result.dataset.searchId);
      if (type === "sales") {
        navigateTo("sales");
        try { await openSaleView(id); } catch (error) { toast(error.message); }
      } else {
        const row = state[type].find((item) => item.id === id);
        if (row) {
          ui.search[type] = row.name;
          $(`[data-table-search="${type}"]`).value = row.name;
          navigateTo(type);
          if (type === "products") renderProducts(); else renderCustomers();
          $(`#${type} .data-toolbar`).scrollIntoView({ block: "start", behavior: "smooth" });
        }
      }
      return;
    }
    const close = event.target.closest("[data-close-dialog]");
    if (close) { close.closest("dialog").close(); return; }
    const saleButton = event.target.closest("[data-sale-view], [data-sale-edit]");
    if (saleButton) {
      saleButton.disabled = true;
      try {
        if (saleButton.dataset.saleView) await openSaleView(saleButton.dataset.saleView);
        else await openSaleEdit(saleButton.dataset.saleEdit);
      } catch (error) { toast(error.message); }
      finally { saleButton.disabled = false; }
      return;
    }
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
      if (select.closest("#saleEditForm")) updateSaleEditTotals();
    }
  });

  $("#refreshBtn").addEventListener("click", () => load().then(() => toast("Refreshed")).catch((error) => toast(error.message)));
  $("#syncAkijBtn")?.addEventListener("click", handleAkijSync);
}

// Shared with the classic scripts usability.js and advanced.js.
Object.assign(globalThis, { productSpecifications, resetNavigationHistory });

bindEvents();
load().catch((error) => toast(error.message));
