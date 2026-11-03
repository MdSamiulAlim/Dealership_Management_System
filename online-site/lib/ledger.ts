import queries from "./queries.json" with { type: "json" };
import initialRecords from "./initial-records.json" with { type: "json" };

import type { Payload, SqlRow, ProductRecord, ProductStock, CustomerRecord, CustomerBalance, SaleRecord, OrderRecord, PaymentRecord, AdjustmentRecord, TransactionRecord } from "./records.ts";
type Value = string | number | null;
const seedKey = "initial_records_v1";
const initialized = new WeakMap<D1Database, Promise<void>>();

export class InputError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export function today() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function money(value: unknown = 0): number {
  if (typeof value !== "number" && typeof value !== "string" && value != null) throw new InputError("Enter a valid amount or quantity.");
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || Math.abs(number) > 1e12) throw new InputError("Enter a valid amount or quantity.");
  return Math.round((number + Number.EPSILON) * 100) / 100;
}

// New bag-count inputs are validated before any monetary rounding.
export function wholeBags(value: unknown = 0, label = "Quantity", minimum = -1e12): number {
  const n = Number(value);
  if (!["number","string"].includes(typeof value) || value === null || (typeof value === "string" && !value.trim()) || !Number.isSafeInteger(n) || Math.abs(n) > 1e12 || n < minimum) {
    throw new InputError(`${label} must be a whole number${minimum === 1 ? " greater than zero" : minimum === 0 ? " of zero or more" : ""}.`);
  }
  return n;
}

export function validDate(value: unknown, optional = false): string {
  const s = String(value ?? "").trim();
  if (optional && !s) return "";
  if (s.startsWith("0000-") || !/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0,10) !== s) throw new InputError("Enter a valid date.");
  return s;
}
export function nonnegative(value: unknown, label = "Amount") {
  const n = money(value); if (Number(value) < 0) throw new InputError(`${label} cannot be negative.`); return n;
}
export function positive(value: unknown, label = "Amount") {
  const n = money(value); if (n <= 0) throw new InputError(`${label} must be greater than zero.`); return n;
}
export function choice(value: unknown, choices: string[], fallback = "") {
  const result = String(value ?? fallback).trim() || fallback;
  if (!choices.includes(result)) throw new InputError(`Choose ${choices.join(" or ")}.`);
  return result;
}
export const account = (value: unknown) => choice(value, ["Cash", "Bank"], "Cash");
export function calculatedTotal(p: Payload, total: number) {
  if (p.total_amount !== undefined && p.total_amount !== "" && money(p.total_amount) !== total) throw new InputError("Total must match the calculated quantity and rate.");
  return total;
}
export function integrityError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);
  if (/insufficient_stock/.test(message)) throw new InputError("Insufficient stock. Refresh stock and reduce the quantity before saving.",409);
  if (/linked_record/.test(message)) throw new InputError("This record has transactions and cannot be deleted. Keep it for the account history.",409);
  if (/UNIQUE constraint failed: invoices\.invoice_no/.test(message)) throw new InputError("This invoice number is already in use. Choose another number.",409);
  throw error;
}

export function customerUpdate(current: Pick<CustomerRecord,"name"|"mobile"|"address">, patch: Payload) {
  if ("opening_due" in patch || "current_due" in patch) throw new InputError("Use customer payments to change account balances.");
  const next = {name:String(patch.name ?? current.name).trim(),mobile:String(patch.mobile ?? current.mobile ?? "").trim(),address:String(patch.address ?? current.address ?? "").trim()};
  if (!next.name || next.name.length > 200 || next.mobile.length > 50 || next.address.length > 1000) throw new InputError("Enter a customer name (up to 200), mobile (up to 50) and address (up to 1000 characters).");
  return next;
}

const text = (value: unknown) => String(value ?? "").trim();
export const recordId = (value: unknown) => {
  if(!["number","string"].includes(typeof value)) throw new InputError("Choose a valid record.");
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result <= 0) throw new InputError("Choose a valid record.");
  return result;
};

export const productCategories = ["Fish feed", "Cattle feed", "Poultry feed"];
export function inferProductCategory(value: unknown) {
  const name = String(value ?? "").toLocaleLowerCase();
  if (/\b(?:cattle|beef|dairy|cow)\b|গরু/.test(name)) return "Cattle feed";
  if (/\b(?:poultry|broiler|layer|sonali|cock|chicken|duck|quail)\b|মুরগি|হাঁস|কোয়েল/.test(name)) return "Poultry feed";
  if (/\b(?:fish|tilapia|pangus|pangas|carp|koi|sing|pabda|gulsha|galda|shrimp|hatchery|nursery|common|floating|sinking)\b|মাছ|তেলাপিয়া|পাঙ্গাস|কার্প|পাবদা|শিং|চিংড়ি/.test(name)) return "Fish feed";
  return "";
}

async function categorizeLegacyProducts(db: D1Database) {
  const key = "product_categories_v1";
  if (await db.prepare("SELECT value FROM app_meta WHERE key=?").bind(key).first()) return;
  const rows = await db.prepare("SELECT id,name FROM products WHERE category='' ").all<Pick<ProductRecord,"id"|"name">>();
  const statements = rows.results.flatMap(row => {
    const category = inferProductCategory(row.name);
    return category ? [db.prepare("UPDATE products SET category=? WHERE id=? AND category='' AND NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?)").bind(category,row.id,key)] : [];
  });
  statements.push(db.prepare("INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)").bind(key,"classified"));
  await db.batch(statements);
}

const id=recordId;

function requireFields(payload: Payload, fields: string[]) {
  const missing = fields.filter((field) => text(payload[field]) === "");
  if (missing.length) throw new InputError(`Missing required field: ${missing.join(", ")}`);
}

async function seed(db: D1Database) {
  const existing = await db.prepare("SELECT value FROM app_meta WHERE key = ?").bind(seedKey).first();
  if (existing) return;
  const statements: D1PreparedStatement[] = [];
  for (const [table, records] of Object.entries(initialRecords)) {
    const rows: SqlRow[] = records;
    if (!rows.length) continue;
    const columns = Object.keys(rows[0]);
    const chunkSize = Math.max(1, Math.floor(90 / columns.length));
    for (let offset = 0; offset < rows.length; offset += chunkSize) {
      const chunk = rows.slice(offset, offset + chunkSize);
      const placeholders = chunk.map(() => `(${columns.map(() => "?").join(",")})`).join(",");
      const sql = `INSERT OR IGNORE INTO ${table} (${columns.join(",")}) SELECT * FROM (VALUES ${placeholders}) WHERE NOT EXISTS (SELECT 1 FROM app_meta WHERE key = '${seedKey}')`;
      statements.push(db.prepare(sql).bind(...chunk.flatMap((row) => columns.map((column) => row[column]))));
    }
  }
  statements.push(db.prepare("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?,?)").bind(seedKey, "imported"));
  // Runtime seed data stays separate from schema migrations. The marker guards
  // simultaneous first visits, and the batch commits all records atomically.
  await db.batch(statements);
}

// Repair the old single-sided transfer representation once. Each original row
// gets one counterpart and a stable link in the same guarded database batch.
async function repairTransfers(db:D1Database){
 const marker='balanced_transfers_v1';
 if(await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(marker).first())return;
 const {results:rows}=await db.prepare("SELECT * FROM transactions WHERE transfer_id IS NULL AND type IN ('Bank Deposit','Bank Withdraw') ORDER BY id").all<TransactionRecord>();
 const unused=new Set(rows.map(r=>r.id)),statements:D1PreparedStatement[]=[];
 for(const row of rows){
  if(!unused.delete(row.id))continue;
  // Older imports sometimes already contain both entries. Match occurrences,
  // rather than doubling an existing balanced transfer during the repair.
  const partner=rows.find(r=>unused.has(r.id)&&r.account!==row.account&&['txn_date','type','amount','notes','category','reference'].every(field=>r[field as keyof TransactionRecord]===row[field as keyof TransactionRecord]));
  const ids=[row.id];if(partner){ids.push(partner.id);unused.delete(partner.id);}
  const transferId='legacy-transfer-'+row.id;
  for(const id of ids)statements.push(db.prepare('UPDATE transactions SET transfer_id=? WHERE id=? AND transfer_id IS NULL AND NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?)').bind(transferId,id,marker));
 }
 statements.push(db.prepare(`INSERT INTO transactions(txn_date,type,amount,account,notes,category,reference,transfer_id)
   SELECT t.txn_date,t.type,t.amount,CASE t.account WHEN 'Cash' THEN 'Bank' ELSE 'Cash' END,t.notes,t.category,t.reference,t.transfer_id
   FROM transactions t WHERE t.transfer_id IS NOT NULL AND t.type IN ('Bank Deposit','Bank Withdraw')
   AND NOT EXISTS(SELECT 1 FROM transactions other WHERE other.transfer_id=t.transfer_id AND other.account<>t.account)
   AND NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?)`).bind(marker));
 statements.push(db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)').bind(marker,'balanced'));
 await db.batch(statements);
}
export const isTransfer=(p:Payload)=>p.type==='Bank Deposit'||p.type==='Bank Withdraw';
export function prepareTransfer(db:D1Database,p:Payload,transferId=crypto.randomUUID()){
 // The type defines the direction; the old account selector is not a second
 // independent operation. Validate every field before preparing either side.
 prepareInsert(db,'transactions',p);
 const source=p.type==='Bank Deposit'?'Cash':'Bank';
 return [source,source==='Cash'?'Bank':'Cash'].map(side=>db.prepare('INSERT INTO transactions(txn_date,type,amount,account,notes,category,reference,transfer_id) VALUES (?,?,?,?,?,?,?,?)').bind(validDate(p.txn_date),p.type,positive(p.amount),side,text(p.notes),text(p.category)||'General',text(p.reference),transferId));
}

export async function ensureSeeded(db: D1Database) {
  let pending = initialized.get(db);
  if (!pending) {
    pending = seed(db).then(() => categorizeLegacyProducts(db)).then(() => repairTransfers(db)).catch((error) => { initialized.delete(db); throw error; });
    initialized.set(db, pending);
  }
  return pending;
}

export async function bootstrap(db: D1Database, date = today()) {
  await ensureSeeded(db);
  const definitions: { group: string; key: string; sql: string; params: Value[] }[] = [];
  for (const [key, sql] of Object.entries(queries.joined_rows)) {
    definitions.push({ group: "rows", key, sql, params: [] });
  }
  for (const [key, sql] of Object.entries(queries.reports)) {
    if (key !== "stock_report" && key !== "due_report") definitions.push({ group: "reports", key, sql, params: [] });
  }
  for (const [key, sql] of Object.entries(queries.dashboard)) {
    const params = key === "received_today" ? [date, date] :
      (key === "total_sales_today" || key === "today_orders") ? [date] : [];
    definitions.push({ group: "dashboard", key, sql, params });
  }
  const results = await db.batch(definitions.map(({ sql, params }) => db.prepare(sql).bind(...params)));
  const records: Record<string, SqlRow[]> = {};
  const reports: Record<string, SqlRow[]> = {};
  const dashboard = {} as Record<keyof typeof queries.dashboard, number>;
  definitions.forEach(({ group, key }, index) => {
    const rows = results[index].results as SqlRow[];
    if (group === "rows") records[key] = rows;
    else if (group === "reports") reports[key] = rows;
    else dashboard[key as keyof typeof dashboard] = money(rows[0] ? Object.values(rows[0])[0] : 0);
  });
  const data = {
    ...records,
    products: records.products as ProductStock[],
    customers: records.customers as CustomerBalance[],
    sales: records.sales as SaleRecord[],
    orders: records.orders as OrderRecord[],
    payments: records.payments as PaymentRecord[],
    adjustments: records.adjustments as AdjustmentRecord[],
    transactions: records.transactions as TransactionRecord[],
    dashboard: { ...dashboard, today: date, current_stock: 0, low_stock: [] as ProductStock[] },
    reports,
  };
  data.dashboard.current_stock = money(data.products.reduce((sum: number, p: ProductStock) => sum + money(p.current_stock), 0));
  data.dashboard.low_stock = data.products.filter((p: ProductStock) => money(p.current_stock) <= money(p.low_stock_level));
  data.reports.stock_report = data.products;
  data.reports.due_report = data.customers;
  data.reports.cash_bank = [
    { account: "Cash", balance: data.dashboard.cash_balance },
    { account: "Bank", balance: data.dashboard.bank_balance },
  ];
  return data;
}

const entities: Record<string, string> = {
  products: "product", customers: "customer", orders: "order", sales: "sale",
  payments: "payment", adjustments: "adjustment", transactions: "transaction",
};

export function prepareInsert(db: D1Database, entity: string, p: Payload) {
  const kind = entities[entity] as keyof typeof queries.inserts;
  if (!kind) throw new InputError("Not found", 404);
  let values: Value[];
  if (kind === "product") {
    const next=productUpdate({name:"",product_code:"",bag_weight:50,default_rate:0,low_stock_level:5},Object.fromEntries(Object.entries(p).filter(([key])=>key!=="opening_stock")));
    values=[next.name,next.product_code,next.bag_weight,wholeBags(p.opening_stock??0,"Opening Stock",0),next.default_rate,next.low_stock_level,next.category,next.feed_size,next.protein_percent];
  } else if (kind === "customer") {
    const next=customerUpdate({name:"",mobile:"",address:""},{name:p.name,mobile:p.mobile,address:p.address});
    values=[next.name,next.mobile,next.address,money(p.opening_due)];
  } else if (kind === "order") {
    requireFields(p,["order_date","product_id","quantity","rate"]);
    const quantity=wholeBags(p.quantity,"Quantity",1),rate=nonnegative(p.rate,"Rate");
    values=[validDate(p.order_date),id(p.product_id),quantity,positive(p.bag_weight??50,"Bag weight"),rate,
      calculatedTotal(p,money(quantity*rate)),choice(p.status,["Pending","Confirmed","Delivered"],"Pending"),validDate(p.delivery_date,true),text(p.invoice_no),text(p.notes)];
  } else if (kind === "sale") {
    requireFields(p,["sale_date","customer_id","product_id","quantity","rate"]);
    const quantity=wholeBags(p.quantity,"Quantity",1),rate=nonnegative(p.rate,"Rate"),total=calculatedTotal(p,money(quantity*rate)),paid=nonnegative(p.paid_amount,"Paid amount");
    if(paid>total)throw new InputError("Paid amount cannot exceed the sale total.");
    values=[validDate(p.sale_date),id(p.customer_id),id(p.product_id),quantity,rate,total,paid,account(p.account),text(p.notes)];
  } else if (kind === "payment") {
    requireFields(p,["payment_date","customer_id","amount"]);
    values=[validDate(p.payment_date),id(p.customer_id),positive(p.amount),account(p.account),text(p.notes)];
  } else if (kind === "adjustment") {
    requireFields(p,["adjust_date","product_id","type","quantity"]);
    values=[validDate(p.adjust_date),id(p.product_id),choice(p.type,["Return","Damage","Loss","Manual Add","Manual Minus"]),wholeBags(p.quantity,"Quantity",1),text(p.notes)];
  } else {
    requireFields(p,["txn_date","type","amount"]);
    values=[validDate(p.txn_date),choice(p.type,["Company Payment","Expense","Transport Cost","Other Income","Other Expense","Bank Deposit","Bank Withdraw"]),positive(p.amount),account(p.account),text(p.notes)];
  }
  return db.prepare(queries.inserts[kind]).bind(...values);
}

export async function requireActiveProduct(db:D1Database,productId:unknown){
  const row=await db.prepare("SELECT archived FROM products WHERE id=?").bind(id(productId)).first<{archived:number}>();
  if(!row)throw new InputError("Product not found",404);
  if(row.archived)throw new InputError("This product is archived. Choose a current product.",409);
}

export async function insertRecord(db: D1Database, entity: string, p: Payload) {
  await ensureSeeded(db);
  if(["orders","sales","adjustments"].includes(entity))await requireActiveProduct(db,p.product_id);
  try { if(entity==='transactions'&&isTransfer(p)){const result=await db.batch(prepareTransfer(db,p));return result[0];}return await prepareInsert(db, entity, p).run(); } catch(error) { integrityError(error); }
}

// Product metadata edits never rewrite physical stock or historical sales.
export function productUpdate(current: Pick<ProductRecord,"name"|"product_code"|"bag_weight"|"default_rate"|"low_stock_level"> & Partial<Pick<ProductRecord,"category"|"feed_size"|"protein_percent">>, patch: Payload) {
  if (["opening_stock", "current_stock", "received_stock", "sold_stock"].some(field => field in patch)) {
    throw new InputError("Use Stock Adjustment to change stock quantities.");
  }
  const protein = patch.protein_percent === undefined ? current.protein_percent ?? null : patch.protein_percent === "" || patch.protein_percent === null ? null : money(patch.protein_percent);
  const size = text(patch.feed_size === undefined ? current.feed_size : patch.feed_size);
  if (size.length > 100 || (protein !== null && (Number(patch.protein_percent ?? protein) < 0 || Number(patch.protein_percent ?? protein) > 100))) throw new InputError("Enter a size up to 100 characters and protein between 0 and 100 percent.");
  const next = {
    feed_size: size, protein_percent: protein,
    category: patch.category === undefined ? (current.category || inferProductCategory(patch.name ?? current.name)) : choice(patch.category,productCategories),
    name: patch.name === undefined ? current.name : text(patch.name),
    product_code: patch.product_code === undefined ? current.product_code : text(patch.product_code),
    bag_weight: money(patch.bag_weight === undefined ? current.bag_weight : patch.bag_weight),
    default_rate: nonnegative(patch.default_rate === undefined ? current.default_rate : patch.default_rate,"Rate"),
    low_stock_level: patch.low_stock_level === undefined ? money(current.low_stock_level) : wholeBags(patch.low_stock_level,"Low Stock Alert",0),
  };
  if (!next.name || next.name.length > 200 || next.product_code.length > 100) throw new InputError("Enter a product name (up to 200 characters) and packet code (up to 100).");
  if (next.bag_weight <= 0 || next.default_rate < 0 || next.low_stock_level < 0) throw new InputError("Bag weight must be positive; rate and Low Stock Alert cannot be negative.");
  return next;
}

export async function updateProduct(db: D1Database, productId: unknown, p: Payload) {
  await ensureSeeded(db);
  const current = await db.prepare("SELECT * FROM products WHERE id = ?").bind(id(productId)).first<ProductRecord>();
  if (!current) throw new InputError("Product not found", 404);
  if(current.archived)throw new InputError("This product is archived. Choose a current product.",409);
  const columns=Object.keys(current);
  const original=p.original as Payload;
  if(!p.original || typeof p.original!=="object" || columns.some(key=>!(key in original)||!(original[key]===null||["string","number"].includes(typeof original[key])))) throw new InputError("Reload the complete product before editing.",409);
  const next = productUpdate(current, p);
  const result=await db.prepare(`UPDATE products SET name=?,product_code=?,bag_weight=?,default_rate=?,low_stock_level=?,category=?,feed_size=?,protein_percent=? WHERE id=? AND ${columns.map(key=>`${key} IS ?`).join(" AND ")}`)
    .bind(next.name,next.product_code,next.bag_weight,next.default_rate,next.low_stock_level,next.category,next.feed_size,next.protein_percent,id(productId),...columns.map(key=>original[key])).run();
  if(!result.meta.changes)throw new InputError("This product changed on another device. Reopen Edit to load the latest record.",409);
}

// Apply the owner's threshold mapping once, atomically, across all devices.
const alertUpdateKey = "alert_levels_2026_10_18_20_to_10_10_to_5_v1";
export async function applyAlertLevelUpdate(db: D1Database) {
  await ensureSeeded(db);
  await db.batch([
    db.prepare(`UPDATE products SET low_stock_level = CASE low_stock_level WHEN 20 THEN 10 WHEN 10 THEN 5 END
      WHERE low_stock_level IN (20, 10) AND NOT EXISTS (SELECT 1 FROM app_meta WHERE key = ?)`)
      .bind(alertUpdateKey),
    db.prepare("INSERT OR IGNORE INTO app_meta (key, value) VALUES (?, ?)").bind(alertUpdateKey, "applied"),
  ]);
}

export async function updateSale(db: D1Database, saleId: unknown, p: Payload) {
  await ensureSeeded(db);
  if(!await db.prepare("SELECT id FROM sales WHERE id=?").bind(id(saleId)).first())throw new InputError("Sale not found",404);
  requireFields(p, ["sale_date", "customer_id", "product_id", "quantity", "rate"]);
  const date = validDate(p.sale_date);
  const quantity = wholeBags(p.quantity,"Quantity",1), rate = nonnegative(p.rate,"Rate"), paid = nonnegative(p.paid_amount,"Paid amount");
  if (quantity <= 0 || rate < 0 || paid < 0) throw new InputError("Quantity must be greater than zero; rate and paid cannot be negative.");
  const total = calculatedTotal(p, money(quantity * rate));
  if (paid > total) throw new InputError("Paid amount cannot exceed the sale total.");
  const account = text(p.account) || "Cash";
  if (!["Cash", "Bank"].includes(account)) throw new InputError("Choose Cash or Bank.");
  const columns = ["sale_date", "customer_id", "product_id", "quantity", "rate", "total_amount", "paid_amount", "account", "notes"];
  const values: Value[] = [date, id(p.customer_id), id(p.product_id), quantity, rate, total, paid, account, text(p.notes), id(saleId)];
  let condition = "id = ?";
  if (!p.original || typeof p.original !== "object") throw new InputError("Reload the complete sale before editing.",409);
  if (p.original) {
    const original=p.original as Payload;
    if (typeof p.original !== "object" || columns.some((key) => !(key in original))) throw new InputError("Reload the sale before editing.");
    condition += " AND " + columns.map((key) => `${key} IS ?`).join(" AND ");
    values.push(...columns.map((key) => original[key] as Value));
  }
  let result;
  try { result = await db.prepare(`UPDATE sales SET ${columns.map((key) => `${key} = ?`).join(", ")} WHERE ${condition}`).bind(...values).run(); } catch(error) { integrityError(error); }
  if (!result.meta.changes) {
    const current = await db.prepare("SELECT id FROM sales WHERE id = ?").bind(id(saleId)).first();
    throw new InputError(current ? "This sale changed on another device. Reopen Edit to load the latest record." : "Sale not found", current ? 409 : 404);
  }
}

const deleteTables: Record<string, string> = {
  products: "products", customers: "customers", orders: "company_orders", sales: "sales",
  payments: "customer_payments", adjustments: "stock_adjustments", transactions: "transactions",
};

export async function deleteRecord(db: D1Database, entity: string, recordId: unknown) {
  const table = deleteTables[entity];
  if (!table) throw new InputError("Not found", 404);
  await ensureSeeded(db);
  try { if(entity==='transactions'){await db.prepare('WITH matched AS MATERIALIZED (SELECT id,transfer_id FROM transactions WHERE id=?) DELETE FROM transactions WHERE id IN (SELECT id FROM matched) OR transfer_id IN (SELECT transfer_id FROM matched)').bind(id(recordId)).run();}else await db.prepare(`DELETE FROM ${table} WHERE id = ?`).bind(id(recordId)).run(); } catch(error) { integrityError(error); }
}

export async function syncCodes(db: D1Database) {
  const response = await fetch("https://akijfeed.com/shop/", { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new InputError("Could not reach Akij. Please try again later.", 502);
  const html = await response.text();
  const names = [...html.matchAll(/<h2[^>]*class="[^"]*product_title[^"]*"[^>]*>([\s\S]*?)<\/h2>/gi)]
    .map((match) => match[1].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
  if (!names.length) throw new InputError("Akij's product list could not be read. Your saved products are unchanged.", 502);
  const updated: SqlRow[] = [];
  const name = "BROILER GROWER FEED 50 KG";
  if (names.includes(name)) {
    const current = await db.prepare("SELECT id, product_code FROM products WHERE name = ?").bind(name).first<SqlRow>();
    if (current && current.product_code !== "102") {
      await db.prepare("UPDATE products SET product_code = '102' WHERE id = ?").bind(current.id).run();
      updated.push({ name, product_code: "102" });
    }
  }
  return { remote_count: names.length, updated_count: updated.length, updated,
    ocr_available: false, errors: ["প্যাকেটের অন্য কোডগুলো Products থেকে পরিবর্তন করে Save করতে পারবেন।"] };
}
