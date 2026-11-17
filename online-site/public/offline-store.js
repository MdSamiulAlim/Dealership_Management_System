/* Password-encrypted device vault. API responses and credentials are never cached by the service worker. */
(() => {
  const DB_NAME='arafat-secure-workspace-v2', STORE='vault', VAULT='current';
  const clone=v=>structuredClone(v), round=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
  const uuid=()=>crypto.randomUUID(), encode=b=>{const bytes=new Uint8Array(b);let text='';for(let i=0;i<bytes.length;i+=8192)text+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(text);}, decode=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
  let journalReports=null,shares=null,percentageDiscount=null;
  async function loadJournal(){if(!journalReports)({journalReports,allocateCents:shares,percentageDiscountCents:percentageDiscount}=await import('/report-journal.mjs?v=percentage-half-up-2026-v1'));}
  let dbPromise,key=null,authorization=null,data=null,record=null,started=false,unlockWait=null,unlockResolve=null,flushing=false,lastError='',online=true;
  let signedOut=false,sessionVersion=0,switching=false,resetting=false;try{signedOut=localStorage.getItem('arafat-signed-out')==='true';}catch{}
  const channel=typeof BroadcastChannel!=='undefined'?new BroadcastChannel('arafat-workspace'):null;
  const emit=()=>window.dispatchEvent(new CustomEvent('workspace:status',{detail:status()}));
  const status=()=>({signedOut,switching,resetting,username:record?.username||data?.base?.user?.username||'',enabled:!!record,locked:!!record&&!key&&!signedOut,pending:data?.queue?.length||0,flushing,error:lastError,online,queue:data?.queue||[],syncProgress,refreshing:refreshing||!!data?.base?.needs_refresh});
  function db(){return dbPromise||=(new Promise((resolve,reject)=>{const r=indexedDB.open(DB_NAME,1);r.onupgradeneeded=()=>r.result.createObjectStore(STORE);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);}));}
  async function read(name=VAULT){const d=await db();return new Promise((resolve,reject)=>{const r=d.transaction(STORE).objectStore(STORE).get(name);r.onsuccess=()=>resolve(r.result||null);r.onerror=()=>reject(r.error);});}
  async function write(value,expected,name=VAULT){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),r=store.get(name);r.onsuccess=()=>{if((r.result?.revision||0)!==expected){tx.abort();return;}store.put(value,name);};tx.oncomplete=resolve;tx.onabort=()=>reject(new Error('Device data changed in another tab. Retry.'));tx.onerror=()=>reject(tx.error);});}
  async function derive(password,salt){const material=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',hash:'SHA-256',salt:decode(salt),iterations:250000},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
  async function decrypt(r,k){return JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:decode(r.iv)},k,decode(r.cipher))));}
  async function encrypt(next,r){const iv=crypto.getRandomValues(new Uint8Array(12));const bytes=new TextEncoder().encode(JSON.stringify(next));const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv},key,bytes);return {...r,revision:(r?.revision||0)+1,iv:encode(iv),cipher:encode(encrypted),format:'arafat-encrypted-v2'};}
  const localLocks=new Map();
  async function exclusive(name,fn){
    if(navigator.locks)return navigator.locks.request(name,fn);
    const before=localLocks.get(name)||Promise.resolve();let release;
    const done=new Promise(resolve=>release=resolve);localLocks.set(name,done);
    await before;
    try{return await fn();}finally{release();if(localLocks.get(name)===done)localLocks.delete(name);}
  }
  async function mutate(fn){const version=sessionVersion,owner=record?.username;return exclusive('arafat-vault-write',async()=>{if(version!==sessionVersion)throw Error('Account changed. Please retry.');const latest=await read();if(!latest||!key||signedOut||latest.username!==owner)throw Error('Unlock Offline mode first.');const next=await decrypt(latest,key);await fn(next);const encrypted=await encrypt(next,latest);await write(encrypted,latest.revision||0);record=encrypted;data=next;channel?.postMessage('changed');emit();return next;});}
  async function start(){if(signedOut)throw loginRequired();await loadJournal();if(started){if(record&&!key)await waitUnlock();return;}started=true;try{record=await read();}catch{record=null;lastError='Offline storage is unavailable on this browser.';}if(record&&!key)await waitUnlock();}
  async function waitUnlock(){if(!unlockWait)unlockWait=new Promise(resolve=>unlockResolve=resolve);emit();window.dispatchEvent(new Event('workspace:unlock-required'));await unlockWait;}
  async function transport(path,options={}){if(signedOut&&!['/api/login','/api/logout'].includes(path))throw loginRequired();const version=sessionVersion;const headers={'Content-Type':'application/json',...(options.headers||{})};if(authorization&&!headers.Authorization)headers.Authorization=authorization;const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),12000);let response;try{response=await fetch(path,{...options,headers,signal:controller.signal,credentials:'same-origin',redirect:'error'});}catch{online=false;emit();const error=Error('Connection unavailable.');error.network=true;throw error;}finally{clearTimeout(timeout);}if(version!==sessionVersion)throw Error('Account changed. Please retry.');online=true;let payload;try{payload=await response.json();}catch{const error=Error('Unexpected server response.');error.network=true;throw error;}if(!response.ok){if(response.status===401&&path!=='/api/login'){sessionVersion++;key=null;authorization=null;data=null;signedOut=true;rememberSignOut(true);window.dispatchEvent(new Event('workspace:sign-in-required'));emit();}const error=Error(payload.error||'Request failed');error.status=response.status;throw error;}return payload;}
  let replicaModule=null,syncProgress=0,refreshing=false,refreshScheduled=false;
  async function replicaTools(){return replicaModule||=await import('/replica.mjs?v=sync-ui-fixes-2026-v1');}
  const replicaName=owner=>'online-replica:'+owner;
  async function saveReplica(base){
    const name=replicaName(base.user.username),saved=await read(name),deviceKey=saved?.deviceKey||await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
    const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},deviceKey,new TextEncoder().encode(JSON.stringify(base)));
    await write({deviceKey,revision:(saved?.revision||0)+1,iv:encode(iv),cipher:encode(cipher)},saved?.revision||0,name);
  }
  function refreshSoon(){
    if(refreshScheduled||signedOut)return;refreshScheduled=true;const version=sessionVersion;
    setTimeout(async()=>{
      refreshScheduled=false;if(version!==sessionVersion||signedOut||switching||flushing||data?.queue.length||!data?.base||!navigator.onLine)return;
      refreshing=true;emit();
      try{const snapshot=await request('/api/bootstrap');if(version===sessionVersion&&!signedOut)window.dispatchEvent(new CustomEvent('workspace:data',{detail:snapshot}));}
      catch(error){if(version===sessionVersion&&!signedOut){lastError=error.message;emit();}}
      finally{refreshing=false;emit();}
    },0);
  }
  async function replicatedBootstrap(options={},knownUser=null,preferCache=false){
    const login=knownUser?{user:knownUser}:await transport('/api/check-login',options),replica=await replicaTools();
    const firstLoad=!data?.base;
    let base=data?.base?.user?.username===login.user.username?data.base:null;
    if(!base){const saved=await read(replicaName(login.user.username));if(saved)try{base=await decrypt(saved,saved.deviceKey);}catch{/* Safely replace a damaged cache from the server. */}}
    if(base&&(preferCache||firstLoad))return {...base,user:clone(login.user),needs_refresh:true};
    let snapshot;
    try{snapshot=base?.sync_revision!==undefined?await replica.pullChanges({...base,user:login.user},transport):await replica.initialReplica(transport,login.user,n=>{syncProgress=n;emit();});}
    catch(error){if(error.status!==409||data?.queue?.length)throw error;snapshot=await replica.initialReplica(transport,login.user,n=>{syncProgress=n;emit();});}
    // Empty polls retain their calculated values; avoid full-history processing
    // and encryption when the journal revision did not change.
    const changed=!base||base.sync_revision!==snapshot.sync_revision||base.workspace_epoch!==snapshot.workspace_epoch;
    if(changed)recalculate(snapshot);delete snapshot.needs_refresh;syncProgress=0;
    if(!key&&changed)try{await saveReplica(snapshot);}catch{/* The durable outbox persists independently. */}
    return snapshot;
  }
  async function network(path,options={}){
    if(path==='/api/bootstrap')return replicatedBootstrap(options);
    if(path==='/api/commands'){
      const result=await transport(path,{...options,headers:{...options.headers,'X-Workspace-Protocol':'2'}});
      if(result.sync_protocol===2){try{const replica=await replicaTools();const snapshot=await replica.pullChanges(data.base,transport);recalculate(snapshot);delete snapshot.needs_refresh;if(!key)try{await saveReplica(snapshot);}catch{}return {...snapshot,command_result:result.command_result};}catch(error){error.pendingSync=true;throw error;}}
      return result;
    }
    return transport(path,options);
  }
  const onlineName=owner=>'online-outbox:'+owner;
  async function readOnline(snapshot,version=sessionVersion){
    const owner=snapshot.user?.username;if(!owner)return false;
    const saved=await read(onlineName(owner));if(!saved)return false;
    const restored=await decrypt(saved,saved.deviceKey);
    if(version!==sessionVersion||signedOut)throw Error('Account changed. Please retry.');
    if(!restored.queue?.length)return false;
    restored.base.user=clone(snapshot.user);data=restored;emit();return true;
  }
  async function mutateOnline(fn){
    const version=sessionVersion,owner=data?.base?.user?.username;
    if(!owner||signedOut)throw loginRequired();
    return exclusive('arafat-online-outbox-write',async()=>{
      if(version!==sessionVersion||signedOut)throw Error('Account changed. Please retry.');
      const name=onlineName(owner);let saved=await read(name);
      if(!saved)saved={username:owner,revision:0,deviceKey:await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt'])};
      const next=saved.cipher?await decrypt(saved,saved.deviceKey):clone(data);
      if(!next.queue.length)next.base=clone(data.base);
      await fn(next);
      const iv=crypto.getRandomValues(new Uint8Array(12));
      const persisted=next.queue.length?next:{base:null,queue:[],ids:next.ids};
      const cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv},saved.deviceKey,new TextEncoder().encode(JSON.stringify(persisted)));
      if(version!==sessionVersion||signedOut)throw Error('Account changed. Please retry.');
      await write({...saved,revision:saved.revision+1,iv:encode(iv),cipher:encode(cipher)},saved.revision,name);
      data=next;emit();return next;
    });
  }
  const canonical=value=>JSON.stringify(value&&typeof value==='object'?Array.isArray(value)?value.map(v=>JSON.parse(canonical(v))):Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])):value);
  function prepareWire(command){
    const op=clone(command);op.payload=resolveIds(op.payload,data.ids);op.path=op.path.replace(/\/(-\d+)(?=\/|$)/g,(_,id)=>'/'+(data.ids[id]||id));
    if(Number(op.payload.original?.id)<0){
      const entity=op.path.split('/')[2],id=op.path.split('/')[3],current=data.base[entity]?.find(row=>String(row.id)===id);
      if(!current)throw Error('A pending dependency has not synced yet.');
      op.payload.original={...clone(current),...op.payload.original,id:current.id};
    }
    delete op.error;delete op.conflict;delete op.rejected;return op;
  }
  function acceptCommand(next,op,result){
    if(Number(op.temp_id)<0){if(op.payload.customer_id==='new'&&result.command_result?.customer_id)next.ids[String(op.temp_id)]=result.command_result.customer_id;else if(result.command_result?.entity!=='invoices'&&result.command_result?.id)next.ids[String(op.temp_id)]=result.command_result.id;}
    next.queue=next.queue.filter(q=>q.id!==op.id);next.base=result;next.saved_at=new Date().toISOString();
  }
  function repairLegacyQueue(next){
    // Sync Codes was never a supported financial command and could not commit
    // through /api/commands. Remove only that invalid maintenance entry.
    next.queue=next.queue.filter(op=>!(op.path==='/api/sync-akij'&&op.method==='POST'));
    for(const op of next.queue)if(op.error==='Record exceeds the sync page limit.'&&(op.wire||op.sent)){
      delete op.rejected;delete op.conflict;delete op.error;
    }
  }
  async function flushOnline(){
    if(signedOut||switching||resetting||flushing||!data?.queue.length||!navigator.onLine)return;
    return exclusive('arafat-online-outbox-sync',async()=>{
      if(signedOut||switching||resetting||flushing||!data?.queue.length)return;
      flushing=true;lastError='';emit();
      try{
        // Read the latest durable journal before sending. Retries always use
        // the exact persisted ID and payload, even after a lost response/reload.
        await mutateOnline(repairLegacyQueue);
        while(data.queue.length){
          const queued=data.queue[0];if(queued.rejected)throw Error(queued.error||'Review the pending action before retrying.');
          const op=queued.wire||prepareWire(queued);
          await mutateOnline(d=>{const q=d.queue.find(q=>q.id===op.id);if(q){q.wire=clone(op);q.sent=true;}});
          let result;
          try{result=await network('/api/commands',{method:'POST',body:JSON.stringify(op)});}
          catch(error){
            lastError=error.network||error.status>=500||error.pendingSync?'Save status is pending. Use Sync Now to safely check and retry.':error.message;
            if(!signedOut&&data)await mutateOnline(d=>{const q=d.queue.find(q=>q.id===op.id);if(q){q.error=lastError;q.rejected=!error.pendingSync&&!!error.status&&error.status<500&&error.status!==401;q.conflict=error.status===409;}});
            if(error.network||error.status>=500||error.pendingSync)return;
            throw error;
          }
          await mutateOnline(d=>acceptCommand(d,op,result));
          window.dispatchEvent(new CustomEvent('workspace:data',{detail:project()}));
        }
      }finally{flushing=false;emit();}
    });
  }
  async function flush(){return key?flushVault():flushOnline();}
  async function prepareShell(){if(!('serviceWorker' in navigator))throw Error('This browser cannot reopen the app Offline. Update your browser or Android System WebView.');const registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'});await registration.update();const until=Date.now()+25000;while(Date.now()<until){const shell=await caches.match('/offline-shell.txt');if(shell&&registration.active)return;await new Promise(resolve=>setTimeout(resolve,150));}throw Error('Offline files are still downloading. Keep the connection on and retry Enable Offline.');}
  async function enable(username,password){await loadJournal();if(data?.queue?.length)throw Error('Sync pending work before enabling Offline mode.');if(data?.base?.user?.username&&username!==data.base.user.username)throw Error('Use the header account button to change users.');const auth='Basic '+btoa(unescape(encodeURIComponent(username+':'+password)));await network('/api/login',{method:'POST',body:JSON.stringify({username,password})});if(record)throw Error('Offline mode is already configured. Unlock it instead.');await prepareShell();const salt=encode(crypto.getRandomValues(new Uint8Array(16)));const k=await derive(password,salt);const snapshot=await network('/api/bootstrap',{headers:{Authorization:auth}});key=k;authorization=auth;const next={base:snapshot,queue:[],ids:{},saved_at:new Date().toISOString()};const r={username,salt,revision:0};try{const encrypted=await encrypt(next,r);await write(encrypted,0);record=encrypted;data=next;started=true;unlockResolve?.();unlockResolve=null;unlockWait=null;emit();return project();}catch(e){key=null;authorization=null;throw e;}}
  async function unlock(username,password){await loadJournal();if(signedOut)throw loginRequired();record=await read();if(!record)throw Error('This device has no Offline data. Connect once and enable Offline mode in Settings.');if(username!==record.username)throw Error('Incorrect User ID.');try{const k=await derive(password,record.salt);const next=await decrypt(record,k);key=k;data=next;authorization='Basic '+btoa(unescape(encodeURIComponent(username+':'+password)));}catch{throw Error('Incorrect password or damaged device backup.');}started=true;unlockResolve?.();unlockResolve=null;unlockWait=null;emit();return project();}
  function amounts(p){
    if(!Array.isArray(p.items)||!p.items.length||p.items.length>40)throw Error('Add between 1 and 40 invoice items.');
    const items=p.items.map(i=>{wholeBags(i.quantity,'Quantity',1);if(i.rate==null||String(i.rate).trim()==='')throw Error('Enter a quantity and rate for every invoice item.');validAmount(i.rate);return {...i,quantity:Number(i.quantity),rate:round(i.rate)};});
    const gross=items.map(i=>{validAmount(i.quantity*i.rate);return Math.round(round(i.quantity*i.rate)*100);});
    const subtotal=gross.reduce((a,b)=>a+b,0);if(subtotal>100000000000000)throw Error('Invoice subtotal cannot exceed 1,000,000,000,000.');
    const raw=p.discount_value??p.discount??0;validAmount(raw);const value=round(raw);if(!['amount','percent','',undefined,null].includes(p.discount_type))throw Error('Choose amount or percent.');
    if(p.discount_type==='percent'&&value>100)throw Error('Check the discount and paid amount.');
    const discount=p.discount_type==='percent'?percentageDiscount(subtotal,Math.round(value*100)):Math.round(value*100);const total=subtotal-discount;validAmount(p.paid_amount??0);const paid=Math.round(round(p.paid_amount)*100);
    if(discount<0||total<0||paid>total)throw Error('Check the discount and paid amount.');
    if(p.total_amount!==undefined&&p.total_amount!==''&&round(p.total_amount)!==total/100)throw Error('Total must match the calculated quantity and rate.');
    const net=shares(total,gross),payments=shares(paid,net);return {subtotal:subtotal/100,discount:discount/100,total_amount:total/100,paid_amount:paid/100,items:items.map((i,n)=>({...i,line_total:net[n]/100,paid_amount:payments[n]/100}))};
  }
  function resolveIds(value,ids){if(Array.isArray(value))return value.map(v=>resolveIds(v,ids));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,['product_id','customer_id'].includes(k)&&ids[String(v)]?Number(ids[String(v)]):resolveIds(v,ids)]));return value;}
  function wholeBags(value,label='Quantity',minimum=-1e12){const n=Number(value);if(value===null||value===undefined||String(value).trim()===''||!Number.isSafeInteger(n)||Math.abs(n)>1e12||n<minimum)throw Error(label+' must be a whole number'+(minimum===1?' greater than zero':minimum===0?' of zero or more':'')+'.');return n;}
  const allProducts=s=>[...(s.products||[]),...(s.archived_products||[])];
  function productStock(s,p){return round(Number(p.opening_stock||0)+s.orders.filter(o=>o.product_id==p.id&&o.status==='Delivered').reduce((n,o)=>n+Number(o.quantity),0)-s.sales.filter(o=>o.product_id==p.id).reduce((n,o)=>n+Number(o.quantity),0)+s.adjustments.filter(a=>a.product_id==p.id).reduce((n,a)=>n+(['Return','Manual Add'].includes(a.type)?1:-1)*Number(a.quantity),0));}
  function validDate(value){const s=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw Error('Enter a valid date.');}
  function validAmount(value,positive=false){if((typeof value!=='number'&&typeof value!=='string'&&value!=null)||!Number.isFinite(Number(value??0))||Math.abs(Number(value))>1e12||Number(value)<0||(positive&&round(value)<=0))throw Error('Enter a positive quantity or amount.');}
  function protectHistoryAndStock(snapshot,command){
    const [, ,entity,id]=command.path.split('/'),p=command.payload,method=command.method;
    const same=(a,b)=>String(a)===String(b),product=id=>allProducts(snapshot).find(row=>same(row.id,id));
    const stockError=()=>{throw Error('Insufficient stock. Refresh stock and reduce the quantity before saving.');};
    if(method==='DELETE'&&['products','customers'].includes(entity)){
      const used=entity==='customers'?snapshot.payments.some(row=>same(row.customer_id,id))||snapshot.sales.some(row=>same(row.customer_id,id))||snapshot.invoices.some(row=>same(row.customer_id,id)):snapshot.orders.some(row=>same(row.product_id,id))||snapshot.adjustments.some(row=>same(row.product_id,id))||snapshot.sales.some(row=>same(row.product_id,id))||snapshot.invoices.some(row=>row.items.some(item=>same(item.product_id,id)));
      if(used)throw Error('This record has transactions and cannot be deleted. Keep it for the account history.');
    }
    if(entity==='invoices'&&!command.path.endsWith('/return')&&['POST','PATCH'].includes(method)){
      const old=method==='PATCH'?snapshot.invoices.find(row=>same(row.id,id)):null,demand=new Map();
      for(const item of p.items||[])demand.set(String(item.product_id),(demand.get(String(item.product_id))||0)+Number(item.quantity));
      for(const [productId,quantity] of demand){const row=product(productId);if(!row)throw Error('Product not found');const released=old?snapshot.sales.filter(sale=>old.items.some(i=>same(i.sale_id,sale.id))&&same(sale.product_id,productId)).reduce((n,sale)=>n+Number(sale.quantity),0):0;if(row.archived&&(!old||quantity>released))throw Error('This product is archived. Choose a current product.');if(quantity>round(productStock(snapshot,row)+released))stockError();}
    }
    if(['orders','sales','adjustments'].includes(entity)&&method==='POST'&&product(p.product_id)?.archived)throw Error('This product is archived. Choose a current product.');
    if(entity==='adjustments'&&method==='POST'&&!['Return','Manual Add'].includes(p.type)){const row=product(p.product_id);if(row&&p.quantity>productStock(snapshot,row))stockError();}
    if(method==='DELETE'&&['orders','adjustments'].includes(entity)){const row=snapshot[entity].find(r=>same(r.id,id));if(row&&(entity==='orders'?row.status==='Delivered':['Return','Manual Add'].includes(row.type))){const feed=product(row.product_id);if(feed&&row.quantity>productStock(snapshot,feed))stockError();}}
    if(method==='PATCH'&&['orders','adjustments'].includes(entity)){
      const old=snapshot[entity].find(r=>same(r.id,id));if(!old)throw Error('Record not found. Refresh and try again.');
      if(p.confirmed!==true)throw Error('Confirm the stock change first.');
      const next={...old,...p},feed=product(next.product_id);
      if(!feed||feed.archived&&!same(old.product_id,next.product_id))throw Error('Choose a current product.');
      const effect=r=>entity==='orders'?(r.status==='Delivered'?Number(r.quantity):0):(['Return','Manual Add'].includes(r.type)?1:-1)*Number(r.quantity);
      for(const row of allProducts(snapshot).filter(r=>same(r.id,old.product_id)||same(r.id,next.product_id))){const delta=(same(row.id,next.product_id)?effect(next):0)-(same(row.id,old.product_id)?effect(old):0);if(delta<0&&productStock(snapshot,row)+delta<0)stockError();}
      if(entity==='adjustments'&&!String(p.notes||'').trim())throw Error('Enter a stock adjustment reason.');
    }
    if(method==='PATCH'&&entity==='transactions'){
      const old=snapshot.transactions.find(r=>same(r.id,id));if(!old)throw Error('Record not found. Refresh and try again.');
      const transfer=['Bank Deposit','Bank Withdraw'].includes(p.type);
      if(old.transfer_id){
        const pair=snapshot.transactions.filter(r=>r.transfer_id===old.transfer_id&&!same(r.id,id));
        if(!transfer||p.confirmed!==true)throw Error('Confirm the transfer edit. Keep it as Cash to Bank or Bank to Cash.');
        if(pair.length!==1||!p.original_transfer||pair[0].account===old.account)throw Error('Reload the complete transfer before editing.');
        if(Object.entries(pair[0]).some(([k,v])=>!['pending','original','original_transfer','confirmed'].includes(k)&&p.original_transfer[k]!==v))throw Error('Transfer changed on another device. Refresh first.');
      }else if(transfer)throw Error('Create a new transfer instead of changing a single transaction into a transfer.');
    }
  }
  function validateMutation(path,method,p){
    const entity=path.split('/')[2];if(method==='DELETE')return;
    if(entity==='invoices'&&!path.endsWith('/return')&&'invoice_no' in p){
      p.invoice_no=String(p.invoice_no??'').trim();
      if(p.invoice_no.length>100||/[\u0000-\u001f\u007f]/.test(p.invoice_no))throw Error('Keep the invoice number within 100 characters on one line.');
      if(p.invoice_no&&project().invoices.some(row=>row.invoice_no===p.invoice_no&&row.id!==p.id&&row.id!==path.split('/')[3]))throw Error('This invoice number is already in use. Choose another number.');
    }
    const field={orders:'order_date',sales:'sale_date',payments:'payment_date',adjustments:'adjust_date',transactions:'txn_date',invoices:path.endsWith('/return')?'return_date':'sale_date'}[entity];if(field&&p[field]!==undefined)validDate(p[field]);
    if(['orders','sales','products'].includes(entity)){for(const key of ['rate','default_rate','bag_weight'])if(key in p)validAmount(p[key],key==='bag_weight');}
    if(['payments','transactions'].includes(entity))validAmount(p.amount,true);
    if(['sales','invoices'].includes(entity)&&'paid_amount' in p)validAmount(p.paid_amount);
    if('account' in p&&!['Cash','Bank'].includes(p.account))throw Error('Choose Cash or Bank.');
    if(entity==='orders'&&p.status&&!['Pending','Confirmed','Delivered'].includes(p.status))throw Error('Choose a valid order status.');
    if(entity==='orders'&&p.delivery_date)validDate(p.delivery_date);
    if(entity==='orders'&&'total_amount' in p&&round(p.total_amount)!==round(Number(p.quantity)*Number(p.rate)))throw Error('Total must match the calculated quantity and rate.');
    if(entity==='transactions'&&!['Company Payment','Expense','Transport Cost','Other Income','Other Expense','Bank Deposit','Bank Withdraw'].includes(p.type))throw Error('Choose a valid transaction type.');
    for(const field of ['notes','reference','invoice_no','category'])if(['orders','adjustments','transactions'].includes(entity)&&String(p[field]||'').length>(field==='notes'?1000:200))throw Error('Keep notes within 1000 characters and references within 200 characters.');
    if(entity==='adjustments'&&!['Return','Damage','Loss','Manual Add','Manual Minus'].includes(p.type))throw Error('Choose a valid adjustment type.');

    if(entity==='payments'&&method==='PATCH'&&(!Number.isFinite(Number(p.amount))||Number(p.amount)<=0||!['Cash','Bank'].includes(p.account)))throw Error('Enter a positive collection amount and choose Cash or Bank.');
    if(['orders','sales','adjustments'].includes(entity)&&'quantity' in p)p.quantity=wholeBags(p.quantity,'Quantity',1);
    if(entity==='products'){
      if('feed_size' in p){p.feed_size=String(p.feed_size??'').trim();if(p.feed_size.length>100)throw Error('Enter a size up to 100 characters and protein between 0 and 100 percent.');}
      if('protein_percent' in p){if(p.protein_percent!==null&&!['number','string'].includes(typeof p.protein_percent))throw Error('Enter a size up to 100 characters and protein between 0 and 100 percent.');p.protein_percent=p.protein_percent===''||p.protein_percent===null?null:Number(p.protein_percent);if(p.protein_percent!==null&&(!Number.isFinite(p.protein_percent)||p.protein_percent<0||p.protein_percent>100))throw Error('Enter a size up to 100 characters and protein between 0 and 100 percent.');}
      if('category' in p&&!['Fish feed','Cattle feed','Poultry feed'].includes(p.category))throw Error('Choose Fish feed or Cattle feed or Poultry feed.');
      if(method==='POST')p.opening_stock=wholeBags(p.opening_stock??0,'Opening Stock',0);
      if('low_stock_level' in p)p.low_stock_level=wholeBags(p.low_stock_level,'Low Stock Alert',0);
      if('current_stock' in p){p.current_stock=wholeBags(p.current_stock,'Current Bag',0);const old=Number(p.original?.current_stock);if(!Number.isFinite(old))throw Error('Refresh the stock before setting Current Bag.');if(p.current_stock!==old&&p.confirmed_stock!==true)throw Error('Confirm the Current Bag adjustment first.');if(key){const current=project().products.find(row=>String(row.id)===path.split('/')[3]);if(current&&Number(current.current_stock)!==old)throw Error('Stock changed. Reopen the product and review Current Bag before saving.');}}
    }
    if(['products','customers'].includes(entity))for(const field of ['name','product_code','mobile','address'])if(field in p)p[field]=String(p[field]??'').trim();
    if(entity==='invoices')for(const field of ['customer_name','customer_mobile','customer_address'])if(field in p)p[field]=String(p[field]??'').trim();
    if(entity==='invoices'&&Array.isArray(p.items)){const returning=path.endsWith('/return');for(const item of p.items)item.quantity=wholeBags(item.quantity,returning?'Return Quantity':'Quantity',returning?0:1);}
  }
  function apply(snapshot,command){const parts=command.path.split('/').filter(Boolean).slice(1),entity=parts[0],id=parts[1];const p=command.payload,method=command.method;
    if(entity==='invoices'){
      const old=snapshot.invoices.find(i=>i.id===id);
      if(method==='POST'&&parts.length===1||method==='PATCH'&&parts.length===2){const a=amounts(p);if(p.customer_id==='new'){p.customer_id=command.temp_id;snapshot.customers.unshift({id:command.temp_id,name:p.customer_name,mobile:p.customer_mobile||'',address:p.customer_address||'',opening_due:0,pending:true,created_at:new Date(command.created_at).toISOString()});}const invoiceId=p.id||id;const invoice={...p,...a,id:invoiceId,invoice_no:p.invoice_no||old?.invoice_no||`AT-${p.sale_date.replaceAll('-','')}-${invoiceId.replaceAll('-','').slice(-12).toUpperCase()}`,status:'active',version:(old?.version||0)+1,returned_total:0,refunded:0,pending:true};invoice.items=a.items.map((i,n)=>({...i,id:`${invoiceId}-line-${n}`,invoice_id:invoiceId,sale_id:`local-${invoiceId}-${n}`,product_name:allProducts(snapshot).find(x=>x.id==i.product_id)?.name||'',product_code:allProducts(snapshot).find(x=>x.id==i.product_id)?.product_code||'',returned_quantity:0}));if(old)snapshot.sales=snapshot.sales.filter(s=>!old.items.some(i=>i.sale_id==s.id));snapshot.sales.push(...invoice.items.map(i=>({...i,id:i.sale_id,sale_date:p.sale_date,customer_id:p.customer_id,total_amount:i.line_total,paid_amount:i.paid_amount,account:p.account})));snapshot.invoices=snapshot.invoices.filter(i=>i.id!==invoiceId);snapshot.invoices.unshift(invoice);
      }else if(old&&method==='DELETE'){old.status='void';old.pending=true;old.version++;for(const s of snapshot.sales.filter(s=>old.items.some(i=>i.sale_id==s.id))){s.quantity=0;s.total_amount=0;s.paid_amount=0;}}
      else if(old&&parts[2]==='return'){
        const requested=new Map(p.items.map(i=>[i.id,Number(i.quantity)]));for(const item of old.items){const q=requested.get(item.id)||0;if(q<0||q>round(item.quantity-item.returned_quantity))throw Error('Return quantity exceeds remaining quantity.');item.returned_quantity=round(item.returned_quantity+q);if(q&&p.restock===false)snapshot.adjustments.push({id:command.id+'-'+item.id,product_id:item.product_id,type:'Damage',quantity:q,adjust_date:p.return_date});}
        const net=old.items.map(i=>Math.round(i.line_total*100*(i.quantity-i.returned_quantity)/i.quantity));const total=net.reduce((a,b)=>a+b,0)/100;const refunded=round(Math.max(0,old.paid_amount-total));snapshot.returns.push({id:command.id,invoice_id:old.id,return_date:p.return_date,credit:round(old.total_amount-old.returned_total-total),refund:round(refunded-old.refunded),reason:p.reason,items_json:JSON.stringify(p.items)});old.returned_total=round(old.total_amount-total);old.refunded=refunded;old.version++;old.pending=true;const paid=shares(Math.round((old.paid_amount-refunded)*100),net);old.items.forEach((i,n)=>{const sale=snapshot.sales.find(s=>s.id==i.sale_id);if(sale){sale.quantity=round(i.quantity-i.returned_quantity);sale.total_amount=net[n]/100;sale.paid_amount=paid[n]/100;}});
      }
    }else if(entity==='settings'){snapshot.settings={...p,version:Number(snapshot.settings.version)+1};}
    else if(snapshot[entity]){
      if(method==='POST'){const row={...p,id:command.temp_id,created_at:new Date(command.created_at).toISOString(),pending:true};for(const field of ['product_id','customer_id','quantity','rate','paid_amount','amount','opening_stock','opening_due','default_rate','bag_weight','low_stock_level'])if(row[field]!==undefined)row[field]=Number(row[field]);if(entity==='orders')row.total_amount=round(row.quantity*row.rate);if(entity==='products')Object.assign(row,{opening_stock:Number(row.opening_stock||0),default_rate:Number(row.default_rate||0),low_stock_level:Number(row.low_stock_level??5),bag_weight:Number(row.bag_weight||50)});if(entity==='transactions'&&['Bank Deposit','Bank Withdraw'].includes(p.type)){row.transfer_id=command.id;row.account=p.type==='Bank Deposit'?'Cash':'Bank';snapshot.transactions.unshift({...row,id:String(command.temp_id)+'-counter',account:row.account==='Cash'?'Bank':'Cash'});}snapshot[entity].unshift(row);}else if(method==='DELETE'){if(['products','customers'].includes(entity)&&snapshot.invoices.some(inv=>entity==='customers'?String(inv.customer_id)===id:inv.items.some(item=>String(item.product_id)===id)))throw Error('This record is used by an invoice and cannot be deleted.');const deleted=snapshot[entity].find(r=>String(r.id)===id);snapshot[entity]=snapshot[entity].filter(r=>String(r.id)!==id&&!(entity==='transactions'&&deleted?.transfer_id&&r.transfer_id===deleted.transfer_id));}else if(method==='PATCH'){const row=snapshot[entity].find(r=>String(r.id)===id);if(row){
        if(entity==='products'&&'current_stock' in p){const actual=productStock(snapshot,row),expected=Number(p.original?.current_stock);if(actual!==expected){row.pending=true;row.stock_conflict=true;return;}const delta=round(Number(p.current_stock)-actual);if(delta)snapshot.adjustments.unshift({id:command.id+'-stock',product_id:row.id,adjust_date:p.adjust_date||new Date(command.created_at).toISOString().slice(0,10),type:delta>0?'Manual Add':'Manual Minus',quantity:Math.abs(delta),notes:`Current Bag ${expected} -> ${p.current_stock}${p.stock_reason?': '+p.stock_reason:''}`,pending:true});}
        if(entity==='customers')for(const invoice of snapshot.invoices.filter(i=>String(i.customer_id)===id&&!i.customer_name)){invoice.customer_name=row.name;invoice.customer_mobile=row.mobile||'';invoice.customer_address=row.address||'';}
        if(entity==='orders')p.total_amount=round(Number(p.quantity)*Number(p.rate));
        if(entity==='transactions'&&row.transfer_id){for(const side of snapshot.transactions.filter(t=>t.transfer_id===row.transfer_id)){const account=side.account,sideId=side.id;Object.assign(side,p,{id:sideId,account,pending:true});}}
        else Object.assign(row,p,{pending:true});
      }}
    }
  }
  const sum=(rows,fn)=>round(rows.reduce((s,r)=>s+Number(fn(r)||0),0));
  function recalculate(s){
    const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
    for(const p of allProducts(s)){p.received_stock=sum(s.orders.filter(o=>o.product_id==p.id&&o.status==='Delivered'),o=>o.quantity);p.sold_stock=sum(s.sales.filter(o=>o.product_id==p.id),o=>o.quantity);p.current_stock=round(Number(p.opening_stock||0)+p.received_stock-p.sold_stock+sum(s.adjustments.filter(a=>a.product_id==p.id),a=>['Return','Manual Add'].includes(a.type)?a.quantity:-a.quantity));}
    for(const c of s.customers){c.total_purchase=round(Number(c.opening_due||0)+sum(s.sales.filter(i=>i.customer_id==c.id),i=>i.total_amount));c.total_paid=round(sum(s.sales.filter(i=>i.customer_id==c.id),i=>i.paid_amount)+sum(s.payments.filter(i=>i.customer_id==c.id),i=>i.amount));c.current_due=round(c.total_purchase-c.total_paid);}
    for(const sale of s.sales){sale.customer_name=s.customers.find(c=>c.id==sale.customer_id)?.name||sale.customer_name;sale.product_name=allProducts(s).find(p=>p.id==sale.product_id)?.name||sale.product_name;sale.due_amount=round(sale.total_amount-sale.paid_amount);}
    for(const inv of s.invoices){const c=s.customers.find(c=>c.id==inv.customer_id);if(!inv.customer_name)Object.assign(inv,{customer_name:c?.name||'',customer_mobile:c?.mobile||'',customer_address:c?.address||''});inv.net_total=inv.status==='void'?0:round(inv.total_amount-inv.returned_total);inv.net_paid=inv.status==='void'?0:round(inv.paid_amount-inv.refunded);inv.due_amount=round(inv.net_total-inv.net_paid);}
    for(const order of s.orders)order.product_name=allProducts(s).find(p=>p.id==order.product_id)?.name||order.product_name;for(const payment of s.payments)payment.customer_name=s.customers.find(c=>c.id==payment.customer_id)?.name||payment.customer_name;
    const balance=account=>round(sum(s.sales.filter(i=>i.account===account),i=>i.paid_amount)+sum(s.payments.filter(i=>i.account===account),i=>i.amount)+sum(s.transactions.filter(i=>i.account===account),i=>(account==='Cash'?['Other Income','Bank Withdraw']:['Other Income','Bank Deposit']).includes(i.type)?i.amount:-i.amount));
    s.dashboard={today:now,total_sales_today:sum(s.sales.filter(i=>i.sale_date===now),i=>i.total_amount),received_today:round(sum(s.sales.filter(i=>i.sale_date===now),i=>i.paid_amount)+sum(s.payments.filter(i=>i.payment_date===now),i=>i.amount)),today_orders:s.orders.filter(o=>o.order_date===now).length,current_stock:sum(s.products,p=>p.current_stock),archived_stock:sum(s.archived_products||[],p=>p.current_stock),low_stock:s.products.filter(p=>p.current_stock<=p.low_stock_level),customer_due:sum(s.customers,c=>c.current_due),company_payable:round(sum(s.orders.filter(o=>o.status==='Delivered'),o=>o.total_amount)-sum(s.transactions.filter(t=>t.type==='Company Payment'),t=>t.amount)),cash_balance:balance('Cash'),bank_balance:balance('Bank')};
    function group(rows,key,fields){const map=new Map();for(const row of rows){const value=key(row);if(!map.has(value))map.set(value,{key:value});const target=map.get(value);for(const [name,fn] of Object.entries(fields))target[name]=round((target[name]||0)+Number(fn(row)||0));}return [...map.values()];}
    s.reports={...s.reports,daily_sales:group(s.sales,r=>r.sale_date,{bags:r=>r.quantity,sales:r=>r.total_amount,received:r=>r.paid_amount,due:r=>r.total_amount-r.paid_amount}).map(r=>({...r,date:r.key,invoice_count:s.invoices.filter(i=>i.sale_date===r.key&&i.status==='active').length})).sort((a,b)=>b.date.localeCompare(a.date)),monthly_sales:group(s.sales,r=>r.sale_date.slice(0,7),{bags:r=>r.quantity,sales:r=>r.total_amount,received:r=>r.paid_amount}).map(r=>({...r,month:r.key})),product_sales:group(s.sales,r=>r.product_name,{bags:r=>r.quantity,amount:r=>r.total_amount}).map(r=>({...r,name:r.key})),customer_sales:group(s.sales,r=>String(r.customer_id),{purchase:r=>r.total_amount,paid:r=>r.paid_amount,sale_due:r=>r.total_amount-r.paid_amount}).map(r=>({...r,customer_id:r.key,name:s.customers.find(c=>String(c.id)===r.key)?.name||''})),stock_report:s.products,due_report:s.customers,order_report:group(s.orders,r=>r.status,{order_count:()=>1,bags:r=>r.quantity,amount:r=>r.total_amount}).map(r=>({...r,status:r.key})),cash_bank:[{account:'Cash',balance:balance('Cash')},{account:'Bank',balance:balance('Bank')}]};if(journalReports){const journal=journalReports(s,now);Object.assign(s.reports,journal.reports);Object.assign(s.dashboard,journal.today);}return s;
  }
  function project(strict=false){if(!data?.base)throw Error('No Offline snapshot is available. Connect once to load your records.');const s=clone(data.base);s.invoices||=[];s.returns||=[];for(const operation of data.queue){if(operation.rejected)continue;if((operation.workspace_epoch??0)!==(data.base.workspace_epoch??0))continue;const c=clone(operation);c.payload=resolveIds(c.payload,data.ids);c.path=c.path.replace(/\/(-\d+)(?=\/|$)/g,(_,id)=>'/'+(data.ids[id]||id));try{protectHistoryAndStock(s,c);apply(s,c);}catch(error){if(strict)throw error;operation.error=error.message;operation.conflict=true;}}recalculate(s);s.offline_state={pending:data.queue.length,online,error:lastError};return s;}
  function decorate(path,method,p){const entity=path.split('/')[2],id=path.split('/')[3];if(['PATCH','DELETE'].includes(method)&&entity!=='invoices'&&entity!=='settings'&&!p.original)p.original=clone((data?.base?project()[entity]:[])?.find(r=>String(r.id)===id)||{});if(method==='DELETE')p.confirmed=true;return p;}
  async function request(path,options={}){
    if(resetting)throw Error('Reset is in progress. Wait for it to finish before saving.');
    // Reserve ordering before the first await, including start/unlock and
    // durable storage. An earlier Save must finish before Reset checks it.
    const run=()=>requestInside(path,options);
    return (options.method||'GET').toUpperCase()!=='GET'||path==='/api/bootstrap'
      ?exclusive('arafat-reset-save',run):run();
  }
  async function requestInside(path,options={}){
    if(switching)throw Error('Please wait for the account change to finish.');await start();const method=(options.method||'GET').toUpperCase();
    if(path.startsWith('/api/admin/'))return network(path,options);
    if(path==='/api/sync-akij'&&method==='POST'){
      if(!navigator.onLine)throw Error('Sync Codes requires an internet connection.');
      await flush();if(flushing||data?.queue.length)throw Error('Sync pending saves before updating product codes.');
      const result=await network(path,{...options,headers:{...options.headers,'X-Workspace-Epoch':String(data?.base?.workspace_epoch??0)}});
      // Legacy maintenance responses have no replication cursor. Reconcile
      // from our existing cursor before adopting them, so the next Save can
      // still pull deltas instead of requesting after=undefined.
      const snapshot={...await replicatedBootstrap({},result.user),sync:result.sync};
      if(key)await mutate(d=>{d.base=snapshot;d.saved_at=new Date().toISOString();});
      else data={base:snapshot,queue:[],ids:data?.ids||{}};
      lastError='';emit();return snapshot;
    }

    if(method==='GET'){
      if(path==='/api/bootstrap'){
        const version=sessionVersion;
        if(data?.queue.length){flush().catch(()=>{});return project();}
        try{const snapshot=await network(path,options);if(version!==sessionVersion||signedOut)throw Error('Account changed. Please retry.');if(key)await mutate(d=>{if((d.base.workspace_epoch??0)!==(snapshot.workspace_epoch??0))d.ids={};d.base=snapshot;d.saved_at=new Date().toISOString();});else if(await readOnline(snapshot,version)){await flushOnline();return project();}else data={base:snapshot,queue:[],ids:{}};lastError='';emit();if(snapshot.needs_refresh)refreshSoon();else scheduleServiceWorker();return snapshot;}
        catch(e){if((e.network||e.status>=500)&&key&&data?.base){lastError='Offline — changes stay on this device until Sync.';emit();return project();}throw e;}
      }
      if(path.startsWith('/api/invoices/')&&key){const inv=project().invoices.find(i=>i.id===path.split('/')[3]);if(inv)return {...inv,settings:project().settings};}
      return network(path,options);
    }
    const payload=decorate(path,method,JSON.parse(options.body||'{}'));validateMutation(path,method,payload);const command={id:options.commandId||uuid(),method,path,payload,workspace_epoch:data?.base?.workspace_epoch??0,created_at:Date.now(),temp_id:-Date.now()*1000-Math.floor(Math.random()*999)};
    if(new TextEncoder().encode(JSON.stringify(command)).byteLength>1024*1024)throw Error('This save is too large. Shorten the note and try again.');
    if(key){await mutate(d=>{if(command.workspace_epoch!==(d.base.workspace_epoch??0))throw Error('The Admin reset this workspace. Export or remove old pending work, then refresh before saving.');const candidate=clone(d);candidate.queue.push(command);const saved=data;try{data=candidate;project(true);}finally{data=saved;}d.queue.push(command);});setTimeout(()=>flush().catch(()=>{}),0);return project();}
    await mutateOnline(d=>{
      if((d.base.workspace_epoch??0)!==command.workspace_epoch)throw Error('The Admin reset this workspace. Export or remove old pending work, then refresh before saving.');
      const reserved=d.queue.find(q=>q.id===command.id);if(reserved&&(reserved.path!==path||reserved.method!==method||canonical(reserved.payload)!==canonical(payload)))throw Error('Operation ID was reused with different data.');
      const identical=d.queue.find(q=>q.method===method&&q.path===path&&canonical(q.payload)===canonical(payload));
      if(identical){command.id=identical.id;return;}
      const candidate=clone(d);candidate.queue.push(command);const saved=data;
      try{data=candidate;project(true);}finally{data=saved;}
      d.queue.push(command);
    });
    await flushOnline();return project();
  }
  async function flushVault(){if(signedOut||switching||resetting||flushing||!key||!data?.queue.length||!navigator.onLine)return;const version=sessionVersion;return exclusive('arafat-vault-sync',async()=>{if(version!==sessionVersion||signedOut||switching||resetting||!key)return;flushing=true;lastError='';emit();try{
    const latest=await read();if(latest){record=latest;data=await decrypt(latest,key);}
    await mutate(repairLegacyQueue);
    while(data.queue.length){let op=clone(data.queue[0]);if(op.wire)op=op.wire;else{op.payload=resolveIds(op.payload,data.ids);op.path=op.path.replace(/\/(-\d+)(?=\/|$)/g,(_,id)=>'/'+(data.ids[id]||id));if(Number(op.payload.original?.id)<0){const entity=op.path.split('/')[2],id=op.path.split('/')[3];const serverRow=data.base[entity]?.find(row=>String(row.id)===id);if(!serverRow)throw Error('A pending dependency has not synced yet.');const previousOriginal=op.payload.original;op.payload.original=clone(serverRow);const preserve=entity==='products'?['name','product_code','category','feed_size','protein_percent','bag_weight','opening_stock','default_rate','low_stock_level','current_stock']:entity==='customers'?['name','mobile','address','opening_due']:entity==='payments'?['payment_date','customer_id','amount','account','notes']:[];for(const field of preserve)if(field in previousOriginal)op.payload.original[field]=previousOriginal[field];}delete op.error;delete op.conflict;await mutate(d=>{const queued=d.queue.find(q=>q.id===op.id);if(queued)queued.wire=clone(op);});}let result;try{result=await network('/api/commands',{method:'POST',body:JSON.stringify(op)});}catch(e){lastError=e.pendingSync?'Save status is pending. Use Sync Now to safely check and retry.':e.status===409?'Conflict: '+e.message:e.message;await mutate(d=>{if(d.queue[0]?.id===op.id){d.queue[0].error=lastError;d.queue[0].conflict=e.status===409;d.queue[0].rejected=!e.pendingSync&&!!e.status&&e.status<500&&e.status!==401;}});throw e;}
      await mutate(d=>{if(Number(op.temp_id)<0){if(op.payload.customer_id==='new'&&result.command_result?.customer_id)d.ids[String(op.temp_id)]=result.command_result.customer_id;else if(result.command_result?.entity!=='invoices'&&result.command_result?.id)d.ids[String(op.temp_id)]=result.command_result.id;}d.queue=d.queue.filter(q=>q.id!==op.id);d.base=result;d.saved_at=new Date().toISOString();});
      window.dispatchEvent(new CustomEvent('workspace:data',{detail:project()}));
    }
  }finally{flushing=false;emit();}});}
  async function discard(id){const update=key?mutate:mutateOnline;await update(d=>{const item=d.queue.find(q=>q.id===id);if(!item)return;if((item.sent||item.wire)&&!item.rejected)throw Error('Save status is pending. Use Sync Now to safely check and retry.');const temp=String(item.temp_id);if(d.queue.some(q=>q.id!==id&&JSON.stringify(q.payload).includes(temp)))throw Error('Another pending action uses this record. Remove the dependent action first.');d.queue=d.queue.filter(q=>q.id!==id);});window.dispatchEvent(new CustomEvent('workspace:data',{detail:project()}));}
  async function exportDevice(){await start();if(!key)throw Error('Enable and unlock Offline mode first.');return JSON.stringify(await read());}
  async function restoreDevice(text,username,password){if(signedOut)throw loginRequired();if(data?.base?.user&&data.base.user.username!==username)throw Error('Use the header account button to change users.');const r=JSON.parse(text);if(r.format!=='arafat-encrypted-v2'||!r.salt||!r.iv||!r.cipher||r.username!==username)throw Error('Invalid device backup or User ID.');let k,imported;try{k=await derive(password,r.salt);imported=await decrypt(r,k);}catch{throw Error('Incorrect password or damaged device backup.');}if(!imported.base||!Array.isArray(imported.queue))throw Error('Invalid device backup.');if(data?.base?.user)imported.base.user=clone(data.base.user);if(data?.queue.length)throw Error('Sync or export pending work before restoring a device backup.');const current=await read();r.revision=(current?.revision||0)+1;await write(r,current?.revision||0);record=r;key=k;data=imported;started=true;authorization='Basic '+btoa(unescape(encodeURIComponent(username+':'+password)));unlockResolve?.();unlockWait=null;unlockResolve=null;emit();return project();}
  function lock(){key=null;authorization=null;data=null;lastError='';unlockWait=null;unlockResolve=null;emit();window.dispatchEvent(new Event('workspace:unlock-required'));}
  if(channel)channel.onmessage=async event=>{if(event.data==='account-changed'){sessionVersion++;key=null;authorization=null;data=null;record=await read();signedOut=true;emit();window.dispatchEvent(new Event('workspace:signed-out'));return;}if(!key||signedOut)return;try{const latest=await read();if(latest&&latest.username===record?.username&&latest.revision!==record?.revision){record=latest;data=await decrypt(latest,key);window.dispatchEvent(new CustomEvent('workspace:data',{detail:project()}));emit();}}catch{lock();}};
  window.addEventListener('online',()=>{online=true;flush().catch(()=>{});emit();});window.addEventListener('offline',()=>{online=false;emit();});
  async function download(path){if(!/^\/api\/(admin\/backups\/[A-Za-z0-9_-]+|export|invoices\/[A-Za-z0-9_-]+\/receipt|sales\/[0-9]+\/receipt|customers\/[0-9]+\/due\/receipt)(?:\?lang=(?:bn|en))?$/.test(path))throw Error('Untrusted download.');await start();const headers={};if(authorization)headers.Authorization=authorization;const response=await fetch(path,{headers,credentials:'same-origin',redirect:'error'});if(!response.ok)throw Error('Download unavailable. Check your connection and login.');return response.blob();}
  async function tryAutoUnlock(username,password){if(signedOut||switching||data?.base?.user)return;const saved=await read();if(saved&&!key){const snapshot=await unlock(username,password);window.dispatchEvent(new CustomEvent('workspace:data',{detail:snapshot}));return snapshot;}}
  async function resetWorkspace(payload){
    if(resetting)throw Error('Reset is already in progress.');
    if(switching)throw Error('Please wait for the account change to finish.');
    const version=sessionVersion,owner=data?.base?.user?.username;
    const checkAccess=()=>{if(version!==sessionVersion||signedOut||!owner||data?.base?.user?.username!==owner)throw Error('Account changed. Please retry.');};
    resetting=true;emit();
    try{return await exclusive('arafat-reset-save',async()=>{
      await start();checkAccess();
      if(!navigator.onLine)throw Error('Connect to the internet to reset app data.');
      if(data.base.user.role!=='admin')throw Error('Only the Admin can reset all app data.');
      // Acquire both sync locks before either write lock: each flusher takes
      // its own sync lock and then its own write lock in that same order.
      return exclusive('arafat-vault-sync',()=>exclusive('arafat-online-outbox-sync',()=>exclusive('arafat-vault-write',()=>exclusive('arafat-online-outbox-write',async()=>{
        checkAccess();
        const latest=key?await read():null;
        if(latest&&latest.username!==owner)throw Error('Account changed. Please retry.');
        const current=latest?await decrypt(latest,key):data;
        const savedOnline=await read(onlineName(owner));
        const onlineJournal=savedOnline?await decrypt(savedOnline,savedOnline.deviceKey):null;
        checkAccess();
        if(current?.queue?.length||data?.queue?.length||onlineJournal?.queue?.length)throw Error('Sync or remove pending work before resetting app data.');
        const result=await network('/api/reset-workspace',{method:'POST',body:JSON.stringify(payload)});
        checkAccess();
        const next={base:result,queue:[],ids:{},saved_at:new Date().toISOString()};
        if(key&&latest){const encrypted=await encrypt(next,latest);checkAccess();await write(encrypted,latest.revision||0);record=encrypted;}
        else await saveReplica(result);
        checkAccess();
        data=next;lastError='';channel?.postMessage('changed');emit();return result;
      }))));
    });}finally{resetting=false;emit();}
  }
  function rememberSignOut(value){try{localStorage.setItem('arafat-signed-out',String(value));}catch{}}
  function loginRequired(){const error=Error('Please log in to continue.');error.status=401;window.dispatchEvent(new Event('workspace:sign-in-required'));return error;}
  async function selectAccountVault(username){const d=await db();return new Promise((resolve,reject)=>{const tx=d.transaction(STORE,'readwrite'),store=tx.objectStore(STORE),current=store.get(VAULT);let selected=null;current.onsuccess=()=>{const previous=current.result;if(previous?.username===username){selected=previous;return;}if(previous)store.put(previous,'account:'+previous.username);const next=store.get('account:'+username);next.onsuccess=()=>{selected=next.result||null;if(selected)store.put(selected,VAULT);else store.delete(VAULT);};};tx.oncomplete=()=>resolve(selected);tx.onabort=()=>reject(tx.error||Error('Could not change account.'));tx.onerror=()=>reject(tx.error);});}
  async function signIn(username,password){
    if(resetting)throw Error('Reset is in progress. Wait for it to finish before saving.');
    if(switching)throw Error('Please wait for the account change to finish.');
    if(data?.queue?.length)throw Error('Sync pending work before logging out.');
    if(!navigator.onLine)throw Error('Connect to the internet to log in or change accounts.');
    let changed=false;switching=true;emit();
    try{return await exclusive('arafat-vault-sync',()=>exclusive('arafat-vault-write',async()=>{
      await loadJournal();
      const login=await network('/api/login',{method:'POST',body:JSON.stringify({username,password})});
      changed=true;sessionVersion++;refreshing=false;key=null;authorization=null;data=null;signedOut=false;rememberSignOut(false);
      record=await selectAccountVault(login.user.username);
      if(record){try{key=await derive(password,record.salt);data=await decrypt(record,key);}catch{key=null;throw Error('The saved Offline data needs its original password.');}data.base.user=login.user;if(!data.queue.length)data.base=await replicatedBootstrap({},login.user,true);const encrypted=await encrypt(data,record);await write(encrypted,record.revision||0);record=encrypted;}
      else {const snapshot=await replicatedBootstrap({},login.user,true);if(!await readOnline(snapshot))data={base:snapshot,queue:[],ids:{}};}
      started=true;lastError='';unlockResolve?.();unlockResolve=null;unlockWait=null;channel?.postMessage('account-changed');emit();return record?project():clone(data.base);
    }));}catch(error){if(changed){key=null;authorization=null;data=null;signedOut=true;rememberSignOut(true);window.dispatchEvent(new Event('workspace:signed-out'));}throw error;}finally{switching=false;emit();if(data?.base?.needs_refresh&&!signedOut)refreshSoon();else if(data?.base&&!signedOut)scheduleServiceWorker();}
  }
  async function signOut(){
    if(resetting)throw Error('Reset is in progress. Wait for it to finish before saving.');
    if(switching)throw Error('Please wait for the account change to finish.');
    if(!navigator.onLine)throw Error('Connect to the internet to log out. Use Lock Device while Offline.');
    if(data?.queue?.length)throw Error('Sync pending work before logging out.');
    switching=true;emit();
    try{await exclusive('arafat-vault-sync',()=>exclusive('arafat-vault-write',async()=>{
      if(data?.queue?.length)throw Error('Sync pending work before logging out.');
      sessionVersion++;refreshing=false;await network('/api/logout',{method:'POST',body:'{}'});key=null;authorization=null;data=null;signedOut=true;rememberSignOut(true);lastError='';channel?.postMessage('account-changed');emit();window.dispatchEvent(new Event('workspace:signed-out'));
    }));}finally{switching=false;emit();}
  }

  const serializedMaintenance=fn=>(...args)=>{if(resetting)return Promise.reject(Error('Reset is in progress. Wait for it to finish before saving.'));return exclusive('arafat-reset-save',()=>fn(...args));};
  const resolveId=id=>data?.ids?.[String(id)]||id;
  window.WorkspaceStore={start,request,enable:serializedMaintenance(enable),unlock,flush,status,project,discard,exportDevice,restoreDevice:serializedMaintenance(restoreDevice),lock,amounts,uuid,download,tryAutoUnlock,resolveId,resetWorkspace,signIn,signOut};
  let serviceWorkerScheduled=false;
  function scheduleServiceWorker(){if(serviceWorkerScheduled||!('serviceWorker' in navigator))return;serviceWorkerScheduled=true;setTimeout(()=>navigator.serviceWorker.register('/sw.js',{scope:'/'}).then(()=>navigator.storage?.persist?.()).catch(()=>{}),10000);}
})();
