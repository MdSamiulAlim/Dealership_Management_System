import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {database} from './d1-adapter.mjs';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';
import * as testReplica from '../public/replica.mjs';
import {replicaStart,replicaPage,replicaBundle,replicaChanges,revision} from '../lib/replica.ts';
import {journalReports,allocateCents} from '../public/report-journal.mjs';
import {resetWorkspace as resetServer} from '../lib/workspace-access.ts';

// Each browser context is disposable; the IndexedDB adapter is shared across
// contexts to model a full reload with no surviving JS memory or operation ID.
async function replicaReply(db,user,path){
 if(path==='/api/check-login')return Response.json({user,sync_protocol:2});
 if(!path.startsWith('/api/replica/'))return null;
 const url=new URL(path,'https://fixture.test');return Response.json(url.pathname.endsWith('/start')?await replicaStart(db,url.searchParams.get('packed')==='1'):url.pathname.endsWith('/bundle')?await replicaBundle(db,url):url.pathname.endsWith('/rows')?await replicaPage(db,url):await replicaChanges(db,url));
}
function browser(storage,fetch,storageFailure=false,hooks={}){
 let source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8');
 source=source.replace('let journalReports=null,shares=null','let journalReports=testJournal,shares=testShares').replace("await import('/replica.mjs?v=sync-ui-fixes-2026-v1')",'testReplica');
 const start=source.indexOf('  async function read('),end=source.indexOf('  async function derive(',start);
 source=source.slice(0,start)+`  async function read(name=VAULT){return storageRead(name);}\n  async function write(value,expected,name=VAULT){return storageWrite(value,expected,name);}\n`+source.slice(end);
 // Supply only IndexedDB account-selection I/O for the VM harness.
 const selectStart=source.indexOf('  async function selectAccountVault('),selectEnd=source.indexOf('  async function signIn(',selectStart);
 source=source.slice(0,selectStart)+`  async function selectAccountVault(owner){const current=await read();return current?.username===owner?current:null;}\n`+source.slice(selectEnd);
 const c=vm.createContext({testJournal:journalReports,testShares:allocateCents,testReplica,crypto:webcrypto,structuredClone,Intl,fetch,AbortController,CustomEvent,Event,TextEncoder,TextDecoder,btoa,atob,clearTimeout,setTimeout,setInterval(){},localStorage:{getItem(){return null},setItem(){}},navigator:{onLine:true,locks:hooks.locks},window:{addEventListener(){},dispatchEvent(){}},
  storageRead:async name=>structuredClone(storage.get(name)||null),
  storageWrite:async(value,expected,name)=>{if(storageFailure)throw Error('Fixture storage unavailable');await hooks.beforeWrite?.(value,name);assert.equal(storage.get(name)?.revision||0,expected);storage.set(name,structuredClone(value));},
 });
 vm.runInContext(source,c);return c.window.WorkspaceStore;
}
for(const lost of ['disconnect','truncated-json','server-error'])test(`online-only payment survives ${lost}, retry and a full reload without doubling`,async()=>{
 const db=database(),storage=new Map(),sent=[];let lose=true;
 try{
  const base=await workspaceBootstrap(db),user={username:'FixtureOwner',role:'admin'};
  const fetch=async(path,options)=>{
   const reply=await replicaReply(db,user,path);if(reply)return reply;
   if(path==='/api/bootstrap')return Response.json({...await workspaceBootstrap(db),user});
   assert.equal(path,'/api/commands');const op=JSON.parse(options.body);sent.push(op.id);
   const result=await executeCommand(db,op),snapshot={sync_protocol:2,sync_revision:await revision(db),command_result:result};
   if(lose){lose=false;if(lost==='disconnect')throw Error('Fixture lost response');if(lost==='truncated-json')return {ok:true,json:async()=>{throw Error('truncated');}};return Response.json({error:'Fixture response lost'},{status:500});}
   return Response.json(snapshot);
  };
  let store=browser(storage,fetch);await store.request('/api/bootstrap');
  const payload={payment_date:'2026-10-23',customer_id:base.customers[0].id,amount:100,account:'Cash'},options={method:'POST',body:JSON.stringify(payload)};
  const pending=await store.request('/api/payments',options);
  assert.equal(store.status().enabled,false);assert.equal(store.status().pending,1);assert.equal(pending.dashboard.cash_balance,100);
  assert.match(store.status().error,/pending/);
  await assert.rejects(store.discard(store.status().queue[0].id),/pending/);
  await assert.rejects(store.signOut(),/pending/);
  const saved=storage.get('online-outbox:FixtureOwner');assert.ok(saved.deviceKey);assert.ok(saved.cipher);assert.equal(saved.base,undefined);assert.equal(saved.queue,undefined);
  // An actual reload gets an already-committed server snapshot, but must first
  // reconcile the journal instead of projecting the payment a second time.
  store=browser(storage,fetch);const reconciled=await store.request('/api/bootstrap');
  assert.equal(reconciled.dashboard.cash_balance,100);assert.equal(store.status().pending,0);assert.equal(new Set(sent).size,1);
  assert.equal((await workspaceBootstrap(db)).payments.length,1);
  const cleared=storage.get('online-outbox:FixtureOwner');
  const journal=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(cleared.iv,'base64')},cleared.deviceKey,Buffer.from(cleared.cipher,'base64'))));
  assert.equal(journal.base,null);assert.deepEqual(journal.queue,[]);
  // A later intentional collection may have the same amount and customer.
  await store.request('/api/payments',options);
  assert.equal((await workspaceBootstrap(db)).payments.length,2);assert.equal(new Set(sent).size,2);
 }finally{db.connection.close();}
});

test('retrying the same unresolved form reuses its operation ID and storage failure sends nothing',async()=>{
 const db=database(),storage=new Map();let lose=true,sent=0;
 try{
  const base=await workspaceBootstrap(db),user={username:'FixtureOwner',role:'admin'},ids=[];
  const fetch=async(path,options)=>{const reply=await replicaReply(db,user,path);if(reply)return reply;if(path==='/api/bootstrap')return Response.json({...await workspaceBootstrap(db),user});sent++;const op=JSON.parse(options.body);ids.push(op.id);const result=await executeCommand(db,op);if(lose){lose=false;throw Error('Lost');}return Response.json({sync_protocol:2,command_result:result});};
  let store=browser(storage,fetch);await store.request('/api/bootstrap');
  const options={method:'POST',body:JSON.stringify({payment_date:'2026-10-23',customer_id:base.customers[0].id,amount:100,account:'Cash'})};
  await store.request('/api/payments',options);await store.request('/api/payments',options);
  assert.equal(ids.length,2);assert.equal(ids[0],ids[1]);assert.equal((await workspaceBootstrap(db)).payments.length,1);
  const before=sent;store=browser(new Map(),fetch,true);await store.request('/api/bootstrap');
  await assert.rejects(store.request('/api/payments',options),/storage unavailable/);assert.equal(sent,before);
 }finally{db.connection.close();}
});


test('packed first login needs three requests; verified repeat login uses cache and refreshes after paint',async()=>{
 const db=database(),storage=new Map(),calls=[];let user={username:'FixtureOwner',role:'admin'},blocked=false,release;
 const gate=new Promise(resolve=>release=resolve);
 try{
  const fetch=async(path,options)=>{
   calls.push(path);
   if(path==='/api/login'){user={username:JSON.parse(options.body).username,role:'admin'};return Response.json({ok:true,user});}
   if(path==='/api/logout')return Response.json({ok:true});
   if(blocked&&path.includes('/changes?'))await gate;
   return replicaReply(db,user,path);
  };
  const store=browser(storage,fetch);await store.signIn('FixtureOwner','fixture-only');
  assert.equal(calls.length,3);assert.equal(calls[0],'/api/login');assert.equal(calls[1],'/api/replica/start?packed=1');assert.ok(calls[2].includes('/changes?'));
  assert.ok(storage.has('online-replica:FixtureOwner'));
  await store.signOut();assert.ok(storage.has('online-replica:FixtureOwner'),'encrypted cache survives logout');
  blocked=true;calls.length=0;const cached=await store.signIn('FixtureOwner','fixture-only');
  assert.equal(cached.user.username,'FixtureOwner');assert.equal(calls.length,1);assert.equal(calls[0],'/api/login');assert.equal(cached.needs_refresh,true);
  // Allow background refresh to start, then revoke while that GET is in flight.
  for(let i=0;i<50&&!calls.some(path=>path.includes('/changes?'));i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.ok(calls.some(path=>path.includes('/changes?')));
  await store.signOut();release();await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(store.status().signedOut,true);assert.equal(store.status().username,'');assert.throws(()=>store.project(),/snapshot/);
 }finally{release();db.connection.close();}
});

test('cached records are not opened after session rejection and idle refresh avoids re-encryption',async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};
 try{
  const fetch=async(path)=>replicaReply(db,user,path);
  let store=browser(storage,fetch);await store.request('/api/bootstrap');
  const first=storage.get('online-replica:FixtureOwner').revision;
  await store.request('/api/bootstrap');assert.equal(storage.get('online-replica:FixtureOwner').revision,first);
  store=browser(storage,async()=>Response.json({error:'Session revoked'},{status:401}));
  await assert.rejects(store.request('/api/bootstrap'),/revoked/);assert.equal(store.status().signedOut,true);assert.throws(()=>store.project(),/snapshot/);
 }finally{db.connection.close();}
});

async function encryptedFixture(storage,name,value,owner='FixtureOwner',password=null){
 const salt=webcrypto.getRandomValues(new Uint8Array(16));
 const deviceKey=password?await webcrypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt,iterations:250000},await webcrypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,['encrypt','decrypt']):await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=webcrypto.getRandomValues(new Uint8Array(12)),cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},deviceKey,new TextEncoder().encode(JSON.stringify(value)));
 const record={username:owner,revision:1,format:'arafat-encrypted-v2',iv:Buffer.from(iv).toString('base64'),cipher:Buffer.from(cipher).toString('base64'),...(password?{salt:Buffer.from(salt).toString('base64')}:{deviceKey})};
 storage.set(name,record);return record;
}

test('a committed save followed by sync 413 stays pending and replays safely, including old rejected queues',async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'},sent=[];let fail=false;
 try{
  const fetch=async(path,options)=>{
   if(fail&&path.startsWith('/api/replica/changes')){fail=false;return Response.json({error:'Record exceeds the sync page limit.'},{status:413});}
   const reply=await replicaReply(db,user,path);if(reply)return reply;
   assert.equal(path,'/api/commands');const op=JSON.parse(options.body);sent.push(op.id);
   const result=await executeCommand(db,op);fail=sent.length===1;
   return Response.json({sync_protocol:2,command_result:result});
  };
  let store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  await store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-24',amount:100,account:'Cash'})});
  assert.equal(store.status().pending,1);assert.ok(!store.status().queue[0].rejected);assert.match(store.status().error,/pending/);
  // Model a pre-fix browser that incorrectly marked the committed save rejected.
  const saved=storage.get('online-outbox:FixtureOwner'),journal=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(saved.iv,'base64')},saved.deviceKey,Buffer.from(saved.cipher,'base64'))));
  journal.queue[0].rejected=true;journal.queue[0].error='Record exceeds the sync page limit.';
  await encryptedFixture(storage,'online-outbox:FixtureOwner',journal);
  store=browser(storage,fetch);await store.request('/api/bootstrap');
  assert.equal(store.status().pending,0);assert.equal((await workspaceBootstrap(db)).payments.length,1);assert.equal(new Set(sent).size,1);
 }finally{db.connection.close();}
});

for(const vault of [false,true])test(`Sync Codes bypasses the financial queue and repairs an old blocked ${vault?'Offline vault':'online outbox'}`,async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'},sent=[];let syncFails=false,syncCalls=0;
 try{
  const fetch=async(path,options)=>{
   const reply=await replicaReply(db,user,path);if(reply)return reply;
   if(path==='/api/sync-akij'){syncCalls++;assert.equal(options.headers['X-Workspace-Epoch'],'0');if(syncFails)throw Error('Fixture disconnected');return Response.json({...await workspaceBootstrap(db),user,sync:{updated:1}});}
   assert.equal(path,'/api/commands');const op=JSON.parse(options.body);assert.notEqual(op.path,'/api/sync-akij');sent.push(op.id);
   return Response.json({sync_protocol:2,command_result:await executeCommand(db,op)});
  };
  let store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  const next={id:'after-legacy-sync-payment',method:'POST',path:'/api/payments',workspace_epoch:0,temp_id:-100,created_at:Date.now(),payload:{customer_id:base.customers[0].id,payment_date:'2026-10-24',amount:100,account:'Cash'}};
  const legacy={id:'legacy-sync-codes-entry',method:'POST',path:'/api/sync-akij',workspace_epoch:0,payload:{},error:'Unsupported command.',rejected:true};
  await encryptedFixture(storage,vault?'current':'online-outbox:FixtureOwner',{base,queue:[legacy,next],ids:{}},user.username,vault?'fixture-vault-password':null);
  store=browser(storage,fetch);
  if(vault){await store.unlock(user.username,'fixture-vault-password');await store.flush();}else await store.request('/api/bootstrap');
  assert.equal(store.status().pending,0);assert.deepEqual(sent,[next.id]);assert.equal((await workspaceBootstrap(db)).payments.length,1);
  await store.request('/api/sync-akij',{method:'POST',body:'{}'});assert.equal(syncCalls,1);assert.equal(store.status().pending,0);
  syncFails=true;await assert.rejects(store.request('/api/sync-akij',{method:'POST',body:'{}'}),/Connection unavailable/);
  assert.equal(store.status().pending,0);syncFails=false;
  await store.request('/api/payments',{method:'POST',body:JSON.stringify({...next.payload,amount:25})});await store.flush();
  assert.equal(store.status().pending,0);assert.equal((await workspaceBootstrap(db)).payments.length,2);
 }finally{db.connection.close();}
});

test('wrong restore password gives a clear error and leaves device records untouched',async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};
 try{
  const fetch=async path=>replicaReply(db,user,path);
  const store=browser(storage,fetch),base=await store.request('/api/bootstrap'),backupStorage=new Map();
  const backup=await encryptedFixture(backupStorage,'current',{base,queue:[],ids:{}},user.username,'correct-backup-password');
  await assert.rejects(store.restoreDevice(JSON.stringify(backup),user.username,'wrong-password'),/Incorrect password or damaged device backup/);
  assert.equal(storage.has('current'),false);assert.equal(store.status().pending,0);assert.equal(store.project().user.username,user.username);
  await store.restoreDevice(JSON.stringify(backup),user.username,'correct-backup-password');
  assert.equal(store.status().enabled,true);assert.equal(store.project().user.username,user.username);
 }finally{db.connection.close();}
});

test('a write beyond the API limit fails before queueing and does not block the next Save',async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};let sent=0;
 try{
  const fetch=async(path,options)=>{const reply=await replicaReply(db,user,path);if(reply)return reply;assert.equal(path,'/api/commands');sent++;return Response.json({sync_protocol:2,command_result:await executeCommand(db,JSON.parse(options.body))});};
  const store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  await assert.rejects(store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-24',amount:25,account:'Cash',notes:'x'.repeat(1024*1024)})}),/save is too large/);
  assert.equal(store.status().pending,0);assert.equal(sent,0);
  await store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-24',amount:25,account:'Cash'})});
  assert.equal(store.status().pending,0);assert.equal(sent,1);
 }finally{db.connection.close();}
});

async function promptly(promise){let timer;try{return await Promise.race([promise,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Reset action did not reject promptly.')),1000))]);}finally{clearTimeout(timer);}}
function resetGate(){let enter,release;return {entered:new Promise(r=>enter=r),resume:new Promise(r=>release=r),enter:()=>enter(),release:()=>release()};}
for(const vault of [false,true])for(const nativeLocks of [false,true])test(`reset rejects concurrent Save and duplicate reset in ${vault?'vault':'online'} mode with ${nativeLocks?'Web Locks':'fallback locks'}`,async()=>{
 const db=database(),storage=new Map(),gate=resetGate(),user={username:'FixtureOwner',role:'admin'};let resetting,resetCalls=0,lose=false;
 try{
  const fetch=async(path,options)=>{
   if(path==='/api/reset-workspace'){resetCalls++;gate.enter();await gate.resume;await resetServer(db,user,JSON.parse(options.body));return Response.json({...await workspaceBootstrap(db),user});}
   const reply=await replicaReply(db,user,path);if(reply)return reply;
   assert.equal(path,'/api/commands');if(lose)throw Error('Fixture offline');return Response.json({sync_protocol:2,command_result:await executeCommand(db,JSON.parse(options.body))});
  };
  let store=browser(storage,fetch,false,{locks:nativeLocks?navigator.locks:undefined});
  let base=await store.request('/api/bootstrap');
  if(vault){await encryptedFixture(storage,'current',{base,queue:[],ids:{}},user.username,'reset-test-password');store=browser(storage,fetch,false,{locks:nativeLocks?navigator.locks:undefined});await store.unlock(user.username,'reset-test-password');}
  resetting=store.resetWorkspace({id:'reset-request-fixture',workspace_epoch:0,confirmation:'RESET ALL DATA'});
  await gate.entered;
  try{
   await assert.rejects(promptly(store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-30',amount:100,account:'Cash'})})),/Reset is in progress/);
   await assert.rejects(store.resetWorkspace({id:'duplicate-reset-fixture',workspace_epoch:0,confirmation:'RESET ALL DATA'}),/Reset is already in progress/);
   assert.equal(store.status().resetting,true);
  }finally{gate.release();}
  await resetting;assert.equal(resetCalls,1);assert.equal(store.status().resetting,false);assert.equal(store.status().pending,0);assert.equal(store.project().workspace_epoch,1);
  // New post-reset work remains durable even when its send fails and the tab reloads.
  lose=true;await store.request('/api/transactions',{method:'POST',body:JSON.stringify({txn_date:'2026-10-30',type:'Other Income',amount:100,account:'Cash',category:'General'})});
  assert.equal(store.status().pending,1);const id=store.status().queue[0].id;assert.equal(store.status().queue[0].workspace_epoch,1);
  store=browser(storage,fetch);
  if(vault)await store.unlock(user.username,'reset-test-password');else await store.request('/api/bootstrap');
  assert.equal(store.status().queue[0].id,id);assert.equal(store.project().dashboard.cash_balance,100);
 }finally{gate.release();await resetting?.catch(()=>{});db.connection.close();}
});

for(const vault of [false,true])test(`an earlier pending payment blocks ${vault?'vault':'online'} reset and remains after reload`,async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};let resets=0;
 try{
  const fetch=async(path,options)=>{if(path==='/api/reset-workspace'){resets++;throw Error('Reset must not be sent');}const reply=await replicaReply(db,user,path);if(reply)return reply;if(path==='/api/commands')throw Error('Fixture offline');throw Error(path);};
  let store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  if(vault){await encryptedFixture(storage,'current',{base,queue:[],ids:{}},user.username,'reset-test-password');store=browser(storage,fetch);await store.unlock(user.username,'reset-test-password');}
  const saving=store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-30',amount:100,account:'Cash'})});
  const rejected=assert.rejects(store.resetWorkspace({id:'save-before-reset',workspace_epoch:0,confirmation:'RESET ALL DATA'}),/pending/);
  await saving;await rejected;assert.equal(resets,0);assert.equal(store.status().pending,1);
  const id=store.status().queue[0].id;store=browser(storage,fetch);
  if(vault)await store.unlock(user.username,'reset-test-password');else await store.request('/api/bootstrap');
  assert.equal(store.status().queue[0].id,id);assert.equal(store.project().dashboard.cash_balance,100);
 }finally{db.connection.close();}
});

test('failed reset releases the Save guard without changing existing business data',async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};
 try{
  const fetch=async(path,options)=>{if(path==='/api/reset-workspace')return Response.json({error:'Reset fixture failed'},{status:500});const reply=await replicaReply(db,user,path);if(reply)return reply;assert.equal(path,'/api/commands');return Response.json({sync_protocol:2,command_result:await executeCommand(db,JSON.parse(options.body))});};
  const store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  await assert.rejects(store.resetWorkspace({id:'failed-reset-fixture',workspace_epoch:0,confirmation:'RESET ALL DATA'}),/Reset fixture failed/);
  assert.equal(store.status().resetting,false);assert.equal(store.project().workspace_epoch,0);
  await store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-30',amount:100,account:'Cash'})});
  assert.equal(store.project().dashboard.cash_balance,100);
 }finally{db.connection.close();}
});

for(const vault of [false,true])test(`reset checks durable online pending work even when the current ${vault?'vault':'tab'} queue is empty`,async()=>{
 const db=database(),storage=new Map(),user={username:'FixtureOwner',role:'admin'};let resetCalls=0;
 try{
  const fetch=async(path)=>{if(path==='/api/reset-workspace'){resetCalls++;throw Error('Must not reset');}const reply=await replicaReply(db,user,path);if(reply)return reply;throw Error('Fixture offline');};
  let store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  if(vault){await encryptedFixture(storage,'current',{base,queue:[],ids:{}},user.username,'reset-test-password');store=browser(storage,fetch);await store.unlock(user.username,'reset-test-password');}
  const op={id:'another-tab-payment',method:'POST',path:'/api/payments',workspace_epoch:0,created_at:Date.now(),temp_id:-321,payload:{customer_id:base.customers[0].id,payment_date:'2026-10-30',amount:100,account:'Cash'}};
  await encryptedFixture(storage,'online-outbox:FixtureOwner',{base,queue:[op],ids:{}});
  const before=storage.get('online-outbox:FixtureOwner').cipher;assert.equal(store.status().pending,0);
  await assert.rejects(store.resetWorkspace({id:'other-tab-reset',workspace_epoch:0,confirmation:'RESET ALL DATA'}),/pending/);
  assert.equal(resetCalls,0);assert.equal(storage.get('online-outbox:FixtureOwner').cipher,before);
  if(vault){const saved=storage.get('online-outbox:FixtureOwner');const journal=JSON.parse(new TextDecoder().decode(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(saved.iv,'base64')},saved.deviceKey,Buffer.from(saved.cipher,'base64'))));assert.equal(journal.queue[0].id,op.id);}else{store=browser(storage,fetch);await store.request('/api/bootstrap');assert.equal(store.status().queue[0].id,op.id);}
 }finally{db.connection.close();}
});

test('reset keeps its Save guard until the encrypted storage commit completes',async()=>{
 const db=database(),storage=new Map(),gate=resetGate(),user={username:'FixtureOwner',role:'admin'};let armed=false,resetting;
 try{
  const fetch=async(path,options)=>{if(path==='/api/reset-workspace'){await resetServer(db,user,JSON.parse(options.body));armed=true;return Response.json({...await workspaceBootstrap(db),user});}const reply=await replicaReply(db,user,path);if(reply)return reply;throw Error('Unexpected '+path);};
  let store=browser(storage,fetch),base=await store.request('/api/bootstrap');
  await encryptedFixture(storage,'current',{base,queue:[],ids:{}},user.username,'reset-test-password');
  store=browser(storage,fetch,false,{locks:navigator.locks,beforeWrite:async(_,name)=>{if(armed&&name==='current'){armed=false;gate.enter();await gate.resume;}}});
  await store.unlock(user.username,'reset-test-password');
  resetting=store.resetWorkspace({id:'reset-write-gate',workspace_epoch:0,confirmation:'RESET ALL DATA'});await gate.entered;
  try{await assert.rejects(promptly(store.request('/api/payments',{method:'POST',body:JSON.stringify({customer_id:base.customers[0].id,payment_date:'2026-10-30',amount:100,account:'Cash'})})),/Reset is in progress/);}finally{gate.release();}
  await resetting;assert.equal(store.project().workspace_epoch,1);assert.equal(store.status().resetting,false);
 }finally{gate.release();await resetting?.catch(()=>{});db.connection.close();}
});
