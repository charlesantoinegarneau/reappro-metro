// Brand, product and variant of each article, to sort the order sheet by
// Marque > Produit > Variante.
// - From the Shopify product export (Produits → Exporter, CSV), matched on the
//   variant barcode: exact brand (Vendor), product (Title), variant and unit
//   cost (Cost per item), which prices each order and guides Jev.
// - Otherwise from Metro's description ("SS NOVA PHARMA ÉLECT. BARB.FRAMB.250G"):
//   the brand is recognised from its abbreviations, the rest is the product.
import {decodeText,repairText,splitCsv} from '../xlsx.js';

const plain=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toUpperCase();
// Longest spellings first: Metro abbreviates the same brand several ways.
const BRANDS=[
 ['NOVA PHARMA','Nova Pharma'],['NOVAPHARMA','Nova Pharma'],['NOVAPHARM','Nova Pharma'],['NOVPHARM','Nova Pharma'],
 ['GO NUTRITION','Go Nutrition'],['GONUTRITION','Go Nutrition'],['GO NUTR','Go Nutrition'],
 ['YUMMY SPORTS','Yummy Sports'],['YUMMYSPORTS','Yummy Sports'],
 ['SHOP SANTE','Shop Santé'],['SHOPSANTE','Shop Santé'],
 ['BOITE SANTE','Boîte Santé'],['AV.DOREE','Avoine Dorée'],['AVOINE DOR','Avoine Dorée'],['AVOINE','Avoine Dorée'],
 ['GIRL POWER','Girl Power'],['GIRL PWER','Girl Power'],['GIRL P','Girl Power'],
 ['GOOD PROTEIN','Good Protein'],['OMAHA PROTEIN','Omaha Protein'],['PROTEIN2O','Protein2o'],
 ['PROTEIN CAND','Protein Candy'],['PROT CAND','Protein Candy'],['PROTCAND','Protein Candy'],
 ['SLIM SYRUP','Slim Syrups'],['SLIM SUGAR','Slim Syrups'],['SLIMFIEL','Slimfield'],
 ['SMART SWEETS','SmartSweets'],['SMSWEETS','SmartSweets'],['LITTLE BITES','Little Bites'],['LITTLE GOODS','Little Goods'],
 ['FITCOOKFOODZ','Fitcook'],['FITCOOK','Fitcook'],['BEHY','Behy'],['JUJU\'S','Juju’s'],['JUJUS','Juju’s'],['JUJU','Juju’s'],['NAAK','Näak'],
 ['AKTIV','Aktiv'],['ALANINU','Alaninu'],['ALLMAX','Allmax'],['ATP','ATP'],['BAREBELLS','Barebells'],['BELIEVE','Believe'],
 ['C4','C4'],['CBUM','CBUM'],['CWENCH','Cwench'],['ELEV8','Elev8'],['GHOST','Ghost'],['GRENADE','Grenade'],['KRONO','Krono'],
 ['MINDBLOW','Mindblow'],['NIH','NIH'],['PROBITES','Probites'],['QUEST','Quest'],['RYSE','Ryse'],['SANA','Sana'],['SINFIT','Sinfit'],
 ['SPARK','Spark'],['TC','TC'],['TEANGLE','Teangle'],['UPIKA','Upika'],['XPN','XPN']
];
const title=s=>s.toLowerCase().replace(/(^|[\s'-])\p{L}/gu,c=>c.toUpperCase());
// Metro description → {brand, product, variant}.
export function describe(description){
 const raw=String(description||'').trim();
 // Every Metro description starts with "SS " (Shop Santé), sometimes glued ("SSFITCOOK").
 for(const text of [raw.replace(/^SS\s+/i,''),raw.replace(/^SS/i,'')]){
  const key=plain(text);
  for(const [prefix,brand] of BRANDS){
   // Short spellings (ATP, TC, C4) must end at a word boundary; longer ones may be glued ("BEHYBOISHYDRA").
   if(key.startsWith(prefix)&&(prefix.length>=4||key.length===prefix.length||/[\s.'-]/.test(key[prefix.length])))
    return {brand,product:text.slice(prefix.length).replace(/^[\s.'-]+/,'')||text,variant:''};
  }
 }
 const [first,...rest]=raw.replace(/^SS\s+/i,'').split(/\s+/);
 return {brand:first?title(first):'Autre',product:rest.join(' ')||raw,variant:''};
}

// Barcodes: Metro writes UPC/EAN with or without leading zeros.
export const barcodeKey=s=>String(s??'').replace(/\D/g,'').replace(/^0+/,'');

// Shopify product export (CSV) → {barcode: {brand, product, variant}}.
// Title and Vendor are only on a product's first line: they are carried down
// to its variant lines by Handle.
export function parseShopifyExport(text){
 const lines=text.replace(/^﻿/,'').split(/\r?\n/);
 // Quoted cells may contain line breaks (descriptions): rebuild whole records.
 const records=[];let buffer='';
 for(const line of lines){buffer=buffer?buffer+'\n'+line:line;if(((buffer.match(/"/g)||[]).length%2)===0){records.push(buffer);buffer='';}}
 const header=splitCsv(records.shift()||'').map(h=>h.trim()),at=name=>header.indexOf(name);
 const col={handle:at('Handle'),title:at('Title'),vendor:at('Vendor'),barcode:at('Variant Barcode'),cost:at('Cost per item'),options:['Option1 Value','Option2 Value','Option3 Value'].map(at)};
 if(col.handle<0||col.title<0||col.vendor<0||col.barcode<0)throw Error('Ce fichier n’est pas un export de produits Shopify (colonnes Handle, Title, Vendor, Variant Barcode).');
 const byHandle=new Map(),out={};
 for(const record of records){
  if(!record.trim())continue;
  const r=splitCsv(record).map(c=>repairText(c.trim())),handle=r[col.handle];if(!handle)continue;
  const first=byHandle.get(handle)||{};
  if(r[col.title])first.product=r[col.title];if(r[col.vendor])first.brand=r[col.vendor];byHandle.set(handle,first);
  const code=barcodeKey(r[col.barcode]);if(!code||!first.product)continue;
  const variant=col.options.map(i=>i>=0?r[i]:'').filter(v=>v&&v!=='Default Title').join(' / ');
  const cost=col.cost>=0&&r[col.cost]!==''?Number(r[col.cost].replace(',','.')):null;
  out[code]={brand:first.brand||'Autre',product:first.product,variant,cost:Number.isFinite(cost)&&cost>=0?cost:null};
 }
 if(!Object.keys(out).length)throw Error('Aucun code-barres de variante dans cet export Shopify.');
 return out;
}
export async function readCatalogFile(buffer){return parseShopifyExport(decodeText(buffer));}
export function validCatalog(catalog){
 const entries=Object.entries(catalog||{});
 if(!entries.length||entries.length>50000)throw Error('Catalogue vide ou trop volumineux.');
 const out={};
 for(const [code,v] of entries){
  const cost=v?.cost??null;
  if(!/^\d{1,20}$/.test(code)||typeof v?.brand!=='string'||typeof v.product!=='string'||typeof (v.variant??'')!=='string'||v.brand.length>120||v.product.length>250||(v.variant??'').length>200||cost!==null&&!(Number.isFinite(cost)&&cost>=0&&cost<100000))throw Error('Catalogue invalide.');
  out[code]={brand:v.brand,product:v.product,variant:v.variant||'',cost};
 }
 return out;
}
// The catalog wins when it knows the barcode; the description otherwise.
export const identify=(sku,description,catalog)=>catalog?.[barcodeKey(sku)]||{...describe(description),cost:null};
