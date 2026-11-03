import assert from 'node:assert/strict';
import test from 'node:test';
import {database} from './d1-adapter.mjs';
import {workspaceBootstrap} from '../lib/workspace.ts';
import {replicaStart} from '../lib/replica.ts';
import {captureBackup,restoreIntoEmptyDatabase} from '../lib/cloud-backup.ts';
import {backupDay,runDailyBackup,automationStatus,configureBackupSchedule} from '../lib/backup-automation.ts';
import {operationsMcp} from '../lib/operations-mcp.ts';

function storage(){const objects=new Map();return {objects,put:async(k,v)=>{objects.set(k,v);},get:async k=>objects.has(k)?{text:async()=>objects.get(k)}:null};}
const now=Date.parse('2026-10-23T03:00:00+06:00');

test('daily slot uses Bangladesh 3 AM; concurrent tasks and response-loss retry make one verified backup',async()=>{
 assert.equal(backupDay(now-1),'2026-10-22');assert.equal(backupDay(now),'2026-10-23');
 const db=database(),bucket=storage();try{
  await workspaceBootstrap(db);
  const results=await Promise.all(Array.from({length:40},()=>runDailyBackup(db,bucket,now)));
  assert.equal(results.filter(r=>r.replayed===false).length,1);assert.equal(bucket.objects.size,1);
  const saved=await db.prepare('SELECT * FROM backup_jobs').first();assert.equal(saved.status,'succeeded');
  const again=await runDailyBackup(db,bucket,now+60*1000);assert.equal(again.replayed,true);assert.equal(again.backup_id,saved.backup_id);
  // Simulate catalog commit followed by a process crash before job completion.
  await db.prepare("UPDATE backup_jobs SET status='running',lease_until=0,backup_id=NULL").run();
  assert.equal((await runDailyBackup(db,bucket,now+16*60*1000)).backup_id,saved.backup_id);
  assert.equal(bucket.objects.size,1);assert.equal((await db.prepare('SELECT COUNT(*) AS n FROM backup_catalog').first()).n,1);
  await runDailyBackup(db,bucket,now+24*60*60*1000);assert.equal(bucket.objects.size,2);
 }finally{db.connection.close();}
});

test('failed upload records safe failure, backs off, then retries; expired leases recover',async()=>{
 const db=database(),bucket=storage();try{
  await workspaceBootstrap(db);
  const broken={...bucket,put:async()=>{throw Error('secret-provider-detail');}};
  await assert.rejects(runDailyBackup(db,broken,now));
  let status=await automationStatus(db);assert.equal(status.jobs[0].status,'failed');assert.ok(!JSON.stringify(status).includes('secret-provider-detail'));
  assert.equal((await runDailyBackup(db,bucket,now+1)).status,'failed');assert.equal(bucket.objects.size,0);
  assert.equal((await runDailyBackup(db,bucket,now+5*60*1000)).status,'succeeded');
  await db.prepare("INSERT INTO backup_jobs(day,status,lease_token,lease_until,updated_at) VALUES ('2026-10-24','running','dead-process',0,'old')").run();
  assert.equal((await runDailyBackup(db,bucket,now+24*60*60*1000)).status,'succeeded');
 }finally{db.connection.close();}
});

test('recovery preserves initialization markers, custom alert levels and empty customer list',async()=>{
 const db=database(),copy=database();try{
  const base=await replicaStart(db,true);
  assert.ok(base);
  await db.prepare('DELETE FROM customers').run();
  await db.prepare('UPDATE products SET low_stock_level=10').run();
  const backup=await captureBackup(db,'fixture');
  for(const key of ['initial_records_v1','balanced_transfers_v1','product_categories_v1','alert_levels_2026_10_18_20_to_10_10_to_5_v1'])assert.ok(backup.meta.some(row=>row.key===key),key);
  await restoreIntoEmptyDatabase(copy,backup);await replicaStart(copy,true);
  assert.deepEqual((await captureBackup(copy,'fixture')).tables,backup.tables);
 }finally{db.connection.close();copy.connection.close();}
});

test('only the verified Site owner may use the backup service; app cookies and other users are denied',async()=>{
 const db=database(),bucket=storage(),env={DB:db,BACKUPS:bucket,SITES_OPERATIONS_OWNER_EMAIL:'owner@example.test'};
 const call=(name,args={},headers={})=>operationsMcp(new Request('https://fixture.test/mcp',{method:'POST',headers:{'Content-Type':'application/json',...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:args}})}),env);
 try{
  await workspaceBootstrap(db);
  assert.equal((await call('run_daily_backup')).status,403);
  assert.equal((await call('run_daily_backup',{}, {Cookie:'arafat_session=fixture'})).status,403);
  assert.equal((await call('run_daily_backup',{}, {'oai-authenticated-user-email':'other@example.test'})).status,403);
  const auth={'oai-authenticated-user-email':'OWNER@example.test'};
  assert.equal((await (await call('run_daily_backup',{},auth)).json()).result.isError,undefined);
  const bad=await (await call('run_daily_backup',{download:true},auth)).json();assert.equal(bad.result.isError,true);
  const unknown=await (await call('delete_data',{},auth)).json();assert.equal(unknown.result.isError,true);
  await configureBackupSchedule(db,'saved-task-fixture');
  const status=JSON.stringify(await (await call('get_backup_status',{},auth)).json());assert.ok(!status.includes('products'));assert.ok(!status.includes('secret'));
  assert.equal((await automationStatus(db)).schedule.time,'03:00');
  const oversized=await operationsMcp(new Request('https://fixture.test/mcp',{method:'POST',body:' '.repeat(8193)}),env);assert.equal(oversized.status,413);
 }finally{db.connection.close();}
});
