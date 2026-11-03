// Real browser UI checks with disposable SQLite and an HTTP fixture. Security
// and login contracts are tested separately against the built Worker.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,extname} from 'node:path';
import {spawn} from 'node:child_process';
import {webcrypto} from 'node:crypto';
import {database} from './d1-adapter.mjs';
import {workspaceBootstrap,executeCommand,getInvoice} from '../lib/workspace.ts';
import {replicaStart,replicaPage,replicaBundle,replicaChanges} from '../lib/replica.ts';
const pause=ms=>new Promise(r=>setTimeout(r,ms));
const temporary=mkdtempSync(join(tmpdir(),'arafat-ui-fixes-')),db=database(),user={username:'FixtureOwner',role:'admin'};
const publicRoot=resolve('public'),errors=[];let chrome,server,ws;
const operation=(method,path,payload)=>executeCommand(db,{id:crypto.randomUUID(),method,path,payload,workspace_epoch:0});
try{
 const seed=await workspaceBootstrap(db),product=seed.products[0],customer=seed.customers[0];
 await db.prepare('UPDATE products SET opening_stock=50 WHERE id=?').bind(product.id).run();
 async function sale(number,rate=100){const id=crypto.randomUUID();await operation('POST','/api/invoices',{id,invoice_no:number,sale_date:'2026-10-24',customer_id:customer.id,items:[{product_id:product.id,quantity:2,rate}],paid_amount:0,account:'Cash',notes:'<safe note>'});return getInvoice(db,id);}
 const regular=await sale('CUSTOM-INV-QA'),cancelled=await sale('CANCEL-QA'),free=await sale('FREE-RETURN-QA',0),returned=await sale('RETURN-QA');
 await operation('DELETE','/api/invoices/'+cancelled.id,{expected_version:1,confirmed:true});
 for(const invoice of [free,returned])await operation('POST','/api/invoices/'+invoice.id+'/return',{expected_version:1,confirmed:true,return_date:'2026-10-24',reason:'QA return',items:[{id:invoice.items[0].id,quantity:1}]});
 const backupBase={...await workspaceBootstrap(db),user},salt=webcrypto.getRandomValues(new Uint8Array(16)),iv=webcrypto.getRandomValues(new Uint8Array(12));
 const key=await webcrypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:250000,hash:'SHA-256'},await webcrypto.subtle.importKey('raw',new TextEncoder().encode('fixture-correct-password'),'PBKDF2',false,['deriveKey']),{name:'AES-GCM',length:256},false,['encrypt']);
 const cipher=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(JSON.stringify({base:backupBase,queue:[],ids:{}})));
 const backupPath=join(temporary,'device-backup.json');writeFileSync(backupPath,JSON.stringify({format:'arafat-encrypted-v2',username:user.username,salt:Buffer.from(salt).toString('base64'),iv:Buffer.from(iv).toString('base64'),cipher:Buffer.from(cipher).toString('base64')}));
 server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://fixture.test');
  try{
   if(url.pathname.startsWith('/api/')){
    let raw='';for await(const chunk of req)raw+=chunk;const payload=raw?JSON.parse(raw):{};let value;
    if(url.pathname==='/api/check-login'||url.pathname==='/api/login')value={ok:true,user,sync_protocol:2};
    else if(url.pathname==='/api/replica/start')value={...await replicaStart(db,url.searchParams.get('packed')==='1'),user};
    else if(url.pathname==='/api/replica/rows')value=await replicaPage(db,url);
    else if(url.pathname==='/api/replica/bundle')value=await replicaBundle(db,url);
    else if(url.pathname==='/api/replica/changes')value=await replicaChanges(db,url);
    else if(url.pathname==='/api/bootstrap')value={...await workspaceBootstrap(db),user};
    else if(url.pathname==='/api/commands')value={sync_protocol:2,command_result:await executeCommand(db,payload)};
    else if(url.pathname.startsWith('/api/invoices/'))value=await getInvoice(db,url.pathname.split('/')[3]);
    else throw Object.assign(Error('Unknown fixture API'),{status:404});
    res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value));return;
   }
   const file=url.pathname==='/'?join(publicRoot,'offline-shell.txt'):resolve(publicRoot,'.'+decodeURIComponent(url.pathname));
   if(!file.startsWith(publicRoot+'/')||!existsSync(file)){res.writeHead(404);res.end();return;}
   const types={'.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ttf':'font/ttf','.txt':'text/html'};
   res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(readFileSync(file));
  }catch(error){res.writeHead(error.status||500,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 chrome=spawn('/usr/bin/google-chrome',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0','--user-data-dir='+join(temporary,'chrome'),'--window-size=1280,900','about:blank'],{stdio:'ignore'});
 const portFile=join(temporary,'chrome','DevToolsActivePort');
 for(let i=0;!existsSync(portFile)&&i<100;i++)await pause(100);
 assert.ok(existsSync(portFile),'Chrome did not start');
 const port=Number(readFileSync(portFile,'utf8').split('\n')[0]);
 const target=(await (await fetch('http://127.0.0.1:'+port+'/json/list')).json()).find(t=>t.type==='page');
 ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});
 let next=1;const pending=new Map();
 ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id){const entry=pending.get(message.id);if(entry){pending.delete(message.id);clearTimeout(entry.timer);if(message.error)entry.reject(Error(message.error.message));else entry.resolve(message.result);}}else if(message.method==='Runtime.exceptionThrown')errors.push(message.params.exceptionDetails.exception?.description||message.params.exceptionDetails.text);});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>{pending.delete(id);reject(Error('CDP timed out: '+method));},25000);pending.set(id,{resolve,reject,timer});ws.send(JSON.stringify({id,method,params}));});
 const evaluate=async expression=>{const result=await cdp('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text);return result.result?.value;};
 async function wait(expression,label){for(let i=0;i<150;i++){if(await evaluate(expression))return;await pause(100);}console.error(JSON.stringify({label,diagnostic:await evaluate("({copy:document.querySelector('#invoiceCopyText')?.value?.slice(0,200),open:[...document.querySelectorAll('dialog[open]')].map(d=>d.id),toast:document.querySelector('#toast')?.textContent,errors:document.querySelector('#invoiceFormError')?.textContent,actions:document.querySelector('#saleMemoActions')?.textContent})")}));throw Error('UI timed out: '+label);}
 await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Page.navigate',{url:origin});
 await wait("typeof state!=='undefined' && state.invoices?.length===4 && window.WorkspaceStore?.status().pending===0",'initial replica');
 await evaluate("document.querySelector('#searchOpenButton')?.click(); document.querySelector('#globalSearch').value='CUSTOM-INV-QA'; renderSearchResults();");
 const found=await evaluate("searchRecords('CUSTOM-INV-QA')");assert.equal(found.length,1);assert.equal(found[0].id,regular.id);
 await evaluate("document.querySelector('#searchDialog').showModal();document.querySelector('[data-search-type=sales]').click()");
 await wait("document.querySelector('#saleViewDialog').open && document.querySelector('#saleMemoContent').textContent.includes('CUSTOM-INV-QA')",'custom search opens UUID invoice');
 await evaluate(`document.querySelector('[data-invoice-edit="${regular.id}"]').click()`);
 await wait("document.querySelector('#invoiceForm').dataset.editing==='CUSTOM-INV-QA'",'edit form');
 await evaluate("document.querySelector('#invoiceNumber').value='EDITED-INV-QA/2026'; document.querySelector('#saveInvoiceButton').click()");
 await wait(`state.invoices.find(i=>i.id==='${regular.id}').invoice_no==='EDITED-INV-QA/2026' && WorkspaceStore.status().pending===0 && !document.querySelector('#saveInvoiceButton').disabled && document.querySelector('#saleViewDialog').open`,'invoice number save');
 assert.equal((await getInvoice(db,regular.id)).invoice_no,'EDITED-INV-QA/2026');
 await evaluate("for(const d of document.querySelectorAll('dialog[open]'))d.close();document.querySelector('#salesFilter').value='returned';document.querySelector('#salesFilter').dispatchEvent(new Event('change',{bubbles:true}));");
 const filtered=await evaluate("document.querySelector('#salesRows').textContent");assert.ok(filtered.includes('FREE-RETURN-QA')&&filtered.includes('RETURN-QA'));assert.ok(!filtered.includes('CANCEL-QA')&&!filtered.includes('EDITED-INV-QA/2026'));
 // Manual copy from a draft must open the dialog; a denied clipboard must also
 // fall back instead of silently leaving the text in a closed dialog.
 await evaluate(`document.querySelector('#salesFilter').value='all';document.querySelector('#salesFilter').dispatchEvent(new Event('change',{bubbles:true}));const form=document.querySelector('#invoiceForm');form.elements.customer_id.value='${customer.id}';form.elements.customer_id.dispatchEvent(new Event('change',{bubbles:true}));const line=document.querySelector('.invoice-line');line.querySelector('[data-item-product]').value='${product.id}';line.querySelector('[data-item-product]').dispatchEvent(new Event('change',{bubbles:true}));line.querySelector('[data-item-quantity]').value='1';line.querySelector('[data-item-rate]').value='10';form.elements.invoice_no.value='DRAFT-COPY-QA';Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.querySelector('[data-draft-action=share]').click();`);
 await wait("document.querySelector('#saleViewDialog').open && !!document.querySelector('#invoiceCopyText')",'visible draft copy fallback');
 const manual=await evaluate("(()=>{const a=document.querySelector('#invoiceCopyText'),r=a.getBoundingClientRect();return {text:a.value,selected:a.selectionEnd-a.selectionStart,width:r.width,height:r.height,visible:a.checkVisibility()};})()");
 assert.ok(manual.text.includes('DRAFT-COPY-QA'));assert.equal(manual.selected,manual.text.length);assert.ok(manual.visible&&manual.width>100&&manual.height>100);
 await evaluate("Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new DOMException('Denied','NotAllowedError')}}});document.querySelector('[data-current-action=share]').click();");
 await wait("document.querySelector('#invoiceCopyText')?.value.includes('DRAFT-COPY-QA')",'denied clipboard fallback');
 assert.equal(await evaluate("document.querySelectorAll('#invoiceCopyPanel').length"),1);
 // Wrong AES-GCM password errors can have an empty browser message.
 await evaluate("for(const d of document.querySelectorAll('dialog[open]'))d.close()");
 const {root}=await cdp('DOM.getDocument');const {nodeId}=await cdp('DOM.querySelector',{nodeId:root.nodeId,selector:'#restoreDeviceBackup'});
 await cdp('DOM.setFileInputFiles',{nodeId,files:[backupPath]});
 await wait("document.querySelector('#confirmActionDialog').open",'restore confirmation');await evaluate("document.querySelector('#confirmActionAccept').click()");
 await wait("document.querySelector('#offlineUnlockDialog').open",'restore password form');
 await evaluate("const unlock=document.querySelector('#offlineUnlockForm');unlock.elements.username.value='FixtureOwner';unlock.elements.password.value='incorrect-password';unlock.requestSubmit()");
 await wait("document.querySelector('#offlineUnlockError').textContent.trim().length>0",'restore password error');
 const message=await evaluate("document.querySelector('#offlineUnlockError').textContent");assert.ok(message.length>10);assert.equal(await evaluate('WorkspaceStore.status().enabled'),false);
 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await evaluate("document.querySelector('#offlineUnlockDialog').close();document.querySelector('[data-draft-action=share]').click()");
 await wait("document.querySelector('#saleViewDialog').open && !!document.querySelector('#invoiceCopyText')",'mobile copy fallback');
 const mobile=await evaluate("(()=>{const r=document.querySelector('#invoiceCopyText').getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,visible:document.querySelector('#invoiceCopyText').checkVisibility()};})()");assert.ok(mobile.visible&&mobile.left>=0&&mobile.right<=mobile.width);
 assert.deepEqual(errors,[]);
 const report={status:'passed',custom_invoice_search_and_open:true,invoice_number_edit_persists:true,zero_price_return_included:true,cancellation_without_return_excluded:true,draft_manual_copy_visible:true,clipboard_denial_fallback:true,mobile_copy_fits:true,wrong_restore_password_message:message,device_records_unchanged:true,browser_errors:errors};
 writeFileSync('/tmp/arafat-ui-regression-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 ws?.close();
 if(chrome&&!chrome.killed){chrome.kill('SIGTERM');await new Promise(resolve=>{chrome.once('exit',resolve);setTimeout(resolve,2000);});}
 if(server)await new Promise(r=>server.close(r));db.connection.close();rmSync(temporary,{recursive:true,force:true});
}
