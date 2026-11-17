import { InputError, prepareInsert, requireActiveProduct, recordId, money } from './ledger.ts';
import type { Payload, SqlRow } from './records.ts';

const text = (v: unknown) => String(v ?? '').trim();

export function originalCondition(row: SqlRow, original: unknown) {
  if (!original || typeof original !== 'object' || Array.isArray(original)) throw new InputError('Refresh the record before changing it.', 409);
  const source = original as Payload;
  if (Number(source.id) !== Number(row.id)) throw new InputError('Reload the complete transfer before editing.', 409);
  const columns = Object.keys(row);
  if (columns.some(key => !(key in source) || !(source[key] === null || ['string', 'number'].includes(typeof source[key])))) throw new InputError('Reload the complete record before changing it.', 409);
  return { condition: columns.map(key => `${key} IS ?`).join(' AND '), args: columns.map(key => source[key]) };
}

export async function prepareRecordEdit(db: D1Database, entity: string, row: SqlRow, p: Payload, condition: string, args: unknown[]) {
  const next = { ...row, ...p };
  if (entity === 'orders' && !('total_amount' in p)) next.total_amount = money(Number(next.quantity) * Number(next.rate));
  // Reuse creation validation; preparation has no database side effects.
  prepareInsert(db, entity, next);
  for (const key of ['notes', 'reference', 'invoice_no', 'category']) if (text(next[key]).length > (key === 'notes' ? 1000 : 200)) throw new InputError('Keep notes within 1000 characters and references within 200 characters.');
  if (entity === 'orders' || entity === 'adjustments') {
    if (Number(next.product_id) !== Number(row.product_id)) await requireActiveProduct(db, next.product_id);
    if (p.confirmed !== true) throw new InputError('Confirm the stock change first.');
    if (entity === 'orders') {
      return [db.prepare(`UPDATE company_orders SET order_date=?,product_id=?,quantity=?,bag_weight=?,rate=?,total_amount=?,status=?,delivery_date=?,invoice_no=?,notes=? WHERE ${condition}`)
        .bind(text(next.order_date), recordId(next.product_id), Number(next.quantity), Number(next.bag_weight), money(next.rate), money(Number(next.quantity) * Number(next.rate)), text(next.status), text(next.delivery_date), text(next.invoice_no), text(next.notes), ...args)];
    }
    if (!text(next.notes)) throw new InputError('Enter a stock adjustment reason.');
    return [db.prepare(`UPDATE stock_adjustments SET adjust_date=?,product_id=?,type=?,quantity=?,notes=? WHERE ${condition}`)
      .bind(text(next.adjust_date), recordId(next.product_id), text(next.type), Number(next.quantity), text(next.notes), ...args)];
  }
  const transfer = ['Bank Deposit', 'Bank Withdraw'].includes(text(next.type));
  if (row.transfer_id) {
    if (!transfer || p.confirmed !== true) throw new InputError('Confirm the transfer edit. Keep it as Cash to Bank or Bank to Cash.');
    const pair = await db.prepare('SELECT * FROM transactions WHERE transfer_id=? AND id<>?').bind(row.transfer_id, row.id).all<SqlRow>();
    if (pair.results.length !== 1) throw new InputError('Reload the complete transfer before editing.', 409);
    const partner = pair.results[0];
    const expected = originalCondition(partner, p.original_transfer);
    if (row.account === partner.account) throw new InputError('The transfer must have Cash and Bank entries.', 409);
    // One statement guards both originals and updates both sides. A stale
    // counterpart changes neither row; the operation marker records zero.
    return [db.prepare(`WITH matched AS MATERIALIZED (SELECT id,transfer_id FROM transactions WHERE ${condition} AND EXISTS(SELECT 1 FROM transactions WHERE ${expected.condition}))
      UPDATE transactions SET txn_date=?,type=?,amount=?,category=?,reference=?,notes=? WHERE transfer_id IN (SELECT transfer_id FROM matched)`)
      .bind(...args, ...expected.args, text(next.txn_date), text(next.type), money(next.amount), text(next.category) || 'General', text(next.reference), text(next.notes))];
  }
  if (transfer) throw new InputError('Create a new transfer instead of changing a single transaction into a transfer.');
  return [db.prepare(`UPDATE transactions SET txn_date=?,type=?,amount=?,account=?,category=?,reference=?,notes=? WHERE ${condition}`)
    .bind(text(next.txn_date), text(next.type), money(next.amount), text(next.account), text(next.category) || 'General', text(next.reference), text(next.notes), ...args)];
}
