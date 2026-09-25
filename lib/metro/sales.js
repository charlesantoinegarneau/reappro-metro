// Metro sales files: any export with one line per Metro, product and date
// (Excel or CSV). Columns are recognised by name; lines are summed per week.
// Shared by the browser (reading the file) and the server (validating rows).
import {readXlsx,repairText,splitCsv} from '../xlsx.js';

export const KEEP_WEEKS=26;
const COLUMNS={
 metro:['metro','magasin','succursale','store','location','emplacement','point de vente','banniere','client'],
 sku:['sku','upc','cup','code produit','code','no article','numero article','article'],
 product:['produit','description','nom du produit','nom','product','item'],
 units:['unites vendues','quantite vendue','qte vendue','unites','quantite','qte','qty','quantity','units','ventes (unites)','ventes unites'],
 date:['date','semaine','week','jour','periode','day'],
 stock:['stock','inventaire','en main','on hand','qte en main'],
 pack:['format caisse','caisse','colis','pack','case pack','case']
};
const REQUIRED=['metro','sku','units','date'];
const LABELS={metro:'Metro (magasin)',sku:'SKU ou UPC',units:'Unités vendues',date:'Date ou semaine'};
const norm=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[_#.]/g,' ').replace(/\s+/g,' ').trim();

export const addDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+n);return x.toISOString().slice(0,10);};
// Weeks run Monday to Sunday and are named by their Monday.
export const weekOf=d=>addDays(d,-((new Date(d+'T12:00:00Z').getUTCDay()+6)%7));

// Header → column index. An exact name wins over a name that only contains a synonym.
export function detectColumns(header){
 const names=header.map(norm),index={},used=new Set();
 for(const [key,words] of Object.entries(COLUMNS)){
  let found=-1;
  for(const w of words){found=names.findIndex((n,i)=>!used.has(i)&&n===w);if(found>=0)break;}
  if(found<0)for(const w of words){found=names.findIndex((n,i)=>!used.has(i)&&(n.startsWith(w+' ')||n.endsWith(' '+w)||n.includes(' '+w+' ')));if(found>=0)break;}
  if(found>=0){index[key]=found;used.add(found);}
 }
 return index;
}
export function parseDate(value){
 const s=String(value??'').trim();
 if(/^\d{5}(\.\d+)?$/.test(s)){const n=Math.floor(+s);if(n>30000&&n<80000)return new Date(Date.UTC(1899,11,30)+n*864e5).toISOString().slice(0,10);}
 let m=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/.exec(s);
 if(!m){const d=/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s);if(d)m=[null,d[3],d[2],d[1]];}
 if(!m)return null;
 const iso=m[1]+'-'+m[2].padStart(2,'0')+'-'+m[3].padStart(2,'0');
 return !isNaN(Date.parse(iso))&&new Date(iso+'T12:00:00Z').toISOString().slice(0,10)===iso?iso:null;
}
// "1 234,5" (French) or "1234.5".
export function parseNumber(value){
 let s=String(value??'').replace(/[\s $]/g,'');if(!s)return null;
 if(/,\d{1,3}$/.test(s)&&!s.includes('.'))s=s.replace(',','.');else s=s.replace(/,/g,'');
 const n=Number(s);return Number.isFinite(n)?n:null;
}

// Table (array of rows) → weekly rows {metro, sku, product, week, units, stock, pack}.
export function parseSalesTable(table){
 let grid=table.filter(r=>r.some(c=>c!==null&&c!==undefined&&String(c).trim()!==''));
 if(grid.length&&grid.every(r=>r.filter(c=>String(c??'').trim()!=='').length===1)){
  const first=String(grid[0][0]),separator=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':first.includes('\t')?'\t':',';
  grid=grid.map(r=>splitCsv(String(r[0]),separator));
 }
 grid=grid.map(r=>r.map(c=>repairText(String(c??'').trim())));
 // The header is the first line naming the required columns (reports often start with a title).
 const at=grid.findIndex(r=>REQUIRED.every(k=>detectColumns(r)[k]!==undefined));
 if(at<0){const best=detectColumns(grid[0]||[]);throw Error('Colonnes introuvables : '+REQUIRED.filter(k=>best[k]===undefined).map(k=>LABELS[k]).join(', ')+'. Le fichier doit avoir une ligne par Metro, produit et date.');}
 const index=detectColumns(grid[at]),byKey=new Map();let skipped=0;
 for(const r of grid.slice(at+1)){
  const date=parseDate(r[index.date]),units=parseNumber(r[index.units]),metro=r[index.metro],sku=r[index.sku].toUpperCase();
  if(!date||units===null||!metro||!sku||/^total/i.test(metro)){skipped++;continue;}
  const week=weekOf(date),key=[metro,sku,week].join('|'),row=byKey.get(key)||{metro,sku,product:'',week,units:0,stock:null,stockDate:'',pack:null};
  row.units+=units;
  if(index.product!==undefined&&r[index.product])row.product=r[index.product];
  // Stock is a level, not a flow: keep the latest reading of the week.
  const stock=index.stock!==undefined?parseNumber(r[index.stock]):null;
  if(stock!==null&&date>=row.stockDate){row.stock=stock;row.stockDate=date;}
  const pack=index.pack!==undefined?parseNumber(r[index.pack]):null;if(pack>0)row.pack=Math.round(pack);
  byKey.set(key,row);
 }
 const rows=[...byKey.values()].map(({stockDate,...r})=>r);
 if(!rows.length)throw Error('Aucune ligne de vente lisible dans ce fichier.');
 return {rows:validateSalesRows(rows),skipped,hasStock:index.stock!==undefined};
}
export async function readSalesFile(name,buffer){
 const table=/\.xlsx$/i.test(name)?await readXlsx(buffer):new TextDecoder().decode(buffer).replace(/^﻿/,'').split(/\r?\n/).map(line=>[line]);
 return parseSalesTable(table);
}

export function validateSalesRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>60000)throw Error('Fichier de ventes vide ou trop volumineux.');
 const seen=new Set();
 return rows.map(r=>{
  const ok=typeof r?.metro==='string'&&r.metro.length>0&&r.metro.length<=120&&typeof r.sku==='string'&&/^[\w.\-/ ]{1,60}$/.test(r.sku)&&typeof (r.product??'')==='string'&&(r.product??'').length<=200
   &&/^\d{4}-\d{2}-\d{2}$/.test(r.week||'')&&weekOf(r.week)===r.week&&Number.isFinite(r.units)&&Math.abs(r.units)<1e7
   &&(r.stock===null||r.stock===undefined||Number.isFinite(r.stock)&&Math.abs(r.stock)<1e7)&&(r.pack===null||r.pack===undefined||Number.isInteger(r.pack)&&r.pack>0&&r.pack<1000);
  if(!ok)throw Error('Ligne de ventes invalide.');
  const key=[r.metro,r.sku,r.week].join('|');if(seen.has(key))throw Error('Semaine en double : '+key+'.');seen.add(key);
  return {metro:r.metro,sku:r.sku,product:r.product||'',week:r.week,units:r.units,stock:r.stock??null,pack:r.pack??null};
 });
}
// A new file replaces the weeks it covers for each Metro; other weeks are kept.
export function mergeSales(old,incoming){
 const covered=new Set(incoming.map(r=>r.metro+'|'+r.week));
 const all=[...old.filter(r=>!covered.has(r.metro+'|'+r.week)),...incoming];
 const last=all.reduce((m,r)=>r.week>m?r.week:m,''),floor=addDays(last,-7*(KEEP_WEEKS-1));
 return all.filter(r=>r.week>=floor).sort((a,b)=>a.metro.localeCompare(b.metro)||a.sku.localeCompare(b.sku)||a.week.localeCompare(b.week));
}
