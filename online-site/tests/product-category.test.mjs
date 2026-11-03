import assert from 'node:assert/strict';
import test from 'node:test';
import {randomUUID} from 'node:crypto';
import {readFileSync,readdirSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {database,D1Adapter} from './d1-adapter.mjs';
import {bootstrap,ensureSeeded,inferProductCategory,insertRecord,updateProduct} from '../lib/ledger.ts';
import {executeCommand,workspaceBootstrap} from '../lib/workspace.ts';
const command=(method,path,payload)=>({id:randomUUID(),method,path,payload});

test('existing catalog receives matching client/server categories while quantities and balances are preserved',async()=>{
 const db=database();try{
  const source=readFileSync(new URL('../public/dealership.js',import.meta.url),'utf8').split('\nbindEvents();')[0],client=vm.createContext({Intl});
  vm.runInContext(source+'\nglobalThis.categoryOf=productCategory;',client);
  const snapshot=await bootstrap(db),counts={};
  for(const p of snapshot.products){assert.ok(p.category,p.name);assert.equal(client.categoryOf(p),p.category);assert.equal(client.categoryOf({name:p.name}),inferProductCategory(p.name));counts[p.category]=(counts[p.category]||0)+1;}
  assert.deepEqual(counts,{'Cattle feed':5,'Poultry feed':7,'Fish feed':48});
  assert.equal(inferProductCategory('Missing custom item'),'');
  await db.prepare("UPDATE products SET category='Poultry feed' WHERE id=?").bind(snapshot.products[0].id).run();
  await ensureSeeded(new D1Adapter(db.connection));
  const later=await bootstrap(db);assert.equal(later.products[0].category,'Poultry feed');
  for(const key of ['sales','orders','payments','adjustments','customers'])assert.deepEqual(later[key],snapshot[key]);
  for(const [key,value] of Object.entries(snapshot.dashboard))if(typeof value==='number')assert.equal(later.dashboard[key],value,key);
  for(const before of snapshot.products){const after=later.products.find(p=>p.id===before.id);for(const field of ['opening_stock','received_stock','sold_stock','current_stock','default_rate'])assert.equal(after[field],before[field]);}
 }finally{db.connection.close();}
});

test('schema upgrade classifies existing records once without replacing products or stock',async()=>{
 const connection=new DatabaseSync(':memory:');try{
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f<'0005_').sort())connection.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  connection.exec("INSERT INTO app_meta(key,value) VALUES('initial_records_v1','imported'); INSERT INTO products(name,opening_stock,default_rate) VALUES('Tilapia Grower',7,100),('Dairy Cattle',9,200),('Broiler Starter',11,300),('Custom item',2,10)");
  connection.exec(readFileSync(new URL('../drizzle/0005_product_feed_categories.sql',import.meta.url),'utf8'));
  for(const file of readdirSync(new URL('../drizzle/',import.meta.url)).filter(f=>f.endsWith('.sql')&&f>'0005_product_feed_categories.sql').sort())connection.exec(readFileSync(new URL('../drizzle/'+file,import.meta.url),'utf8'));
  const snapshot=await bootstrap(new D1Adapter(connection)),rows=Object.fromEntries(snapshot.products.map(p=>[p.name,p]));
  assert.equal(rows['Tilapia Grower'].category,'Fish feed');assert.equal(rows['Dairy Cattle'].category,'Cattle feed');assert.equal(rows['Broiler Starter'].category,'Poultry feed');assert.equal(rows['Custom item'].category,'');
  assert.equal(rows['Tilapia Grower'].current_stock,7);assert.equal(rows['Dairy Cattle'].default_rate,200);assert.equal(snapshot.products.length,4);
 }finally{connection.close();}
});

test('category creation and both editors validate choices and reject stale category changes',async()=>{
 const db=database();try{
  await workspaceBootstrap(db);
  const created=await executeCommand(db,command('POST','/api/products',{name:'Custom feed',category:'Fish feed',opening_stock:5,default_rate:100}));
  const original=(await workspaceBootstrap(db)).products.find(p=>String(p.id)===created.id);
  await executeCommand(db,command('PATCH',`/api/products/${original.id}`,{category:'Cattle feed',original}));
  let current=(await workspaceBootstrap(db)).products.find(p=>p.id===original.id);assert.equal(current.category,'Cattle feed');assert.equal(current.current_stock,5);
  await assert.rejects(executeCommand(db,command('PATCH',`/api/products/${original.id}`,{category:'Poultry feed',original})),{status:409});
  await updateProduct(db,current.id,{category:'Poultry feed',original:current});
  current=(await workspaceBootstrap(db)).products.find(p=>p.id===original.id);assert.equal(current.category,'Poultry feed');
  await assert.rejects(updateProduct(db,current.id,{category:'Fish feed',original}),{status:409});
  for(const category of ['Other','',null]){
   await assert.rejects(insertRecord(db,'products',{name:'Invalid',category}),{status:400});
   await assert.rejects(updateProduct(db,current.id,{category,original:current}),{status:400});
  }
  assert.equal((await workspaceBootstrap(db)).products.find(p=>p.id===current.id).category,'Poultry feed');
 }finally{db.connection.close();}
});

test('offline category changes are projected and validated before syncing',()=>{
 let source=readFileSync(new URL('../public/offline-store.js',import.meta.url),'utf8').replace('window.WorkspaceStore={','window.CategoryTest={validateMutation,apply};window.WorkspaceStore={');
 const context=vm.createContext({window:{addEventListener(){}},navigator:{},localStorage:{getItem(){return null}},structuredClone,Intl,setInterval(){}});vm.runInContext(source,context);
 const {validateMutation,apply}=context.window.CategoryTest,snapshot={products:[{id:1,name:'Feed',category:'Fish feed'}]};
 const edit=command('PATCH','/api/products/1',{category:'Poultry feed'});validateMutation(edit.path,edit.method,edit.payload);apply(snapshot,edit);assert.equal(snapshot.products[0].category,'Poultry feed');
 for(const category of ['Other',''])assert.throws(()=>validateMutation('/api/products/1','PATCH',{category}),/Choose Fish feed/);
});
