import { customerDueStatement } from '../public/customer-due.mjs';
import { InputError } from './ledger.ts';
import { businessSettings, ensureWorkspace } from './workspace.ts';
export async function getCustomerDue(db:D1Database,value:string){
 const id=Number(value);if(!/^[1-9]\d*$/.test(value)||!Number.isSafeInteger(id))throw new InputError('Choose a valid customer.');
 await ensureWorkspace(db);
 // One D1 read transaction keeps the receipt's invoices, returns and payments
 // consistent even while another device is saving a collection.
 const data=await db.batch([
  db.prepare('SELECT * FROM customers WHERE id=?').bind(id),
  db.prepare('SELECT * FROM invoices WHERE customer_id=? ORDER BY sale_date,created_at,id').bind(id),
  db.prepare('SELECT * FROM customer_payments WHERE customer_id=? ORDER BY payment_date,created_at,id').bind(id),
  db.prepare('SELECT r.* FROM invoice_returns r JOIN invoices i ON i.id=r.invoice_id WHERE i.customer_id=? ORDER BY r.return_date,r.created_at,r.id').bind(id),
 ]);
 const customer=data[0].results[0];if(!customer)throw new InputError('Customer not found. Refresh and try again.',404);
 return {...customerDueStatement(customer,data[1].results,data[2].results,data[3].results),settings:await businessSettings(db)};
}
