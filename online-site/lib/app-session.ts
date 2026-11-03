import { authenticateAppUser, type AppUser } from './app-access.ts';
type LoginEnvironment=Parameters<typeof authenticateAppUser>[1]&{DB?:D1Database};
const cookieName='arafat_session';
const encode=(bytes:Uint8Array)=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const decode=(text:string)=>Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
const records=(env:LoginEnvironment)=>[env.APP_LOGIN_PASSWORD_RECORD||'',env.APP_GENERAL_PASSWORD_RECORD||''].join('|');
async function signingKey(env:LoginEnvironment){return crypto.subtle.importKey('raw',new TextEncoder().encode('arafat-session-v1|'+records(env)),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
function account(username:string,env:LoginEnvironment):AppUser|null {
 if(username===env.APP_LOGIN_USERNAME&&env.APP_LOGIN_PASSWORD_RECORD)return {username,role:'admin'};
 if(username===(env.APP_GENERAL_USERNAME||'Arafat')&&env.APP_GENERAL_PASSWORD_RECORD)return {username,role:'general'};
 return null;
}
function cookieValue(request:Request){return request.headers.get('Cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(cookieName+'='))?.slice(cookieName.length+1);}
async function sessionPayload(value:string,env:LoginEnvironment,now:number){
 if(value==='signed-out'||value.length>2048)return null;
 try{
  const [payload,signature,extra]=value.split('.');if(!payload||!signature||extra)return null;
  if(!await crypto.subtle.verify('HMAC',await signingKey(env),decode(signature),new TextEncoder().encode(payload)))return null;
  const data=JSON.parse(new TextDecoder().decode(decode(payload)));
  return typeof data.username==='string'&&typeof data.nonce==='string'&&Number.isFinite(data.expires)&&data.expires>now?data:null;
 }catch{return null;}
}
export async function createAppSession(user:AppUser,env:LoginEnvironment,now=Date.now()){
 if(!env.DB)throw new Error('Session database unavailable');
 const data={username:user.username,expires:now+12*60*60*1000,nonce:crypto.randomUUID()};
 const payload=encode(new TextEncoder().encode(JSON.stringify(data)));
 const signature=encode(new Uint8Array(await crypto.subtle.sign('HMAC',await signingKey(env),new TextEncoder().encode(payload))));
 await env.DB.batch([
  env.DB.prepare('DELETE FROM app_sessions WHERE expires_at<=?').bind(now),
  env.DB.prepare('INSERT INTO app_sessions(id,username,expires_at) VALUES (?,?,?)').bind(data.nonce,data.username,data.expires),
  env.DB.prepare('DELETE FROM login_rate_limits WHERE expires_at<?').bind(now-86400000),
 ]);
 return payload+'.'+signature;
}
export async function revokeAppSession(request:Request,env:LoginEnvironment,now=Date.now()){
 const value=cookieValue(request);if(value===undefined)return;
 const data=await sessionPayload(value,env,now);if(!data)return;
 if(!env.DB)throw new Error('Session database unavailable');
 await env.DB.prepare('UPDATE app_sessions SET revoked_at=? WHERE id=? AND username=? AND revoked_at IS NULL').bind(now,data.nonce,data.username).run();
}
export async function authenticateAppRequest(request:Request,env:LoginEnvironment,now=Date.now()):Promise<AppUser|null>{
 const value=cookieValue(request);
 // A cookie takes precedence over cached Basic credentials, even after logout.
 if(value!==undefined){
  const data=await sessionPayload(value,env,now);if(!data||!env.DB)return null;
  const session=await env.DB.prepare('SELECT username FROM app_sessions WHERE id=? AND username=? AND expires_at>? AND revoked_at IS NULL').bind(data.nonce,data.username,now).first<{username:string}>();
  return session?account(session.username,env):null;
 }
 return authenticateAppUser(request.headers.get('Authorization'),env);
}
export function sessionCookie(value:string,url:string){return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${new URL(url).protocol==='https:'?'; Secure':''}`;}
