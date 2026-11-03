import { sql } from "drizzle-orm";
import { check, index, integer, real, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
const created = () => text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`);
export const products = sqliteTable("products", {
 id: integer("id").primaryKey({autoIncrement:true}), name:text("name").notNull().unique(),
 category:text("category").notNull().default(""), archived:integer("archived").notNull().default(0),
 feed_size:text("feed_size").notNull().default(""), protein_percent:real("protein_percent"),
 product_code:text("product_code").notNull().default(""), bag_weight:real("bag_weight").notNull().default(50),
 opening_stock:real("opening_stock").notNull().default(0), default_rate:real("default_rate").notNull().default(0),
 low_stock_level:real("low_stock_level").notNull().default(10), created_at:created(),
});
export const customers = sqliteTable("customers", {
 id:integer("id").primaryKey({autoIncrement:true}), name:text("name").notNull(), mobile:text("mobile").default(""),
 address:text("address").default(""), opening_due:real("opening_due").notNull().default(0), created_at:created(),
});
const productId=()=>integer("product_id").notNull().references(()=>products.id,{onDelete:"cascade"});
const customerId=()=>integer("customer_id").notNull().references(()=>customers.id,{onDelete:"cascade"});
export const orders=sqliteTable("company_orders",{
 id:integer("id").primaryKey({autoIncrement:true}),order_date:text("order_date").notNull(),product_id:productId(),
 quantity:real("quantity").notNull(),bag_weight:real("bag_weight").notNull().default(50),rate:real("rate").notNull(),
 total_amount:real("total_amount").notNull(),status:text("status").notNull(),delivery_date:text("delivery_date").default(""),
 invoice_no:text("invoice_no").default(""),notes:text("notes").default(""),created_at:created(),
},t=>[check("orders_status",sql`${t.status} IN ('Pending','Confirmed','Delivered')`)]);
export const sales=sqliteTable("sales",{
 id:integer("id").primaryKey({autoIncrement:true}),sale_date:text("sale_date").notNull(),customer_id:customerId(),product_id:productId(),
 quantity:real("quantity").notNull(),rate:real("rate").notNull(),total_amount:real("total_amount").notNull(),
 paid_amount:real("paid_amount").notNull().default(0),account:text("account").notNull(),notes:text("notes").default(""),created_at:created(),
},t=>[check("sales_account",sql`${t.account} IN ('Cash','Bank')`)]);
export const payments=sqliteTable("customer_payments",{
 id:integer("id").primaryKey({autoIncrement:true}),payment_date:text("payment_date").notNull(),customer_id:customerId(),
 amount:real("amount").notNull(),account:text("account").notNull(),notes:text("notes").default(""),created_at:created(),
},t=>[check("payments_account",sql`${t.account} IN ('Cash','Bank')`)]);
export const adjustments=sqliteTable("stock_adjustments",{
 id:integer("id").primaryKey({autoIncrement:true}),adjust_date:text("adjust_date").notNull(),product_id:productId(),
 type:text("type").notNull(),quantity:real("quantity").notNull(),notes:text("notes").default(""),created_at:created(),
},t=>[check("adjustments_type",sql`${t.type} IN ('Return','Damage','Loss','Manual Add','Manual Minus')`)]);
export const transactions=sqliteTable("transactions",{
 id:integer("id").primaryKey({autoIncrement:true}),txn_date:text("txn_date").notNull(),type:text("type").notNull(),
 transfer_id:text("transfer_id"),amount:real("amount").notNull(),account:text("account").notNull(),notes:text("notes").default(""),category:text("category").notNull().default("General"),reference:text("reference").notNull().default(""),created_at:created(),
},t=>[uniqueIndex("transaction_transfer_account").on(t.transfer_id,t.account),check("transactions_account",sql`${t.account} IN ('Cash','Bank')`),
 check("transactions_type",sql`${t.type} IN ('Company Payment','Expense','Transport Cost','Other Income','Other Expense','Bank Deposit','Bank Withdraw')`)]);
export const meta=sqliteTable("app_meta",{key:text("key").primaryKey(),value:text("value").notNull().default("")});

export const invoices=sqliteTable("invoices",{
 id:text("id").primaryKey(),invoice_no:text("invoice_no").notNull().unique(),sale_date:text("sale_date").notNull(),
 customer_id:integer("customer_id").notNull().references(()=>customers.id),subtotal:real("subtotal").notNull(),discount:real("discount").notNull().default(0),
 customer_name:text("customer_name").notNull().default(""),customer_mobile:text("customer_mobile").notNull().default(""),customer_address:text("customer_address").notNull().default(""),
 total_amount:real("total_amount").notNull(),paid_amount:real("paid_amount").notNull().default(0),account:text("account").notNull(),notes:text("notes").notNull().default(""),
 returned_total:real("returned_total").notNull().default(0),refunded:real("refunded").notNull().default(0),status:text("status").notNull().default("active"),
 version:integer("version").notNull().default(1),last_op:text("last_op").notNull().default(""),created_at:created(),
},t=>[check("invoice_account",sql`${t.account} IN ('Cash','Bank')`),check("invoice_status",sql`${t.status} IN ('active','void')`)]);
export const invoiceItems=sqliteTable("invoice_items",{
 id:text("id").primaryKey(),invoice_id:text("invoice_id").notNull().references(()=>invoices.id),sale_id:integer("sale_id").notNull().unique().references(()=>sales.id),
 product_id:integer("product_id").notNull().references(()=>products.id),product_name:text("product_name").notNull(),product_code:text("product_code").notNull().default(""),
 quantity:real("quantity").notNull(),rate:real("rate").notNull(),line_total:real("line_total").notNull(),returned_quantity:real("returned_quantity").notNull().default(0),
});
export const invoiceReturns=sqliteTable("invoice_returns",{
 id:text("id").primaryKey(),invoice_id:text("invoice_id").notNull().references(()=>invoices.id),return_date:text("return_date").notNull(),
 credit:real("credit").notNull(),refund:real("refund").notNull(),reason:text("reason").notNull().default(""),items_json:text("items_json").notNull(),created_at:created(),
});
export const syncOperations=sqliteTable("sync_operations",{
 id:text("id").primaryKey(),payload_hash:text("payload_hash").notNull(),entity:text("entity").notNull(),result_id:text("result_id"),changed:integer("changed").notNull().default(1),created_at:created(),
 customer_id:integer("customer_id"),
});

// Authentication state is shared by every Worker and survives business resets.
export const loginRateLimits=sqliteTable("login_rate_limits",{
 key:text("key").primaryKey(),count:integer("count").notNull(),expires_at:integer("expires_at").notNull(),
},t=>[index("login_limit_expiry").on(t.expires_at)]);
export const appSessions=sqliteTable("app_sessions",{
 id:text("id").primaryKey(),username:text("username").notNull(),expires_at:integer("expires_at").notNull(),revoked_at:integer("revoked_at"),
},t=>[index("app_session_expiry").on(t.expires_at)]);

// Append-only business journal also provides the ordered replication cursor.
export const auditEvents=sqliteTable("audit_events",{
 seq:integer("seq").primaryKey({autoIncrement:true}),operation_id:text("operation_id").notNull(),
 actor:text("actor").notNull(),actor_role:text("actor_role").notNull(),entity:text("entity").notNull(),
 record_id:text("record_id").notNull(),action:text("action").notNull(),before_json:text("before_json"),after_json:text("after_json"),created_at:created(),
},t=>[index("audit_entity_record").on(t.entity,t.record_id),index("audit_date").on(t.created_at),index("audit_operation").on(t.operation_id)]);
export const backupCatalog=sqliteTable("backup_catalog",{
 id:text("id").primaryKey(),object_key:text("object_key").notNull(),sha256:text("sha256").notNull(),
 bytes:integer("bytes").notNull(),actor:text("actor").notNull(),summary_json:text("summary_json").notNull(),created_at:created(),
});
export const monitorBuckets=sqliteTable("monitor_buckets",{
 key:text("key").primaryKey(),hour:text("hour").notNull(),route:text("route").notNull(),status:integer("status").notNull(),
 requests:integer("requests").notNull().default(0),duration_ms:integer("duration_ms").notNull().default(0),max_ms:integer("max_ms").notNull().default(0),
},t=>[index("monitor_hour").on(t.hour)]);
// A shared lease prevents overlapping cloud tasks from backing up the same day.
export const backupJobs=sqliteTable("backup_jobs",{
 day:text("day").primaryKey(),status:text("status").notNull(),lease_token:text("lease_token").notNull(),
 lease_until:integer("lease_until").notNull(),backup_id:text("backup_id"),attempts:integer("attempts").notNull().default(1),
 updated_at:text("updated_at").notNull(),error:text("error").notNull().default(""),
});
