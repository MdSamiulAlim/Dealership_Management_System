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
const hasLocalUI=['index.html','app.js','styles.css'].every(name=>existsSync(resolve('../static',name)));
const publicRoot=resolve('public'),errors=[];let chrome,server,ws;
const operation=(method,path,payload)=>executeCommand(db,{id:crypto.randomUUID(),method,path,payload,workspace_epoch:0});
try{
 const seed=await workspaceBootstrap(db),product=seed.products[0],customer=seed.customers[0];
 await db.prepare('UPDATE products SET opening_stock=50 WHERE id=?').bind(product.id).run();
 async function sale(number,rate=100){const id=crypto.randomUUID();await operation('POST','/api/invoices',{id,invoice_no:number,sale_date:'2026-10-24',customer_id:customer.id,items:[{product_id:product.id,quantity:2,rate}],paid_amount:0,account:'Cash',notes:'<safe note>'});return getInvoice(db,id);}
 const regular=await sale('CUSTOM-INV-QA'),cancelled=await sale('CANCEL-QA'),free=await sale('FREE-RETURN-QA',0),returned=await sale('RETURN-QA');
 await operation('DELETE','/api/invoices/'+cancelled.id,{expected_version:1,confirmed:true});
 for(const invoice of [free,returned])await operation('POST','/api/invoices/'+invoice.id+'/return',{expected_version:1,confirmed:true,return_date:'2026-10-24',reason:'QA return',items:[{id:invoice.items[0].id,quantity:1}]});
 await operation('POST','/api/orders',{product_id:product.id,order_date:'2026-11-16',quantity:5,bag_weight:25,rate:100,status:'Delivered'});
 await operation('POST','/api/adjustments',{product_id:product.id,adjust_date:'2026-11-16',quantity:2,type:'Manual Add',notes:'UI count',confirmed:true});
 await operation('POST','/api/transactions',{txn_date:'2026-11-16',type:'Other Income',amount:1000,account:'Cash'});
 await operation('POST','/api/transactions',{txn_date:'2026-11-16',type:'Bank Deposit',amount:100,account:'Cash'});
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
   const localUI={'/local-app':'index.html','/static/app.js':'app.js','/static/styles.css':'styles.css'}[url.pathname];
   if(localUI&&hasLocalUI){const file=resolve('../static',localUI);res.writeHead(200,{'Content-Type':localUI.endsWith('.js')?'application/javascript':localUI.endsWith('.css')?'text/css':'text/html','Cache-Control':'no-store'});res.end(readFileSync(file));return;}
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
 // New forms and subsequent renders must not choose input for the owner.
 const blank=await evaluate(`(()=>{renderAll();const f=document.querySelector('#invoiceForm');return {customer:f.elements.customer_id.value,name:f.elements.customer_name.value,mobile:f.elements.customer_mobile.value,address:f.elements.customer_address.value,date:f.elements.sale_date.value,paid:f.elements.paid_amount.value,discount:f.elements.discount_value.value,account:f.elements.account.value,product:document.querySelector('[data-item-product]').value,quantity:document.querySelector('[data-item-quantity]').value,rate:document.querySelector('[data-item-rate]').value};})()`);
 assert.ok(Object.values(blank).every(v=>v===''),JSON.stringify(blank));
 const productInputs=await evaluate(`(()=>{const f=document.querySelector('form[data-endpoint=products]');return {names:[...f.querySelectorAll('[name]')].map(e=>e.name),alert:f.elements.low_stock_level.value,required:f.elements.low_stock_level.required};})()`);
 assert.deepEqual(productInputs.names,['name','category','product_code','feed_size','protein_percent','bag_weight','opening_stock','default_rate','low_stock_level']);assert.equal(productInputs.alert,'');assert.equal(productInputs.required,true);
 await evaluate("(()=>{const f=document.querySelector('form[data-endpoint=transactions]');f.elements.type.value='Bank Withdraw';f.elements.type.dispatchEvent(new Event('change',{bubbles:true}));})()");
 assert.equal(await evaluate("document.querySelector('form[data-endpoint=transactions]').elements.account.value"),'Bank');
 assert.equal(await evaluate("document.querySelector('form[data-endpoint=transactions]').elements.account.disabled"),true);
 await evaluate("(()=>{const f=document.querySelector('form[data-endpoint=transactions]');f.elements.type.value='Other Income';f.elements.type.dispatchEvent(new Event('change',{bubbles:true}));})()");
 assert.equal(await evaluate("document.querySelector('form[data-endpoint=transactions]').elements.account.value"),'');
 await evaluate("document.querySelector('form[data-endpoint=transactions]').reset()");
 const catalogBefore=JSON.stringify((await workspaceBootstrap(db)).products);
 await evaluate(`(()=>{const s=document.querySelector('[data-item-product]');s.value='${product.id}';s.dispatchEvent(new Event('change',{bubbles:true}));const f=document.querySelector('#invoiceForm');f.elements.customer_id.value='${customer.id}';f.elements.customer_id.dispatchEvent(new Event('change',{bubbles:true}));})()`);
 assert.equal(await evaluate("document.querySelector('[data-item-rate]').value"),'');
 assert.equal(await evaluate("document.querySelector('#invoiceForm').elements.customer_name.value"),customer.name);
 assert.equal(JSON.stringify((await workspaceBootstrap(db)).products),catalogBefore);
 await evaluate("AdvancedWorkspace.startNewSale();true");await wait("document.querySelector('#confirmActionDialog').open",'new blank sale confirmation');await evaluate("document.querySelector('#confirmActionAccept').click()");
 await wait("document.querySelector('#invoiceForm').elements.customer_id.value==='' && document.querySelector('[data-item-product]').value===''");
 assert.equal(await evaluate("document.querySelector('#invoiceForm').elements.customer_name.value"),'');
 // Shared editors perform real commands through the durable outbox.
 await wait("!!window.RecordEditor",'record editor loaded');
 for(const [entity,values] of [['orders',{quantity:7}],['adjustments',{quantity:3,type:'Manual Minus'}],['transactions',{amount:250}]]){
  const row=(await workspaceBootstrap(db))[entity].find(r=>entity!=='transactions'||r.transfer_id&&r.account==='Cash');
  await evaluate(`RecordEditor.open(${JSON.stringify(entity)},${JSON.stringify(row.id)})`);
  await wait("document.querySelector('#recordEditDialog').open",'record editor opens');
  await evaluate(`(()=>{const f=document.querySelector('#recordEditForm');for(const [k,v] of Object.entries(${JSON.stringify(values)}))f.elements.namedItem(k).value=v;f.dispatchEvent(new Event('input',{bubbles:true}));f.requestSubmit()})()`);
  await wait("document.querySelector('#confirmActionDialog').open",'record edit confirmation');
  await evaluate("document.querySelector('#confirmActionAccept').click()");
  await wait("!document.querySelector('#recordEditDialog').open && WorkspaceStore.status().pending===0",'record edit synchronized');
  const saved=(await workspaceBootstrap(db))[entity].find(r=>r.id===row.id);
  for(const [k,v] of Object.entries(values))assert.equal(saved[k],v);
 }
 const edited=await workspaceBootstrap(db);assert.ok(edited.transactions.filter(t=>t.transfer_id).every(t=>t.amount===250));
 await evaluate("RecordEditor.open('orders',state.orders[0].id); const f=document.querySelector('#recordEditForm');f.elements.notes.value='Unsaved fixture';f.dispatchEvent(new Event('input',{bubbles:true}));document.querySelector('#cancelRecordEdit').click()");
 await wait("document.querySelector('#confirmActionDialog').open",'dirty record close confirmation');
 await evaluate("document.querySelector('#confirmActionCancel').click()");
 assert.equal(await evaluate("document.querySelector('#recordEditDialog').open && document.querySelector('#recordEditForm').elements.notes.value==='Unsaved fixture'"),true);
 await evaluate("document.querySelector('#cancelRecordEdit').click()");await wait("document.querySelector('#confirmActionDialog').open",'discard record confirmation');await evaluate("document.querySelector('#confirmActionAccept').click()");
 await wait("!document.querySelector('#recordEditDialog').open",'record editor discarded');
 assert.equal(await evaluate("document.querySelector('#recordEditFields').textContent"),'');
 await evaluate("document.querySelector('#searchOpenButton')?.click(); document.querySelector('#globalSearch').value='CUSTOM-INV-QA'; renderSearchResults();");
 const found=await evaluate("searchRecords('CUSTOM-INV-QA')");assert.equal(found.length,1);assert.equal(found[0].id,regular.id);
 await evaluate("document.querySelector('#searchDialog').showModal();document.querySelector('[data-search-type=sales]').click()");
 await wait("document.querySelector('#saleViewDialog').open && document.querySelector('#saleMemoContent').textContent.includes('CUSTOM-INV-QA')",'custom search opens UUID invoice');
 await evaluate(`document.querySelector('[data-invoice-edit="${regular.id}"]').click()`);
 await wait("document.querySelector('#invoiceForm').dataset.editing==='CUSTOM-INV-QA'",'edit form');
 await evaluate("document.querySelector('#invoiceNumber').value='EDITED-INV-QA/2026';const editForm=document.querySelector('#invoiceForm');document.querySelector('[data-item-quantity]').value='1';document.querySelector('[data-item-rate]').value='50';editForm.elements.discount_type.value='percent';editForm.elements.discount_value.value='0.57';editForm.dispatchEvent(new Event('input',{bubbles:true}));");
 const preview=await evaluate("WorkspaceStore.amounts({items:[{product_id:state.products[0].id,quantity:1,rate:50}],discount_type:'percent',discount_value:0.57,paid_amount:0})");
 assert.equal(preview.discount,.29);assert.equal(preview.total_amount,49.71);
 await evaluate("document.querySelector('#saveInvoiceButton').click()");
 await wait(`state.invoices.find(i=>i.id==='${regular.id}').invoice_no==='EDITED-INV-QA/2026' && WorkspaceStore.status().pending===0 && !document.querySelector('#saveInvoiceButton').disabled && document.querySelector('#saleViewDialog').open`,'invoice number save');
 assert.equal((await getInvoice(db,regular.id)).invoice_no,'EDITED-INV-QA/2026');
 const savedDiscount=await getInvoice(db,regular.id);assert.equal(savedDiscount.discount,.29);assert.equal(savedDiscount.total_amount,49.71);assert.equal(savedDiscount.items[0].line_total,49.71);
 await evaluate("for(const d of document.querySelectorAll('dialog[open]'))d.close();document.querySelector('#salesFilter').value='returned';document.querySelector('#salesFilter').dispatchEvent(new Event('change',{bubbles:true}));");
 const filtered=await evaluate("document.querySelector('#salesRows').textContent");assert.ok(filtered.includes('FREE-RETURN-QA')&&filtered.includes('RETURN-QA'));assert.ok(!filtered.includes('CANCEL-QA')&&!filtered.includes('EDITED-INV-QA/2026'));
 // Manual copy from a draft must open the dialog; a denied clipboard must also
 // fall back instead of silently leaving the text in a closed dialog.
 await evaluate(`document.querySelector('#salesFilter').value='all';document.querySelector('#salesFilter').dispatchEvent(new Event('change',{bubbles:true}));const form=document.querySelector('#invoiceForm');form.elements.sale_date.value='2026-11-16';form.elements.account.value='Cash';form.elements.paid_amount.value='0';form.elements.customer_id.value='${customer.id}';form.elements.customer_id.dispatchEvent(new Event('change',{bubbles:true}));const line=document.querySelector('.invoice-line');line.querySelector('[data-item-product]').value='${product.id}';line.querySelector('[data-item-product]').dispatchEvent(new Event('change',{bubbles:true}));line.querySelector('[data-item-quantity]').value='1';line.querySelector('[data-item-rate]').value='10';form.elements.invoice_no.value='DRAFT-COPY-QA';Object.defineProperty(navigator,'share',{configurable:true,value:undefined});Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.querySelector('[data-draft-action=share]').click();`);
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
 await evaluate("for(const d of document.querySelectorAll('dialog[open]'))d.close();RecordEditor.open('orders',state.orders[0].id)");
 await wait("document.querySelector('#recordEditDialog').open",'mobile record editor');
 const recordFit=await evaluate("(()=>{const d=document.querySelector('#recordEditDialog'),r=d.getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,scroll:d.scrollWidth,client:d.clientWidth}})()");
 assert.ok(recordFit.left>=-1&&recordFit.right<=recordFit.width+1&&recordFit.scroll<=recordFit.client+1,JSON.stringify(recordFit));
 await evaluate("AppI18n.setLanguage('bn');AdvancedWorkspace.translate()");
 assert.equal(await evaluate("document.querySelector('#recordEditTitle').textContent"),'তথ্য সম্পাদনা');
 await evaluate("document.querySelector('#cancelRecordEdit').click()");
 if(hasLocalUI){
 await cdp('Page.navigate',{url:origin+'/local-app'});
 await wait("typeof state!=='undefined' && state.products?.length>0 && !!document.querySelector('form[data-endpoint=products]')",'local Python UI loaded');
 const localBlank=await evaluate("[...document.querySelectorAll('form[data-endpoint] input[type=number],form[data-endpoint] input[type=date],form[data-endpoint] select')].map(el=>el.value)");
 assert.ok(localBlank.every(v=>v===''),JSON.stringify(localBlank));
 assert.equal(await evaluate("document.querySelector('form[data-endpoint=products]').elements.low_stock_level.required"),true);
 }
 assert.deepEqual(errors,[]);
 const report={status:'passed',new_sale_inputs_blank:true,local_python_ui_inputs_blank:hasLocalUI,product_field_layout_unchanged:true,user_sets_stock_alert:true,explicit_customer_choice_only:true,product_choice_does_not_fill_rate:true,transfer_account_only_after_choice:true,catalog_unchanged_by_forms:true,order_edit:true,adjustment_edit:true,balanced_transfer_edit:true,mobile_record_editor_fits:true,bengali_record_editor:true,unsaved_record_guard:true,custom_invoice_search_and_open:true,invoice_number_edit_persists:true,zero_price_return_included:true,cancellation_without_return_excluded:true,draft_manual_copy_visible:true,clipboard_denial_fallback:true,mobile_copy_fits:true,wrong_restore_password_message:message,device_records_unchanged:true,browser_errors:errors};
 writeFileSync('/tmp/arafat-ui-regression-report.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{
 ws?.close();
 if(chrome&&!chrome.killed){chrome.kill('SIGTERM');await new Promise(resolve=>{chrome.once('exit',resolve);setTimeout(resolve,2000);});}
 if(server)await new Promise(r=>server.close(r));db.connection.close();rmSync(temporary,{recursive:true,force:true});
}
