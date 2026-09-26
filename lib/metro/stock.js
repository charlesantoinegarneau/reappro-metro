// Shelf stock of one Metro, from the replenishment export of the Shopify
// tool (« reappro-AAAA-MM-JJ-AAAA-MM-JJ », Excel or CSV): one line per
// product with its Shopify SKU, its name (« Marque - Produit — Variante »)
// and its stock. Matched to Metro's barcodes through the Shopify catalog:
// by SKU, else by exact name. A negative stock is an inventory error: it is
// kept apart (unknown), never used as a level.
import {decodeText,readXlsx,repairText,splitCsv} from '../xlsx.js';
import {barcodeKey,nameMatcher} from './catalog.js';

const norm=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/\s+/g,' ').trim();
const num=v=>{const s=String(v??'').replace(/[\s $]/g,'').replace(',','.');if(s==='')return null;const n=Number(s);return Number.isFinite(n)?n:null;};

// Table → [{sku, product, stock}].
export function parseStockTable(table){
 let grid=table.filter(r=>r.some(c=>String(c??'').trim()!==''));
 if(grid.length&&grid.every(r=>r.filter(c=>String(c??'').trim()!=='').length===1)){
  const first=String(grid[0][0]),separator=(first.match(/;/g)||[]).length>(first.match(/,/g)||[]).length?';':',';
  grid=grid.map(r=>splitCsv(String(r[0]),separator));
 }
 grid=grid.map(r=>r.map(c=>repairText(String(c??'').trim())));
 const header=(grid.shift()||[]).map(norm),at=name=>header.indexOf(name);
 const col={product:at('produit'),sku:at('sku'),stock:at('stock')};
 if(col.stock<0||col.sku<0&&col.product<0)throw Error('Colonnes introuvables : ce fichier doit avoir une colonne Stock et une colonne SKU ou Produit (export de réappro).');
 const rows=[];
 for(const r of grid){const stock=num(r[col.stock]);if(stock===null)continue;rows.push({sku:col.sku>=0?r[col.sku]:'',product:col.product>=0?r[col.product]:'',stock:Math.round(stock)});}
 if(!rows.length)throw Error('Aucune ligne de stock lisible dans ce fichier.');
 return rows;
}
export async function readStockFile(name,buffer){
 const table=/\.xlsx$/i.test(name)?await readXlsx(buffer):decodeText(buffer).split(/\r?\n/).map(line=>[line]);
 return parseStockTable(table);
}
// Date of the stock: the end of the period in « reappro-2025-09-27-2026-09-26 ».
export function stockDate(filename){const m=/(\d{4}-\d{2}-\d{2})\D*$/.exec(String(filename||'').replace(/\.\w+$/,''));return m?m[1]:null;}

export function validStockRows(rows){
 if(!Array.isArray(rows)||!rows.length||rows.length>20000)throw Error('Fichier de stock vide ou trop volumineux.');
 return rows.map(r=>{
  if(typeof r?.sku!=='string'||r.sku.length>200||typeof r.product!=='string'||r.product.length>300||!Number.isInteger(r.stock)||Math.abs(r.stock)>1e6)throw Error('Ligne de stock invalide.');
  return {sku:r.sku,product:r.product,stock:r.stock};
 });
}
// Rows + catalog → {items: {barcode: stock}, matched, unmatched}.
export function matchStock(rows,catalog){
 const bySku=new Map(),byName=nameMatcher(catalog);
 for(const [code,v] of Object.entries(catalog||{}))if(v.sku)bySku.set(norm(v.sku),code);
 const items={},unmatched=[];
 for(const r of rows){
  const code=(r.sku&&bySku.get(norm(r.sku)))||byName(r.product);
  if(code)items[barcodeKey(code)]=r.stock;else unmatched.push(r.product||r.sku);
 }
 return {items,matched:Object.keys(items).length,unmatched};
}
