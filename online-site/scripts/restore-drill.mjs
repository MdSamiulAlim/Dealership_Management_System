// Usage: node scripts/restore-drill.mjs BACKUP_FILE SHA256 REPORT_FILE
// Restores ONLY to a newly created temporary SQLite/D1-compatible database.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {database} from '../tests/d1-adapter.mjs';
import {verifyBackup,restoreIntoEmptyDatabase,captureBackup,backupSummary,sha256} from '../lib/cloud-backup.ts';
const [file,checksum,reportFile]=process.argv.slice(2);
if(!file||!checksum||!reportFile||!/^([a-f0-9]{64})$/.test(checksum))throw Error('Usage: node scripts/restore-drill.mjs BACKUP_FILE SHA256 REPORT_FILE');
const directory=mkdtempSync(join(tmpdir(),'arafat-restore-drill-')),started=Date.now();let db;
function balances(t){
 const sum=(rows,f)=>Math.round(rows.reduce((n,row)=>n+Number(f(row)||0),0)*100)/100;
 const account=a=>sum(t.sales.filter(r=>r.account===a),r=>r.paid_amount)+sum(t.customer_payments.filter(r=>r.account===a),r=>r.amount)+sum(t.transactions.filter(r=>r.account===a),r=>(a==='Cash'?['Other Income','Bank Withdraw']:['Other Income','Bank Deposit']).includes(r.type)?r.amount:-r.amount);
 return {cash:account('Cash'),bank:account('Bank'),customer_due:sum(t.customers,r=>r.opening_due)+sum(t.sales,r=>r.total_amount-r.paid_amount)-sum(t.customer_payments,r=>r.amount),company_payable:sum(t.company_orders.filter(r=>r.status==='Delivered'),r=>r.total_amount)-sum(t.transactions.filter(r=>r.type==='Company Payment'),r=>r.amount),bags:sum(t.products,r=>r.opening_stock)+sum(t.company_orders.filter(r=>r.status==='Delivered'),r=>r.quantity)-sum(t.sales,r=>r.quantity)+sum(t.stock_adjustments,r=>['Return','Manual Add'].includes(r.type)?r.quantity:-r.quantity)};
}
try{
 const text=readFileSync(resolve(file),'utf8'),backup=await verifyBackup(text,checksum);
 db=database(join(directory,'isolated.sqlite'));const restoredStock=await restoreIntoEmptyDatabase(db,backup,{preserveLegacyStock:true});
 const restored=await captureBackup(db,'verification');assert.deepEqual(restored.tables,backup.tables);assert.deepEqual(restored.audit.slice(0,backup.audit.length),backup.audit);
 const before=balances(backup.tables),after=balances(restored.tables);assert.deepEqual(after,before);
 const report={status:'passed',source:'private-cloud-backup-download',destination:'isolated-temporary-sqlite-d1-compatible',live_database_modified:false,sha256:await sha256(text),completed_at:new Date().toISOString(),duration_ms:Date.now()-started,summary:backupSummary(backup),business_rows_identical:true,historical_audit_preserved:true,financial_balances_identical:true,historical_negative_stock:restoredStock.historical_negative_stock,balances:after};
 writeFileSync(resolve(reportFile),JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(JSON.stringify({status:report.status,duration_ms:report.duration_ms,summary:report.summary,historical_negative_stock_products:restoredStock.historical_negative_stock.length,report:resolve(reportFile)}));
}finally{db?.connection.close();rmSync(directory,{recursive:true,force:true});}
