import {TypeSafeClient} from '@typesafe-ai/sdk';
import {database} from '@/db/database';
import {currentUser,sameOrigin} from '@/lib/auth';
import {localDate} from '@/lib/dates';
import {addDays,mergeSales,validateSalesRows} from '@/lib/metro/sales';
import {DEFAULT_SETTINGS,planLines,planWeek,validSettings} from '@/lib/metro/plan';
import {CHUNK,decideLines} from '@/lib/metro/jev';
import {validOrder} from '@/lib/metro/order';
import {validCatalog} from '@/lib/metro/catalog';
import {catalogPage,shopifyClient} from '@/lib/metro/shopify';
import {matchStock,validStockRows} from '@/lib/metro/stock';
import {matchInvoice,validInvoice} from '@/lib/metro/invoice';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function sales(db,user){const row=await db.prepare('SELECT document,imported_at FROM metro_sales WHERE user_id=?').bind(user).first();return row?{...JSON.parse(row.document),importedAt:row.imported_at}:{rows:[],files:[],importedAt:null};}
// The AI Gateway provides the credentials inside Netlify functions only.
function jev(){try{return new TypeSafeClient({timeout:25000,retry:{maxRetries:1}});}catch{return null;}}
async function catalog(db,user){const row=await db.prepare('SELECT document,imported_at FROM metro_catalog WHERE user_id=?').bind(user).first();return row?{...JSON.parse(row.document),importedAt:row.imported_at}:{items:null,importedAt:null};}
// Shelf stock per Metro: {metro: {items, asOf, filename, matched, unmatched, importedAt}}.
async function stocks(db,user){const r=await db.prepare('SELECT metro,document,imported_at FROM metro_stock WHERE user_id=?').bind(user).all();return Object.fromEntries(r.results.map(x=>[x.metro,{...JSON.parse(x.document),importedAt:x.imported_at}]));}
// Invoices of the last 26 weeks, newest first.
async function invoices(db,user){const r=await db.prepare('SELECT number,metro,invoice_date,document,imported_at FROM metro_invoices WHERE user_id=? AND invoice_date>=? ORDER BY invoice_date DESC,number DESC').bind(user,addDays(localDate(new Date()),-182)).all();return r.results.map(x=>({number:x.number,metro:x.metro,date:x.invoice_date,...JSON.parse(x.document),importedAt:x.imported_at}));}
function settingsFrom(url){const n=k=>url.searchParams.has(k)?Number(url.searchParams.get(k)):DEFAULT_SETTINGS[k];return validSettings({coverageDays:n('coverageDays'),leadDays:n('leadDays'),safety:n('safety')});}

export async function GET(req){
 const user=await currentUser(req);if(!user)return json({error:'Connexion requise.'},401);
 let settings;try{settings=settingsFrom(new URL(req.url));}catch(e){return json({error:e.message},400);}
 try{const db=database(),today=localDate(new Date()),week=planWeek(today),data=await sales(db,user);
  const [saved,known,shelf,delivered]=await Promise.all([db.prepare('SELECT document,saved_at FROM metro_orders WHERE user_id=? AND week=?').bind(user,week).first(),catalog(db,user),stocks(db,user),invoices(db,user)]);
  // Complete weeks feed the rule; a week still in progress is shown apart.
  const all=[...new Set(data.rows.map(r=>r.week))].sort(),weeks=all.filter(w=>addDays(w,6)<today),current=all.filter(w=>addDays(w,6)>=today);
  const progress=current.map(w=>({week:w,metros:[...new Map(data.rows.filter(r=>r.week===w).map(r=>[r.metro,r.days])).entries()].map(([metro,days])=>({metro,days}))}));
  return json({week,settings,lines:planLines(data.rows,settings,today,known.items,shelf,delivered),invoices:delivered.slice(0,30).map(i=>({number:i.number,metro:i.metro,date:i.date,lines:i.lines,items:i.units,total:i.total,matched:i.matched,unmatched:i.unmatched.length,counted:!!shelf[i.metro]?.asOf&&i.date>shelf[i.metro].asOf,importedAt:i.importedAt})),stocks:Object.fromEntries(Object.entries(shelf).map(([m,v])=>[m,{asOf:v.asOf,filename:v.filename,matched:v.matched,unmatched:v.unmatched,negative:Object.values(v.items).filter(x=>x<0).length,importedAt:v.importedAt}])),files:data.files,catalog:known.items?{source:known.source||'export',count:Object.keys(known.items).length,priced:Object.values(known.items).filter(v=>v.cost!=null).length,importedAt:known.importedAt}:null,importedAt:data.importedAt,weeks:{first:weeks[0]||null,last:weeks.at(-1)?addDays(weeks.at(-1),6):null,count:weeks.length,current:progress},order:saved?{...JSON.parse(saved.document),savedAt:saved.saved_at}:null,jev:!!jev(),shopify:!!process.env.SHOPIFY_ADMIN_ACCESS_TOKEN});
 }catch{return json({error:'Données Metro indisponibles.'},503);}
}
export async function POST(req){
 const user=await currentUser(req);if(!user)return json({error:'Connexion requise.'},401);
 if(!sameOrigin(req))return json({error:'Origine invalide.'},403);
 try{
  const text=await req.text();if(text.length>8000000)return json({error:'Fichier trop volumineux.'},413);
  const body=JSON.parse(text),db=database(),today=localDate(new Date());
  if(body.action==='import'){
   let rows;try{rows=validateSalesRows(body.rows);}catch(e){return json({error:e.message},400);}
   const old=await sales(db,user),merged=mergeSales(old.rows,rows),filename=String(body.filename||'ventes').slice(0,200),importedAt=new Date().toISOString();
   const files=[{name:filename,importedAt,lines:rows.length},...(old.files||[])].slice(0,20);
   await db.prepare('INSERT INTO metro_sales(user_id,document,imported_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document,imported_at=excluded.imported_at').bind(user,JSON.stringify({rows:merged,files}),importedAt).run();
   return json({lines:rows.length,total:merged.length});
  }
  // One page of the Shopify catalog; the browser chains the pages then saves them with 'catalog'.
  if(body.action==='shopify-page'){
   if(body.cursor!==null&&body.cursor!==undefined&&(typeof body.cursor!=='string'||body.cursor.length>500))return json({error:'Page invalide.'},400);
   try{return json(await catalogPage(shopifyClient(process.env.SHOPIFY_ADMIN_ACCESS_TOKEN),body.cursor||null));}catch(e){return json({error:e.message},502);}
  }
  // Shelf stock of one Metro, matched to its barcodes through the Shopify catalog.
  if(body.action==='stock'){
   let rows;try{rows=validStockRows(body.rows);}catch(e){return json({error:e.message},400);}
   const metro=String(body.metro||'').slice(0,120),asOf=/^\d{4}-\d{2}-\d{2}$/.test(body.asOf||'')?body.asOf:null;
   if(!metro)return json({error:'Choisissez le Metro de ce fichier de stock.'},400);
   const known=await catalog(db,user);if(!known.items)return json({error:'Lisez d’abord le catalogue Shopify : il relie les SKU du fichier de stock aux codes-barres Metro.'},400);
   const {items,matched,unmatched}=matchStock(rows,known.items),importedAt=new Date().toISOString(),filename=String(body.filename||'stock').slice(0,200);
   if(!matched)return json({error:'Aucun produit du fichier n’a été reconnu dans le catalogue Shopify. Actualisez le catalogue (il doit contenir les SKU) puis réessayez.'},400);
   await db.prepare('INSERT INTO metro_stock(user_id,metro,document,imported_at) VALUES(?,?,?,?) ON CONFLICT(user_id,metro) DO UPDATE SET document=excluded.document,imported_at=excluded.imported_at').bind(user,metro,JSON.stringify({items,asOf,filename,matched,unmatched:unmatched.length}),importedAt).run();
   return json({matched,unmatched:unmatched.length,unmatchedSample:unmatched.slice(0,5),negative:Object.values(items).filter(x=>x<0).length});
  }
  // An invoice « Commande interne » (read from the PDF in the browser).
  if(body.action==='invoice'){
   let inv;try{inv=validInvoice(body.invoice);}catch(e){return json({error:e.message},400);}
   const known=await catalog(db,user);if(!known.items)return json({error:'Lisez d’abord le catalogue Shopify : il relie les produits de la facture aux codes-barres Metro.'},400);
   const {items,unmatched}=matchInvoice(inv.lines,known.items),importedAt=new Date().toISOString();
   const doc={items,matched:inv.lines.length-unmatched.length,unmatched:unmatched.slice(0,200),lines:inv.lines.length,units:inv.lines.reduce((n,l)=>n+l.qty,0),total:Math.round(inv.lines.reduce((n,l)=>n+l.total,0)*100)/100};
   await db.prepare('INSERT INTO metro_invoices(user_id,number,metro,invoice_date,document,imported_at) VALUES(?,?,?,?,?,?) ON CONFLICT(user_id,number) DO UPDATE SET metro=excluded.metro,invoice_date=excluded.invoice_date,document=excluded.document,imported_at=excluded.imported_at').bind(user,inv.number,inv.metro,inv.date,JSON.stringify(doc),importedAt).run();
   const asOf=(await stocks(db,user))[inv.metro]?.asOf||null;
   return json({number:inv.number,metro:inv.metro,date:inv.date,lines:doc.lines,units:doc.units,matched:doc.matched,unmatched:unmatched.length,unmatchedSample:unmatched.slice(0,5),asOf,counted:!!asOf&&inv.date>asOf});
  }
  if(body.action==='invoice-delete'){
   if(typeof body.number!=='string'||!/^\d{4,20}$/.test(body.number))return json({error:'Facture invalide.'},400);
   await db.prepare('DELETE FROM metro_invoices WHERE user_id=? AND number=?').bind(user,body.number).run();
   return json({deleted:body.number});
  }
  if(body.action==='catalog'){
   let items;try{items=validCatalog(body.items);}catch(e){return json({error:e.message},400);}
   const importedAt=new Date().toISOString();
   const source=body.source==='shopify'?'shopify':'export';
   await db.prepare('INSERT INTO metro_catalog(user_id,document,imported_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document,imported_at=excluded.imported_at').bind(user,JSON.stringify({items,source}),importedAt).run();
   return json({count:Object.keys(items).length,priced:Object.values(items).filter(v=>v.cost!=null).length});
  }
  if(body.action==='decide'){
   let settings;try{settings=validSettings(body.settings);}catch(e){return json({error:e.message},400);}
   if(!Array.isArray(body.keys)||!body.keys.length||body.keys.length>CHUNK||body.keys.some(k=>typeof k!=='string'))return json({error:'Lignes invalides.'},400);
   const [data,known,shelf,delivered]=await Promise.all([sales(db,user),catalog(db,user),stocks(db,user),invoices(db,user)]),wanted=new Set(body.keys),lines=planLines(data.rows,settings,today,known.items,shelf,delivered).filter(l=>wanted.has(l.key));
   return json({decisions:await decideLines(jev(),lines,settings)});
  }
  if(body.action==='save'){
   let order;try{order=validOrder(body.order,planWeek(today));}catch(e){return json({error:e.message},400);}
   const savedAt=new Date().toISOString();
   await db.prepare('INSERT INTO metro_orders(user_id,week,document,saved_at) VALUES(?,?,?,?) ON CONFLICT(user_id,week) DO UPDATE SET document=excluded.document,saved_at=excluded.saved_at').bind(user,order.week,JSON.stringify(order),savedAt).run();
   return json({savedAt});
  }
  return json({error:'Action inconnue.'},400);
 }catch(e){return json({error:e instanceof SyntaxError?'Format invalide.':'Enregistrement impossible. Réessayez.'},e instanceof SyntaxError?400:503);}
}
