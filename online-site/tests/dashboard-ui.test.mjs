import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
const source = readFileSync(new URL("../public/dealership.js", import.meta.url), "utf8").split("\nbindEvents();")[0];
function context() { const c = vm.createContext({document:{querySelector(){return null;}}, Intl, window: {} }); vm.runInContext(source, c); return c; }
const get = (c, expression) => JSON.parse(vm.runInContext(`JSON.stringify(${expression})`, c));

test("stock/payment filters and Bengali digit search keep independent results", () => {
  const c = context();
  vm.runInContext(`state.products=[{id:1,name:'মাছের খাবার',product_code:'513',current_stock:0,low_stock_level:5},{id:2,name:'Feed',current_stock:8,low_stock_level:10},{id:3,name:'Other',current_stock:-2,low_stock_level:5}];ui.stockFilter='available';`, c);
  assert.deepEqual(get(c, 'filteredRows("stock",state.products).map(r=>r.id)'), [2]);
  vm.runInContext("ui.stockFilter='empty';ui.search.products='৫১৩'", c);
  assert.deepEqual(get(c, 'filteredRows("products",state.products).map(r=>r.id)'), [1]);
  assert.deepEqual(get(c, 'filteredRows("stock",state.products).map(r=>r.id)'), [1, 3]);
  vm.runInContext("state.sales=[{id:7,customer_name:'Customer',due_amount:100},{id:8,customer_name:'Customer',due_amount:0}];ui.salesFilter='due'", c);
  assert.deepEqual(get(c, 'filteredRows("sales",state.sales).map(r=>r.id)'), [7]);
  vm.runInContext("ui.salesFilter='paid'", c);
  assert.deepEqual(get(c, 'filteredRows("sales",state.sales).map(r=>r.id)'), [8]);
});

test("chart includes missing days as zero and handles month/year boundaries without future records", () => {
  const c = context();
  vm.runInContext(`state.dashboard.today='2026-01-02';state.reports.daily_sales=[{date:'2025-12-31',sales:100,received:50},{date:'2026-01-02',sales:200,received:100},{date:'2026-01-03',sales:999}];`, c);
  const series = get(c, 'salesSeries(7)');
  assert.equal(series.length, 7);
  assert.equal(series[0].date, '2025-12-27');
  assert.equal(series[6].date, '2026-01-02');
  assert.equal(series.reduce((sum,r)=>sum+r.sales,0), 300);
  assert.equal(series.find(r=>r.date==='2026-01-01').sales, 0);
});

test("header weekday and date follow Bangladesh midnight in both languages", () => {
  const c = context();
  const clock = {}, date = {}, time = {};
  c.document = { querySelector: selector => ({ '#currentDateTime': clock, '[data-current-date]': date, '[data-current-time]': time })[selector] };
  clock.querySelector = c.document.querySelector;
  for (const language of ['en', 'bn']) {
    c.window.AppI18n = { language };
    vm.runInContext('renderCurrentClock(new Date("2026-10-18T18:30:00Z"))', c);
    const locale = language === 'bn' ? 'bn-BD' : 'en-GB';
    assert.equal(date.textContent, new Intl.DateTimeFormat(locale, { timeZone: 'Asia/Dhaka', weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' }).format(new Date('2026-10-18T18:30:00Z')));
    assert.match(date.textContent, language === 'bn' ? /সোমবার/ : /Monday/);
    assert.match(time.textContent, language === 'bn' ? /বাংলাদেশ সময়/ : /BDT/);
    assert.equal(clock.dateTime, '2026-10-18T18:30:00.000Z');
  }
});
