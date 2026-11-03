import { InputError } from './ledger.ts';
import type { AppUser } from './app-access.ts';

const epochKey = 'workspace_epoch_v1';
const resetKey = 'workspace_last_reset_v1';
const resetMessage = 'The Admin reset this workspace. Export or remove old pending work, then refresh before saving.';

export async function workspaceEpoch(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(epochKey).first<{value:string}>();
  return Number(row?.value || 0);
}
export async function requireWorkspaceEpoch(db: D1Database, supplied: unknown): Promise<number> {
  const expected = supplied === undefined ? 0 : supplied;
  if (!Number.isSafeInteger(expected) || Number(expected) < 0 || expected !== await workspaceEpoch(db)) throw new InputError(resetMessage, 409);
  return Number(expected);
}
function epochGuard(db: D1Database, epoch: number) {
  // A failed NOT NULL assertion rolls back the whole D1 batch, including any
  // operation prepared just before another device reset the workspace.
  return db.prepare("INSERT INTO app_meta(key,value) SELECT 'workspace_epoch_guard',NULL WHERE CAST(COALESCE((SELECT value FROM app_meta WHERE key=?),'0') AS INTEGER)<>?").bind(epochKey,epoch);
}
export function guardWorkspaceWrites(db: D1Database, epoch: number): D1Database {
  async function batch(statements: D1PreparedStatement[]) {
    try { return (await db.batch([epochGuard(db,epoch),...statements])).slice(1); }
    catch (error) { await requireWorkspaceEpoch(db,epoch); throw error; }
  }
  function statement(sql: string, args: unknown[] = []): D1PreparedStatement {
    const raw = args.length ? db.prepare(sql).bind(...args) : db.prepare(sql);
    return new Proxy(raw, { get(target, name) {
      if (name === 'bind') return (...values: unknown[]) => statement(sql,values);
      if (name === 'run') return async () => (await batch([raw]))[0];
      const value = Reflect.get(target,name); return typeof value === 'function' ? value.bind(target) : value;
    }});
  }
  return new Proxy(db, { get(target,name) {
    if (name === 'batch') return batch;
    if (name === 'prepare') return statement;
    const value = Reflect.get(target,name); return typeof value === 'function' ? value.bind(target) : value;
  }});
}

export async function resetWorkspace(db: D1Database, user: AppUser, payload: Record<string,unknown>) {
  if (user.role !== 'admin') throw new InputError('Only the Admin can reset all app data.',403);
  if (payload.confirmation !== 'RESET ALL DATA') throw new InputError('Type RESET ALL DATA to confirm.');
  if (typeof payload.id !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(payload.id)) throw new InputError('Invalid reset request.');
  const previous = await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(resetKey).first<{value:string}>();
  const last = previous ? JSON.parse(previous.value) : null;
  if (last?.id === payload.id && last?.username === user.username) return {replayed:true};
  const epoch = await requireWorkspaceEpoch(db,payload.workspace_epoch);
  const guarded = guardWorkspaceWrites(db,epoch);
  const tables = ['invoice_returns','invoice_items','invoices','sales','stock_adjustments','company_orders','customer_payments','transactions','customers','sync_operations'];
  await guarded.batch([
    guarded.prepare("INSERT INTO app_meta(key,value) VALUES ('integrity_reset','1')"),
    ...tables.map(table=>guarded.prepare(`DELETE FROM ${table}`)),
    // Preserve the complete catalog (including archived records and prices),
    // while clearing opening balances after the stock ledger has been removed.
    guarded.prepare('UPDATE products SET opening_stock=0'),
    guarded.prepare("DELETE FROM app_meta WHERE key='integrity_reset'"),
    guarded.prepare('DELETE FROM app_meta WHERE key=?').bind('business_settings_v1'),
    guarded.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES (?,?)').bind(epochKey,String(epoch+1)),
    guarded.prepare('INSERT OR REPLACE INTO app_meta(key,value) VALUES (?,?)').bind(resetKey,JSON.stringify({id:payload.id,username:user.username,at:new Date().toISOString(),epoch:epoch+1})),
  ]);
  // Import markers and ID sequences deliberately survive. Reloading never
  // restores seed records or reuses IDs referenced by old device drafts.
  return {replayed:false};
}
