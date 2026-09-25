import {TypeSafeClient} from '@typesafe-ai/sdk';
import {database} from '@/db/database';
import {currentUser,sameOrigin} from '@/lib/auth';
import {localDate} from '@/lib/dates';
import {mergeSales,validateSalesRows} from '@/lib/metro/sales';
import {DEFAULT_SETTINGS,planLines,planWeek,validSettings} from '@/lib/metro/plan';
import {CHUNK,decideLines} from '@/lib/metro/jev';
import {validOrder} from '@/lib/metro/order';
import {validCatalog} from '@/lib/metro/catalog';
export const dynamic='force-dynamic';
export const maxDuration=60;
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
async function sales(db,user){const row=await db.prepare('SELECT document,imported_at FROM metro_sales WHERE user_id=?').bind(user).first();return row?{...JSON.parse(row.document),importedAt:row.imported_at}:{rows:[],files:[],importedAt:null};}
// The AI Gateway provides the credentials inside Netlify functions only.
function jev(){try{return new TypeSafeClient({timeout:25000,retry:{maxRetries:1}});}catch{return null;}}
async function catalog(db,user){const row=await db.prepare('SELECT document,imported_at FROM metro_catalog WHERE user_id=?').bind(user).first();return row?{...JSON.parse(row.document),importedAt:row.imported_at}:{items:null,importedAt:null};}
function settingsFrom(url){const n=k=>url.searchParams.has(k)?Number(url.searchParams.get(k)):DEFAULT_SETTINGS[k];return validSettings({coverageDays:n('coverageDays'),leadDays:n('leadDays'),safety:n('safety')});}

export async function GET(req){
 const user=await currentUser(req);if(!user)return json({error:'Connexion requise.'},401);
 let settings;try{settings=settingsFrom(new URL(req.url));}catch(e){return json({error:e.message},400);}
 try{const db=database(),today=localDate(new Date()),week=planWeek(today),data=await sales(db,user);
  const [saved,known]=await Promise.all([db.prepare('SELECT document,saved_at FROM metro_orders WHERE user_id=? AND week=?').bind(user,week).first(),catalog(db,user)]);
  const weeks=[...new Set(data.rows.map(r=>r.week))].sort();
  return json({week,settings,lines:planLines(data.rows,settings,today,known.items),files:data.files,catalog:known.items?{count:Object.keys(known.items).length,importedAt:known.importedAt}:null,importedAt:data.importedAt,weeks:{first:weeks[0]||null,last:weeks.at(-1)||null,count:weeks.length},order:saved?{...JSON.parse(saved.document),savedAt:saved.saved_at}:null,jev:!!jev()});
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
  if(body.action==='catalog'){
   let items;try{items=validCatalog(body.items);}catch(e){return json({error:e.message},400);}
   const importedAt=new Date().toISOString();
   await db.prepare('INSERT INTO metro_catalog(user_id,document,imported_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET document=excluded.document,imported_at=excluded.imported_at').bind(user,JSON.stringify({items}),importedAt).run();
   return json({count:Object.keys(items).length});
  }
  if(body.action==='decide'){
   let settings;try{settings=validSettings(body.settings);}catch(e){return json({error:e.message},400);}
   if(!Array.isArray(body.keys)||!body.keys.length||body.keys.length>CHUNK||body.keys.some(k=>typeof k!=='string'))return json({error:'Lignes invalides.'},400);
   const [data,known]=await Promise.all([sales(db,user),catalog(db,user)]),wanted=new Set(body.keys),lines=planLines(data.rows,settings,today,known.items).filter(l=>wanted.has(l.key));
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
