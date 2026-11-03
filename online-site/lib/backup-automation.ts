import {createCloudBackup,downloadCloudBackup} from './cloud-backup.ts';
import {InputError} from './ledger.ts';

// The daily slot changes at 03:00 Asia/Dhaka, including if a task is retried
// after midnight. A failed attempt can retry after five minutes.
export function backupDay(now=Date.now()){
 return new Date(now+3*60*60*1000).toISOString().slice(0,10);
}
export async function runDailyBackup(db:D1Database,bucket:R2Bucket|undefined,now=Date.now()){
 if(!bucket)throw new InputError('Cloud backup storage is unavailable.',503);
 const day=backupDay(now),token=crypto.randomUUID(),time=new Date(now).toISOString();
 const acquired=await db.prepare("INSERT INTO backup_jobs(day,status,lease_token,lease_until,updated_at) VALUES (?,'running',?,?,?) ON CONFLICT(day) DO UPDATE SET status='running',lease_token=excluded.lease_token,lease_until=excluded.lease_until,attempts=attempts+1,updated_at=excluded.updated_at,error='' WHERE backup_jobs.status<>'succeeded' AND backup_jobs.lease_until<=? RETURNING day").bind(day,token,now+15*60*1000,time,now).first();
 if(!acquired){
  const job=await db.prepare('SELECT day,status,backup_id,updated_at FROM backup_jobs WHERE day=?').bind(day).first();
  return {replayed:true,...job};
 }
 try{
  // Recover a catalogued object if the previous process lost its response
  // after upload, before recording the job as successful.
  const previous=await db.prepare("SELECT id FROM backup_catalog WHERE actor=? ORDER BY created_at DESC LIMIT 1").bind('automatic:'+day).first<{id:string}>();
  let id:string;
  if(previous){await downloadCloudBackup(db,bucket,previous.id);id=previous.id;}
  else{id=(await createCloudBackup(db,bucket,{username:'automatic:'+day,role:'admin'})).id;}
  const result=await db.prepare("UPDATE backup_jobs SET status='succeeded',backup_id=?,lease_until=0,updated_at=?,error='' WHERE day=? AND lease_token=?").bind(id,new Date().toISOString(),day,token).run();
  if(!result.meta.changes)throw new InputError('Backup lease expired. Check the daily backup status.',409);
  return {day,status:'succeeded',backup_id:id,replayed:false};
 }catch(error){
  // Only a safe code is persisted; provider exceptions may contain secrets.
  await db.prepare("UPDATE backup_jobs SET status='failed',lease_until=?,updated_at=?,error='backup_failed' WHERE day=? AND lease_token=?").bind(now+5*60*1000,new Date().toISOString(),day,token).run();
  throw error;
 }
}
export async function automationStatus(db:D1Database){
 const results=await db.batch<Record<string,string|number|null>>([
  db.prepare("SELECT value FROM app_meta WHERE key='backup_automation_v1'"),
  db.prepare('SELECT day,status,backup_id,attempts,updated_at,error FROM backup_jobs ORDER BY day DESC LIMIT 7'),
 ]);
 let schedule=null;
 try{schedule=JSON.parse(String(results[0].results[0]?.value||'null'));}catch{/* Treat invalid config as unconfigured. */}
 return {schedule,jobs:results[1].results};
}
export async function configureBackupSchedule(db:D1Database,id:unknown){
 if(typeof id!=='string'||!id.length||id.length>200||!/^[-a-zA-Z0-9_:]+$/.test(id))throw new InputError('Invalid cloud schedule ID.');
 const value={id,time:'03:00',timezone:'Asia/Dhaka',configured_at:new Date().toISOString()};
 await db.prepare("INSERT INTO app_meta(key,value) VALUES ('backup_automation_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(JSON.stringify(value)).run();
 return value;
}
