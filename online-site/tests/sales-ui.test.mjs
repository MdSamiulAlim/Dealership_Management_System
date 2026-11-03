import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../public/dealership.js", import.meta.url), "utf8").split("\nbindEvents();")[0];
const sale = { id: 7, sale_date: "2026-10-18", customer_id: 2, product_id: 3, quantity: 2, rate: 1950, total_amount: 3900, paid_amount: 1000, account: "Cash", notes: '<script>alert("memo")</script>', customer_name: "সামিউল <Test>", product_name: "মাছের খাবার", product_code: "513" };
function environment() {
  const nodes = new Map();
  const node = () => ({ innerHTML: "", textContent: "", disabled: false, classList: { add() {}, remove() {} }, showModal() { this.open = true; }, close() { this.open = false; } });
  const fields = Object.fromEntries(["sale_date", "customer_id", "product_id", "quantity", "rate", "paid_amount", "account", "notes"].map(key => [key, { value: "" }]));
  fields.customer_id.dataset = { options: "customers" };
  fields.product_id.dataset = { options: "products" };
  const submit = node();
  const form = { elements: { namedItem: key => fields[key] }, reset() { Object.values(fields).forEach(field => { field.value = ""; }); }, querySelector: () => submit, querySelectorAll: () => [fields.customer_id, fields.product_id] };
  nodes.set("#saleEditForm", form);
  const document = { querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, node()); return nodes.get(selector); } };
  const requests = [];
  let rejectSave = false;
  let currentSale = { ...sale };
  const context = vm.createContext({ document, Intl, window: { setTimeout() {} }, FormData: class { constructor() {} entries() { return Object.entries(fields).map(([key, field]) => [key, String(field.value)]); } }, fetch: async (path, options) => {
    requests.push({ path, options });
    if (options.method === "PATCH") {
      if (rejectSave) return { ok: false, status: 409, json: async () => ({ error: "Changed on another device" }) };
      currentSale = { ...currentSale, ...JSON.parse(options.body) };
      return { ok: true, status: 200, json: async () => ({ sales: [currentSale] }) };
    }
    return { ok: true, status: 200, json: async () => currentSale };
  } });
  vm.runInContext(source + '\nstate.customers=[{id:2,name:"Customer"}];state.products=[{id:3,name:"Feed",default_rate:10}];renderAll=()=>{};', context);
  return { context, nodes, fields, submit, requests, reject() { rejectSave = true; } };
}

test("memo view escapes customer/notes and edit retains original sale rate", async () => {
  const e = environment();
  await vm.runInContext("openSaleView(7)", e.context);
  const html = e.nodes.get("#saleMemoContent").innerHTML;
  assert.match(html, /AT-000007/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;Test&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.equal(e.nodes.get("#saleViewDialog").open, true);
  await vm.runInContext("openSaleEdit(7)", e.context);
  assert.equal(e.fields.rate.value, 1950);
  assert.equal(e.fields.notes.value, sale.notes);
  assert.equal(e.nodes.get("#saleViewDialog").open, false);
  assert.equal(e.nodes.get("#saleEditDialog").open, true);
});

test("failed edits retain entered values; successful edits send original record and reopen memo", async () => {
  for (const fail of [true, false]) {
    const e = environment();
    await vm.runInContext("openSaleEdit(7)", e.context);
    e.fields.quantity.value = 3;
    if (fail) e.reject();
    e.context.event = { preventDefault() {}, currentTarget: e.nodes.get("#saleEditForm") };
    await vm.runInContext("handleSaleEditSubmit(event)", e.context);
    const save = e.requests.find(request => request.options.method === "PATCH");
    assert.equal(save.path, "/api/sales/7");
    assert.equal(JSON.parse(save.options.body).original.quantity, 2);
    assert.equal(JSON.parse(save.options.body).quantity, "3");
    assert.equal(e.submit.disabled, false);
    if (fail) {
      assert.equal(e.fields.quantity.value, 3);
      assert.equal(e.nodes.get("#saleEditDialog").open, true);
      assert.match(e.nodes.get("#saleEditError").textContent, /Changed/);
    } else {
      assert.equal(e.nodes.get("#saleEditDialog").open, false);
      assert.equal(e.nodes.get("#saleViewDialog").open, true);
    }
  }
});
