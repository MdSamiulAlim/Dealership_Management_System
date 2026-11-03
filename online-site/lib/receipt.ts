import "regenerator-runtime/runtime.js";
import { PDFDocument, PDFHexString, beginText, endText, rgb, setFontAndSize, setTextMatrix, showText } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import logoBase64 from "./akij-logo.ts";
import arafatLogoBase64 from "./arafat-logo.ts";
import fontBase64 from "./fonts/bengali-font.ts";
import { InputError } from "./ledger.ts";
import type { BusinessSettings, CustomerRecord, InvoiceItemRecord, SaleRecord } from "./records.ts";

type ReceiptItem = Pick<InvoiceItemRecord, "product_name" | "product_code" | "quantity" | "rate" | "line_total"> & { returned_quantity?: number };
type SaleReceipt = Pick<SaleRecord, "sale_date" | "total_amount" | "paid_amount" | "account" | "notes"> & {
  document_type?: "invoice";
  id: string | number;
  invoice_no?: string;
  customer_name: string;
  customer_mobile?: string | null;
  customer_address?: string | null;
  product_name?: string;
  product_code?: string;
  quantity?: number;
  rate?: number;
  subtotal?: number;
  discount?: number;
  returned_total?: number;
  refunded?: number;
  status?: string;
  items?: ReceiptItem[];
  settings?: BusinessSettings;
};
type CustomerDueReceipt = {
  document_type: "customer_due";
  customer: Pick<CustomerRecord, "id" | "name" | "mobile" | "address">;
  generated_at: string;
  opening_balance: number;
  net_sales: number;
  sale_payments: number;
  collections: number;
  due: number;
  credit: number;
  entries: {kind: string; date: string; reference?: string; debit: number; credit: number; balance: number; notes?: string}[];
  settings?: BusinessSettings;
};

const bytes = Uint8Array.from(atob(fontBase64), (c) => c.charCodeAt(0));
const shapingFont = fontkit.create(bytes);
const green = rgb(0.09, 0.25, 0.20);
const clean = (value: unknown) => String(value ?? "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, " ");

export async function saleForReceipt(db: D1Database, value: string) {
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) throw new InputError("Invalid sale ID");
  const sale = await db.prepare(`SELECT s.*, c.name AS customer_name, c.mobile AS customer_mobile,
    c.address AS customer_address, p.name AS product_name, p.product_code, p.bag_weight
    FROM sales s JOIN customers c ON c.id = s.customer_id JOIN products p ON p.id = s.product_id
    WHERE s.id = ?`).bind(Number(value)).first<SaleReceipt>();
  if (!sale) throw new InputError("Sale not found", 404);
  return sale;
}

export async function createReceipt(sale: SaleReceipt | CustomerDueReceipt, language: "bn" | "en" = "en") {
  const bn = language === "bn", dueStatement = sale.document_type === "customer_due";
  const t = (english: string, bangla: string) => bn ? bangla : english;
  const amount = (value: unknown) => Number(value || 0).toLocaleString(bn ? "bn-BD" : "en-BD", {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const bagAmount = (value: unknown) => Number(value || 0).toLocaleString(bn ? "bn-BD" : "en-BD", {maximumFractionDigits: 2});
  const currency = t("BDT", "টাকা"), bag = t("Bag", "বস্তা");
  const shop = sale.settings || { name: "Arafat Traders", phone: "+8801646130402", address: "" };
  const number = dueStatement ? `CD-${sale.customer.id}` : sale.invoice_no || `AT-${String(sale.id).padStart(6, "0")}`;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  // Full embedding retains original glyph IDs for positioned Indic glyph runs.
  const font = await doc.embedFont(bytes, { subset: false });
  doc.setTitle(`${shop.name} — ${number}`);
  doc.setAuthor(shop.name);
  doc.setSubject(dueStatement?t("Customer due statement", "কাস্টমারের বকেয়া হিসাব"):t("Sales memo / receipt", "বিক্রির মেমো / রসিদ"));
  let page = doc.addPage([595.28, 841.89]);
  const logo = await doc.embedPng(Uint8Array.from(atob(logoBase64), (c) => c.charCodeAt(0)));
  const storeLogo = await doc.embedPng(Uint8Array.from(atob(arafatLogoBase64), (c) => c.charCodeAt(0)));
  page.drawImage(storeLogo, { x: 44, y: 740, width: 86, height: 86 });
  page.drawImage(logo, { x: 441, y: 753, width: 110, height: 45.26 });
  let y = 790;
  const margin = 44;
  const width = 507;
  type Run = Pick<ReturnType<typeof shapingFont.layout>, "glyphs" | "positions">;
  const runs = new Map<string, Run>();
  const layout = (text: string) => {
    let run = runs.get(text);
    if (!run) {
      // Shape Bengali and Latin separately: the engine selects one script per run.
      const pieces = (text.match(/[\u0980-\u09ff\u200c\u200d]+|[^\u0980-\u09ff\u200c\u200d]+/gu) || []).map((part) => shapingFont.layout(part));
      run = { glyphs: pieces.flatMap((piece) => piece.glyphs), positions: pieces.flatMap((piece) => piece.positions) };
      runs.set(text, run);
    }
    return run;
  };
  const measure = (text: string, size: number) => layout(text).positions.reduce((sum, p) => sum + p.xAdvance, 0) * size / shapingFont.unitsPerEm;
  function draw(text: string, x: number, baseline: number, size: number) {
    // Position each glyph so Bengali vowel marks and conjuncts retain shaping offsets.
    const key = page.node.newFontDictionary(font.name, font.ref);
    const run = layout(text);
    const scale = size / shapingFont.unitsPerEm;
    let advance = 0;
    page.pushOperators(beginText(), setFontAndSize(key, size));
    for (let i = 0; i < run.glyphs.length; i++) {
      const pos = run.positions[i];
      page.pushOperators(setTextMatrix(1, 0, 0, 1, x + (advance + pos.xOffset) * scale, baseline + pos.yOffset * scale),
        showText(PDFHexString.of(run.glyphs[i].id.toString(16).padStart(4, "0"))));
      advance += pos.xAdvance;
    }
    page.pushOperators(endText());
  }
  function line(value: unknown, size = 11, x = margin, lineWidth = width) {
    const text = clean(value);
    const segmenter = new Intl.Segmenter("bn", { granularity: "grapheme" });
    for (const paragraph of text.split("\n")) {
      let current = "";
      const flush = () => {
        if (y < 56) { page = doc.addPage([595.28, 841.89]); y = 790; }
        draw(current, x, y, size);
        y -= size + 10;
        current = "";
      };
      for (const word of paragraph.split(/(?<=\s)/u)) {
        if (current && measure(current + word, size) > lineWidth) flush();
        if (measure(word, size) <= lineWidth) current += word;
        else for (const { segment } of segmenter.segment(word)) {
          if (current && measure(current + segment, size) > lineWidth) flush();
          current += segment;
        }
      }
      flush();
    }
  }
  line(shop.name, 22, 145, 280);
  line(`${t("Mobile", "মোবাইল")}: ${shop.phone}`, 11, 145, 280);
  if (shop.address) line(`${t("Address", "ঠিকানা")}: ${shop.address}`, 10, 145, 280);
  y = Math.min(y - 8, 730);
  page.drawLine({ start: { x: margin, y }, end: { x: 551, y }, thickness: 1.5, color: green });
  y -= 28;
  if(dueStatement){
    line(t("CUSTOMER DUE STATEMENT", "কাস্টমারের বকেয়া হিসাবের রসিদ"),16);
    line(`${t("Statement No", "হিসাব নম্বর")}: ${number}`);
    line(`${t("Generated", "তৈরির সময়")}: ${new Intl.DateTimeFormat(bn?'bn-BD':'en-GB',{timeZone:'Asia/Dhaka',dateStyle:'medium',timeStyle:'short'}).format(new Date(sale.generated_at))}`);
    line(`${t("Customer", "কাস্টমার")}: ${sale.customer.name}`);
    if(sale.customer.mobile)line(`${t("Mobile", "মোবাইল")}: ${sale.customer.mobile}`);
    if(sale.customer.address)line(`${t("Address", "ঠিকানা")}: ${sale.customer.address}`);
    y-=10;
    const totals=[[t('Opening balance','আগের বকেয়া'),sale.opening_balance],[t('Net sales after returns','ফেরতের পর নিট বিক্রি'),sale.net_sales],[t('Payments with sales','বিক্রির সময় জমা'),sale.sale_payments],[t('Customer collections','বকেয়া আদায়'),sale.collections]];
    for(const [label,value] of totals)line(`${label}: ${currency} ${amount(value)}`);
    line(`${t('OUTSTANDING DUE','মোট বকেয়া')}: ${currency} ${amount(sale.due)}`,15);
    if(sale.credit)line(`${t('Customer credit','কাস্টমারের অগ্রিম')}: ${currency} ${amount(sale.credit)}`,13);
    y-=12;
    line(t('Account history','হিসাবের বিবরণ'),14);
    for(const entry of sale.entries){
      const kind=entry.kind==='invoice'?t('Sale','বিক্রি'):entry.kind==='return'?t('Return / Refund','ফেরত / টাকা ফেরত'):t('Collection','বকেয়া আদায়');
      line(`${entry.date} | ${kind} | ${entry.reference||''}`,11);
      line(`${t('Charge / Refund','বিক্রি / ফেরত টাকা')}: ${amount(entry.debit)} | ${t('Paid / Credit','জমা / ফেরতের মূল্য')}: ${amount(entry.credit)} | ${t('Balance','ব্যালেন্স')}: ${amount(entry.balance)}`,10);
      if(entry.notes)line(entry.notes,9);
      y-=5;
    }
    line(t('Balance = opening balance + net sales - payments with sales - customer collections.','ব্যালেন্স = আগের বকেয়া + নিট বিক্রি - বিক্রির সময় জমা - বকেয়া আদায়।'),9);
    line(t('This statement includes all recorded customer transactions as of the generated time.','তৈরির সময় পর্যন্ত কাস্টমারের সব সংরক্ষিত লেনদেন এই হিসাবে অন্তর্ভুক্ত।'),9);
  }else{
  const netTotal = sale.status === "void" ? 0 : Number(sale.total_amount) - Number(sale.returned_total || 0);
  const netPaid = sale.status === "void" ? 0 : Number(sale.paid_amount) - Number(sale.refunded || 0);
  line(sale.status === "void" ? t("CANCELLED INVOICE", "বাতিল ইনভয়েস") : t("SALES INVOICE / RECEIPT", "বিক্রির ইনভয়েস / রসিদ"), 16);
  line(`${t("Invoice No", "ইনভয়েস নম্বর")}: ${number}     ${t("Date", "তারিখ")}: ${sale.sale_date}`);
  y -= 8;
  line(`${t("Customer", "কাস্টমার")}: ${sale.customer_name}`);
  if (sale.customer_mobile) line(`${t("Mobile", "মোবাইল")}: ${sale.customer_mobile}`);
  if (sale.customer_address) line(`${t("Address", "ঠিকানা")}: ${sale.customer_address}`);
  y -= 12;
  const items: (Pick<ReceiptItem,"line_total"> & Partial<ReceiptItem>)[] = sale.items || [{ product_name: sale.product_name, product_code: sale.product_code, quantity: sale.quantity, rate: sale.rate, line_total: sale.total_amount }];
  for (const [index, item] of items.entries()) {
    line(`${bagAmount(index + 1)}. ${item.product_name}`, 12);
    if (item.product_code) line(`${t("Code", "কোড")}: ${item.product_code}`, 10);
    line(`${bagAmount(item.quantity)} ${bag} × ${currency} ${amount(item.rate)} | ${t("Net", "নিট")}: ${currency} ${amount(item.line_total)}`, 10);
    if (item.returned_quantity) line(`${t("Returned", "ফেরত")}: ${bagAmount(item.returned_quantity)} ${bag}`, 10);
    y -= 6;
  }
  line(`${t("Subtotal", "ছাড়ের আগের মোট")}: ${currency} ${amount(sale.subtotal ?? sale.total_amount)}`);
  if (sale.discount) line(`${t("Discount", "ছাড়")}: ${currency} ${amount(sale.discount)}`);
  if (sale.returned_total) line(`${t("Return credit", "ফেরতের মূল্য")}: ${currency} ${amount(sale.returned_total)}`);
  line(`${t("TOTAL", "মোট")}: ${currency} ${amount(netTotal)}`, 15);
  line(`${t("Paid", "জমা")}: ${currency} ${amount(netPaid)}`);
  if (sale.refunded) line(`${t("Refunded", "ফেরত দেওয়া টাকা")}: ${currency} ${amount(sale.refunded)}`);
  line(`${t("Due", "বাকি")}: ${currency} ${amount(netTotal - netPaid)}`);
  line(`${t("Payment account", "পেমেন্টের অ্যাকাউন্ট")}: ${bn ? ({Cash:"নগদ",Bank:"ব্যাংক"} as Record<string,string>)[sale.account] || sale.account : sale.account}`);
  if (sale.notes) { y -= 10; const notes = clean(sale.notes); line(`${t("Notes", "মন্তব্য")}: ${notes.slice(0, 20000)}${notes.length > 20000 ? t(" [Full notes available in app]", " [পুরো মন্তব্য অ্যাপে আছে]") : ""}`); }
  y -= 16;
  line(t("This memo shows payment recorded with this sale.", "এই মেমোতে বিক্রির সঙ্গে সংরক্ষিত পেমেন্ট দেখায়।"), 9);
  line(t("Thank you for your business.", "আমাদের সঙ্গে ব্যবসা করার জন্য ধন্যবাদ।"), 10);
  }
  const pages = doc.getPages();
  pages.forEach((sheet, i) => { page = sheet; draw(`${shop.name} | ${number} | ${t("Page", "পৃষ্ঠা")} ${bagAmount(i + 1)}/${bagAmount(pages.length)}`, margin, 28, 8); });
  return doc.save();
}
