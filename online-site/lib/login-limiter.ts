import { InputError } from './ledger.ts';
const windowMs=60_000,limit=10;
export async function reserveLoginAttempt(db:D1Database,ip:string,now=Date.now()){
 // Reserve before password verification. UPSERT + RETURNING is one serialized
 // database operation, including across Workers and concurrent login requests.
 const key='login:'+ip;
 const row=await db.prepare(`INSERT INTO login_rate_limits(key,count,expires_at) VALUES (?,1,?)
  ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE MIN(count+1,1000000) END,
  expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count,expires_at`).bind(key,now+windowMs,now,now).first<{count:number;expires_at:number}>();
 if(!row||row.count>limit)throw new InputError('Too many login attempts. Try again in one minute.',429);
 return {key,expires_at:row.expires_at};
}
export async function releaseVerifiedBasic(db:D1Database,reservation:{key:string;expires_at:number}){
 // Successful legacy API authentication does not consume a login budget.
 await db.prepare('UPDATE login_rate_limits SET count=MAX(count-1,0) WHERE key=? AND expires_at=?').bind(reservation.key,reservation.expires_at).run();
}
