import type { adjustments, customers, invoiceItems, invoices, orders, payments, products, sales, syncOperations, transactions } from "../db/schema.ts";

// Incoming API fields stay unknown until their existing validators accept them.
export type Payload = Record<string, unknown>;
export type SqlValue = string | number | null;
export type SqlRow = Record<string, SqlValue>;
export type ProductRecord = typeof products.$inferSelect;
export type CustomerRecord = typeof customers.$inferSelect;
export type InvoiceRecord = typeof invoices.$inferSelect;
export type InvoiceItemRecord = typeof invoiceItems.$inferSelect;
export type SaleRecord = typeof sales.$inferSelect;
export type SyncOperation = typeof syncOperations.$inferSelect;
export type ProductStock = ProductRecord & {
  current_stock: number;
  received_stock: number;
  sold_stock: number;
};
export type CustomerBalance = CustomerRecord & {
  total_purchase: number;
  total_paid: number;
  current_due: number;
};
export type BusinessSettings = {
  name: string;
  phone: string;
  address: string;
  large_discount_percent: number;
  version: number;
};

export type OrderRecord = typeof orders.$inferSelect;
export type PaymentRecord = typeof payments.$inferSelect;
export type AdjustmentRecord = typeof adjustments.$inferSelect;
export type TransactionRecord = typeof transactions.$inferSelect;
