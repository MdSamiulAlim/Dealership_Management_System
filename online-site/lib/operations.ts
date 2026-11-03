import {automationStatus} from './backup-automation.ts';
export async function recordRequest(db:D1Database,request:Request,status:number,duration:number){
 const path=new URL(request.url).pathname;
 const segment=path.split('/')[2]||'';
 const first=['login','logout','check-login','bootstrap','export','commands','replica','admin','reset-workspace','sales','invoices','products','customers','orders','payments','adjustments','transactions','sync-akij'].includes(segment)?segment:'other';
 const route=path.startsWith('/api/')?'/api/'+first:'/healthz';
 const hour=new Date().toISOString().slice(0,13),key=[hour,request.method,route,status].join('|');
 await db.batch([
  db.prepare('INSERT INTO monitor_buckets(key,hour,route,status,requests,duration_ms,max_ms) VALUES (?,?,?,?,1,?,?) ON CONFLICT(key) DO UPDATE SET requests=requests+1,duration_ms=duration_ms+excluded.duration_ms,max_ms=MAX(max_ms,excluded.max_ms)').bind(key,hour,route,status,duration,duration),
  db.prepare("DELETE FROM monitor_buckets WHERE hour<strftime('%Y-%m-%dT%H','now','-30 days')"),
 ]);
}
export async function operationsStatus(db:D1Database,cloudBackupAvailable:boolean){
 const result=await db.batch([
  db.prepare("SELECT hour,route,status,SUM(requests) AS requests,SUM(duration_ms) AS duration_ms,MAX(max_ms) AS max_ms FROM monitor_buckets WHERE hour>=strftime('%Y-%m-%dT%H','now','-24 hours') GROUP BY hour,route,status ORDER BY hour DESC"),
  db.prepare('SELECT id,sha256,bytes,actor,summary_json,created_at FROM backup_catalog ORDER BY created_at DESC LIMIT 20'),
  db.prepare('SELECT COALESCE(MAX(seq),0) AS revision,COUNT(*) AS events FROM audit_events'),
 ]);
 const automation=await automationStatus(db);
 return {database:'ok',cloud_backup:cloudBackupAvailable,metrics:result[0].results,backups:result[1].results,journal:result[2].results[0],server_time:new Date().toISOString(),monitoring_retention_days:30,automatic_backups:!!automation.schedule,automation,external_alerts:false};
}
export function securityHeaders(request:Request,response:Response){
 const headers=new Headers(response.headers);
 headers.set('X-Content-Type-Options','nosniff');headers.set('X-Frame-Options','DENY');
 headers.set('Referrer-Policy','strict-origin-when-cross-origin');headers.set('Permissions-Policy','camera=(), microphone=(), geolocation=()');
 headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
 if(new URL(request.url).protocol==='https:')headers.set('Strict-Transport-Security','max-age=31536000; includeSubDomains');
 if(new URL(request.url).pathname==='/healthz')headers.set('Cache-Control','no-store');
 return new Response(response.body,{status:response.status,statusText:response.statusText,headers});
}
