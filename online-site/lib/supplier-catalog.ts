import catalog from './supplier-catalog-2026.json' with {type:'json'};
import initialRecords from './initial-records.json' with {type:'json'};
import type {ProductRecord} from './records.ts';

const key='supplier_product_specs_2026_v1';
const epochGuard="COALESCE((SELECT CAST(value AS INTEGER) FROM app_meta WHERE key='workspace_epoch_v1'),0)=0";
const normalize=(name:string)=>name.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g,' ').trim();
type ImportMarker={revision:string;product_ids:number[];previous_ids:number[]};

// Product metadata only. Never delete records, change rates, or alter bag counts.
export async function applySupplierCatalog(db:D1Database){
 if(await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first())return;
 const epoch=await db.prepare("SELECT value FROM app_meta WHERE key='workspace_epoch_v1'").first<{value:string}>();
 if(Number(epoch?.value||0)>0){
  await db.prepare('INSERT OR IGNORE INTO app_meta(key,value) VALUES (?,?)').bind(key,JSON.stringify({revision:catalog.revision,product_ids:[],previous_ids:[]})).run();return;
 }
 const {results:existing}=await db.prepare('SELECT * FROM products ORDER BY id').all<ProductRecord>();
 const used=new Set<number>(),names=new Set(existing.map(p=>p.name));
 const statements:D1PreparedStatement[]=[],importedNames:string[]=[];
 for(const entry of catalog.products){
  const samePack=existing.filter(p=>!used.has(p.id)&&Number(p.bag_weight)===entry.pack_kg);
  const exact=samePack.find(p=>normalize(p.name)===normalize(entry.name));
  const coded=samePack.filter(p=>p.product_code.trim()===entry.code);
  const aliases=samePack.filter(p=>entry.aliases.some(alias=>normalize(alias)===normalize(p.name)));
  const match=exact||(coded.length===1?coded[0]:undefined)||(aliases.length===1?aliases[0]:undefined);
  let name=entry.name;
  if(!match&&names.has(name))name=`${entry.name} [${entry.code}]`;
  if(match&&name!==match.name&&names.has(name))name=match.name;
  importedNames.push(name);names.add(name);
  if(match){
   used.add(match.id);
   statements.push(db.prepare(`UPDATE products SET name=?,product_code=?,category=?,feed_size=?,protein_percent=? WHERE id=? AND NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?) AND ${epochGuard}`).bind(name,entry.code,entry.category,entry.feed_size,entry.protein_percent,match.id,key));
  }else{
   statements.push(db.prepare(`INSERT INTO products(name,product_code,category,feed_size,protein_percent,bag_weight,low_stock_level) SELECT ?,?,?,?,?,?,5 WHERE NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?) AND ${epochGuard} ON CONFLICT(name) DO NOTHING`).bind(name,entry.code,entry.category,entry.feed_size,entry.protein_percent,entry.pack_kg,key));
  }
 }
 // Keep older supplier items accessible without mixing them into the new list.
 // User-created products are never hidden by this import.
 const previous=existing.filter(p=>!used.has(p.id)&&initialRecords.products.some(seed=>seed.id===p.id&&normalize(seed.name)===normalize(p.name))).map(p=>p.id);
 statements.push(db.prepare(`INSERT OR IGNORE INTO app_meta(key,value) SELECT ?,json_object('revision',?,'previous_ids',json(?),'product_ids',json_group_array(id)) FROM products WHERE name IN (${importedNames.map(()=>'?').join(',')}) HAVING ${epochGuard}`).bind(key,catalog.revision,JSON.stringify(previous),...importedNames));
 await db.batch(statements);
}

export async function supplierCatalogState(db:D1Database){
 const row=await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(key).first<{value:string}>();
 return supplierCatalogFromValue(row?.value);
}
export function supplierCatalogFromValue(value?:string){
 const marker:ImportMarker=value?JSON.parse(value):{revision:catalog.revision,product_ids:[],previous_ids:[]};
 return {...marker,source_dates:catalog.source_dates};
}

// One-time catalog cleanup: retain physical stock and transaction references.
// Archive all pre-existing items outside the supplied list, including custom ones.
export async function removeUnlistedProducts(db:D1Database){
 const cleanupKey='supplier_product_cleanup_2026_v1';
 if(await db.prepare('SELECT value FROM app_meta WHERE key=?').bind(cleanupKey).first())return;
 const source=await supplierCatalogState(db),keep=source.product_ids;
 if(keep.length!==catalog.products.length)return;
 const placeholders=keep.map(()=>'?').join(',');
 await db.batch([
  db.prepare(`UPDATE products SET archived=1 WHERE id NOT IN (${placeholders}) AND NOT EXISTS(SELECT 1 FROM app_meta WHERE key=?) AND ${epochGuard}`).bind(...keep,cleanupKey),
  db.prepare(`INSERT OR IGNORE INTO app_meta(key,value) SELECT ?,json_object('archived_ids',json_group_array(id)) FROM products WHERE archived=1 HAVING ${epochGuard}`).bind(cleanupKey),
 ]);
}
