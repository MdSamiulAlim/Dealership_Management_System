import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import fixture from "./financial-fixture.json" with { type: "json" };
import initial from "../lib/initial-records.json" with { type: "json" };
import { applyAlertLevelUpdate, updateSale, bootstrap, deleteRecord, ensureSeeded, InputError, insertRecord, money, updateProduct } from "../lib/ledger.ts";

import { database, D1Adapter } from "./d1-adapter.mjs";

function withoutTimes(value) {
  if (Array.isArray(value)) return value.map(withoutTimes);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).filter(([key]) => key !== "created_at" && key !== "category" && key !== "reference" && key !== "feed_size" && key !== "protein_percent" && key !== "archived" && key !== "transfer_id").map(([key, item]) => [key, withoutTimes(item)]));
  return value;
}

test("initial products and all 42 prices exactly match the local source", async () => {
  const db = database();
  try {
    const data = await bootstrap(db, fixture.date);
    assert.equal(data.products.length, 60);
    for (const original of initial.products) {
      const product = data.products.find((row) => row.id === original.id);
      for (const [key, value] of Object.entries(original)) assert.deepEqual(product[key], value);
    }
    assert.equal(data.products.filter((p) => p.default_rate > 0).length, 42);
    assert.equal(data.customers[0].name, "Cash Customer");
  } finally { db.connection.close(); }
});

test("sales, stock, due, cash, bank and every report match the Python app", async () => {
  const db = database();
  try {
    for (const action of fixture.actions) {
      // The source fixture used two independent requests for each transfer.
      // One request now creates that exact debit/credit pair atomically.
      if(action.entity==='transactions'&&((action.payload.type==='Bank Deposit'&&action.payload.account==='Bank')||(action.payload.type==='Bank Withdraw'&&action.payload.account==='Cash')))continue;
      await insertRecord(db, action.entity, action.payload);
    }
    const actual = withoutTimes(await bootstrap(db, fixture.date));
    assert.deepEqual(actual, fixture.expected);
    assert.equal(actual.products.find((p) => p.id === fixture.product_id).current_stock, 8);
    assert.equal(actual.customers.find((c) => c.id === 2).current_due, 3450);
    assert.equal(actual.dashboard.cash_balance, 1240);
    assert.equal(actual.dashboard.bank_balance, 2075);
  } finally { db.connection.close(); }
});

test("second device and restarted server preserve edits without reseeding", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dealership-ledger-"));
  const path = join(directory, "records.db");
  const first = database(path);
  try {
    await ensureSeeded(first);
    await updateProduct(first, fixture.product_id, { product_code: "513", default_rate: 2025.5, original:(await bootstrap(first)).products.find(p=>p.id===fixture.product_id) });
    await insertRecord(first, "customers", { name: "Shared device customer" });
    await deleteRecord(first, "products", 4);
    const secondConnection = new DatabaseSync(path);
    const second = new D1Adapter(secondConnection);
    try {
      const data = await bootstrap(second, fixture.date);
      assert.equal(data.products.find((p) => p.id === fixture.product_id).default_rate, 2025.5);
      assert.ok(data.customers.some((c) => c.name === "Shared device customer"));
      assert.ok(!data.products.some((p) => p.id === 4));
      assert.equal(data.products.length, 59);
    } finally { secondConnection.close(); }
  } finally { first.connection.close(); rmSync(directory, { recursive: true }); }
});

test("foreign keys, invalid accounts, amounts and missing records reject bad entries", async () => {
  const db = database();
  try {
    await ensureSeeded(db);
    assert.throws(() => money(Infinity), InputError);
    assert.throws(() => money("bad"), InputError);
    await assert.rejects(insertRecord(db, "customers", {}), InputError);
    db.connection.prepare("UPDATE products SET opening_stock=5 WHERE id=?").run(fixture.product_id);
    await assert.rejects(insertRecord(db, "sales", { sale_date: fixture.date, customer_id: 99999, product_id: fixture.product_id, quantity: 1, rate: 1950 }), /FOREIGN KEY/);
    await assert.rejects(insertRecord(db, "transactions", { txn_date: fixture.date, type: "Expense", amount: 10, account: "invalid" }), /Choose/);
    await assert.rejects(updateProduct(db, 99999, { product_code: "missing", default_rate: 10 }), InputError);
    assert.equal((await bootstrap(db, fixture.date)).sales.length, 0);
  } finally { db.connection.close(); }
});


test("receipts use persisted sale totals, Bangla names, page wrapping and strict sale IDs", async () => {
  const { saleForReceipt, createReceipt } = await import("../lib/receipt.ts");
  const { PDFDocument } = await import("pdf-lib");
  const db = database();
  try {
    for (const action of fixture.actions) {
      // The source fixture used two independent requests for each transfer.
      // One request now creates that exact debit/credit pair atomically.
      if(action.entity==='transactions'&&((action.payload.type==='Bank Deposit'&&action.payload.account==='Bank')||(action.payload.type==='Bank Withdraw'&&action.payload.account==='Cash')))continue;
      await insertRecord(db, action.entity, action.payload);
    }
    const saved = (await bootstrap(db, fixture.date)).sales[0];
    const sale = await saleForReceipt(db, String(saved.id));
    assert.equal(sale.total_amount, saved.total_amount);
    assert.equal(sale.rate, saved.rate);
    assert.equal(sale.paid_amount, saved.paid_amount);
    assert.ok(sale.customer_name && sale.product_name);
    const pdf = await createReceipt({ ...sale, customer_name: "মোঃ সামিউল ইসলাম", customer_address: "ঢাকা, বাংলাদেশ", product_name: "মাছের খাবার — গ্রোয়ার পিলেট", notes: "বাংলা নাম ও যুক্তাক্ষর: শ্রেষ্ঠ পুষ্টিকর খাদ্য।" });
    assert.equal(Buffer.from(pdf.slice(0, 5)).toString(), "%PDF-");
    const document = await PDFDocument.load(pdf);
    assert.equal(document.getPageCount(), 1);
    assert.match(document.getTitle(), /Arafat Traders/);
    writeFileSync("/tmp/arafat-receipt-test.pdf", pdf);
    const long = await createReceipt({ ...sale, notes: "দীর্ঘ বিবরণ test ".repeat(400) });
    assert.ok((await PDFDocument.load(long)).getPageCount() > 1);
    await assert.rejects(saleForReceipt(db, "1 OR 1=1"), InputError);
    await assert.rejects(saleForReceipt(db, "0"), InputError);
    await assert.rejects(saleForReceipt(db, "9999999"), { status: 404 });
  } finally { db.connection.close(); }
});


test("alert mapping preserves original values once across devices/restarts", async () => {
  const db = database();
  try {
    await ensureSeeded(db);
    const ids = (await bootstrap(db)).products.slice(0, 5).map(p => p.id);
    for (const [i, level] of [20, 10, 5, 7, 0].entries()) db.connection.prepare("UPDATE products SET low_stock_level = ? WHERE id = ?").run(level, ids[i]);
    const levels = () => ids.map(id => db.connection.prepare("SELECT low_stock_level AS level FROM products WHERE id = ?").get(id).level);
    await applyAlertLevelUpdate(db);
    assert.deepEqual(levels(), [10, 5, 5, 7, 0]);
    await applyAlertLevelUpdate(new D1Adapter(db.connection));
    assert.deepEqual(levels(), [10, 5, 5, 7, 0]);
    await insertRecord(db, "products", { name: "New product after threshold change" });
    assert.equal((await bootstrap(db)).products.find(p => p.name === "New product after threshold change").low_stock_level, 5);
  } finally { db.connection.close(); }
});

test("sale edit updates stock, due, accounts, reports and memo without creating another sale", async () => {
  const { saleForReceipt } = await import("../lib/receipt.ts");
  const db = database();
  try {
    for (const action of fixture.actions) {
      // The source fixture used two independent requests for each transfer.
      // One request now creates that exact debit/credit pair atomically.
      if(action.entity==='transactions'&&((action.payload.type==='Bank Deposit'&&action.payload.account==='Bank')||(action.payload.type==='Bank Withdraw'&&action.payload.account==='Cash')))continue;
      await insertRecord(db, action.entity, action.payload);
    }
    const before = await bootstrap(db, fixture.date);
    const old = before.sales.find(s => s.account === "Cash");
    const original = await saleForReceipt(db, String(old.id));
    const customer = before.customers.find(c => c.id !== old.customer_id);
    const product = before.products.find(p => p.id !== old.product_id);
    db.connection.prepare("UPDATE products SET opening_stock=2 WHERE id=?").run(product.id);product.opening_stock=2;product.current_stock=2;
    const input = { sale_date: fixture.date, customer_id: customer.id, product_id: product.id, quantity: 2, rate: 100, paid_amount: 150, account: "Bank", notes: "সংশোধিত বিক্রি", original };
    await updateSale(db, old.id, input);
    const after = await bootstrap(db, fixture.date);
    const edited = await saleForReceipt(db, String(old.id));
    assert.equal(after.sales.length, before.sales.length);
    assert.equal(edited.id, old.id);
    assert.equal(edited.total_amount, 200);
    assert.equal(edited.paid_amount, 150);
    assert.equal(edited.notes, input.notes);
    assert.equal(after.products.find(p => p.id === old.product_id).current_stock, before.products.find(p => p.id === old.product_id).current_stock + old.quantity);
    assert.equal(after.products.find(p => p.id === product.id).current_stock, product.current_stock - 2);
    assert.equal(after.customers.find(c => c.id === old.customer_id).current_due, before.customers.find(c => c.id === old.customer_id).current_due - old.due_amount);
    assert.equal(after.customers.find(c => c.id === customer.id).current_due, customer.current_due + 50);
    assert.equal(after.dashboard.cash_balance, before.dashboard.cash_balance - old.paid_amount);
    assert.equal(after.dashboard.bank_balance, before.dashboard.bank_balance + 150);
    assert.equal(after.reports.daily_sales.find(r => r.date === fixture.date).sales, before.reports.daily_sales.find(r => r.date === fixture.date).sales - old.total_amount + 200);
    await assert.rejects(updateSale(db, old.id, input), { status: 409 });
    for (const invalid of [{ quantity: 0 }, { rate: -1 }, { paid_amount: -1 }, { paid_amount: 201 }, { sale_date: "2026-02-30" }, { account: "Other" }]) {
      await assert.rejects(updateSale(db, old.id, { ...input, original: edited, ...invalid }), InputError);
    }
    await assert.rejects(updateSale(db, old.id, { ...input, original: edited, product_id: 999999 }), /FOREIGN KEY/);
    assert.equal((await saleForReceipt(db, String(old.id))).total_amount, 200);
    await assert.rejects(updateSale(db, 999999, { ...input, original: null }), { status: 404 });
  } finally { db.connection.close(); }
});
