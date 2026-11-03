import {database} from './d1-adapter.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {authenticateAppRequest,createAppSession,revokeAppSession,sessionCookie} from '../lib/app-session.ts';
const verifier=password=>{const salt=randomBytes(16);return `pbkdf2-sha256$100000$${salt.toString('hex')}$${pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex')}`;};
const env={DB:database(),APP_LOGIN_USERNAME:'TestOwner',APP_LOGIN_PASSWORD_RECORD:verifier('owner-test-only'),APP_GENERAL_USERNAME:'TestStaff',APP_GENERAL_PASSWORD_RECORD:verifier('staff-test-only')};
const basic='Basic '+Buffer.from('TestOwner:owner-test-only').toString('base64');
const request=(value,authorization=basic)=>new Request('https://app.example/api/bootstrap',{headers:{...(value===undefined?{}:{Cookie:'arafat_session='+value}),Authorization:authorization}});

test('signed session assigns the verified account role, ahead of cached Basic credentials',async()=>{
 const token=await createAppSession({username:'TestStaff',role:'general'},env);
 assert.deepEqual(await authenticateAppRequest(request(token),env),{username:'TestStaff',role:'general'});
 assert.deepEqual(await authenticateAppRequest(request(undefined),env),{username:'TestOwner',role:'admin'});
 assert.equal(await authenticateAppRequest(request('signed-out'),env),null);
});
test('invalid, forged, expired and rotated sessions fail closed without Basic fallback',async()=>{
 const now=Date.now(),token=await createAppSession({username:'TestStaff',role:'admin'},env,now);
 const [payload,signature]=token.split('.');
 const changed=[];
 for(let i=0;i<20;i++){const bytes=Buffer.from(signature,'base64url');bytes[Math.floor(i/8)]^=1<<(i%8);changed.push(payload+'.'+bytes.toString('base64url'));}
 for(const value of ['',token+'.extra','not-a-token',...changed]){assert.notEqual(value,token);assert.equal(await authenticateAppRequest(request(value),env,now),null);}
 assert.equal(await authenticateAppRequest(request(token),env,now+12*60*60*1000),null);
 assert.equal(await authenticateAppRequest(request(token),{...env,APP_GENERAL_PASSWORD_RECORD:verifier('rotated-test-only')},now),null);
 // Client-provided role is never encoded or trusted.
 assert.deepEqual(await authenticateAppRequest(request(token),env,now),{username:'TestStaff',role:'general'});
});
test('session cookies are HttpOnly, same-site, host-only and secure on the hosted app',()=>{
 const cookie=sessionCookie('signed-out','https://app.example/');
 for(const flag of ['Path=/','HttpOnly','SameSite=Strict','Secure'])assert.ok(cookie.includes(flag));
 assert.ok(!cookie.includes('Domain='));assert.ok(!sessionCookie('local-fixture','http://127.0.0.1/').includes('Secure'));
});

test('logout revokes a copied session while another phone stays signed in',async()=>{
 const first=await createAppSession({username:'TestOwner',role:'admin'},env);
 const second=await createAppSession({username:'TestOwner',role:'admin'},env);
 await revokeAppSession(request(first),env);
 assert.equal(await authenticateAppRequest(request(first),env),null);
 assert.deepEqual(await authenticateAppRequest(request(second),env),{username:'TestOwner',role:'admin'});
 await revokeAppSession(request(first),env);
 assert.equal(await authenticateAppRequest(request(first),env),null);
});
test.after(()=>env.DB.connection.close());
