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
 const col={handle:at('Handle'),title:at('Title'),vendor:at('Vendor'),barcode:at('Variant Barcode'),sku:at('Variant SKU'),cost:at('Cost per item'),options:['Option1 Value','Option2 Value','Option3 Value'].map(at)};
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
  addVariant(out,code,{brand:first.brand||'Autre',product:first.product,variant,cost:Number.isFinite(cost)&&cost>=0?cost:null,sku:col.sku>=0?r[col.sku]||'':''});
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
  const cost=v?.cost??null,also=v?.also??[];
  if(!/^\d{1,20}$/.test(code)||typeof v?.brand!=='string'||typeof v.product!=='string'||typeof (v.variant??'')!=='string'||v.brand.length>120||v.product.length>250||(v.variant??'').length>200||cost!==null&&!(Number.isFinite(cost)&&cost>=0&&cost<100000)||typeof (v.sku??'')!=='string'||(v.sku??'').length>200
   ||!Array.isArray(also)||also.length>100||also.some(a=>typeof a?.sku!=='string'||a.sku.length>200||typeof a.product!=='string'||a.product.length>250||typeof (a.variant??'')!=='string'||(a.variant??'').length>200))throw Error('Catalogue invalide.');
  out[code]={brand:v.brand,product:v.product,variant:v.variant||'',cost,sku:v.sku||''};
  if(also.length)out[code].also=also.map(a=>({sku:a.sku,product:a.product,variant:a.variant||''}));
 }
 return out;
}
// Product names as Shopify writes them (« Marque - Produit — Variante »), for
// the stock files and the invoices. Dashes and apostrophes vary between
// Shopify, its exports and the PDF.
export const nameKey=s=>String(s??'').normalize('NFD').replace(/\p{Diacritic}/gu,'').replace(/[‐-―−]/g,'-').replace(/[‘’ʼ`]/g,"'").toLowerCase().replace(/\s+/g,' ').trim();
// Catalog → title → barcode (or null). Exact name first, then the same name
// without punctuation (« Whey-X 4.4lb » / « Whey-X - 4.4lb »), then the same
// words in any order, units (« 2 lbs » / « 2lb »), plurals and small words
// (de, et, &) aside, product and variant each on their own. Every word counts:
// one word apart is another product (Whey-Z / Casein-Z, Sunset / Sunset+),
// another flavour (Punch / Punch Tropical) or another format (400g / 1000g).
// A name shared by two products matches neither.
// Only « Dernière Chance », added to a title when the article is cleared out,
// is left aside: the article and its barcode stay the same.
const compact=s=>nameKey(s).replace(/ - default title$/,'').replace(/[^a-z0-9+]/g,'');
const UNITS={lbs:'lb',gr:'g',grs:'g',gramme:'g',grammes:'g',caps:'capsules',capsule:'capsules'};
const SMALL=new Set(['a','and','au','aux','avec','d','de','des','du','et','l','la','le','les','of','the','with']);
const words=s=>nameKey(s).replace(/\bderniere chance\b/g,' ').replace(/(\d)\s+(lbs?|grs?|g|kg|ml|l|oz)\b/g,'$1$2').replace(/\+/g,' + ').split(/[^a-z0-9.+]+/).map(w=>w.replace(/\.$/,'')).filter(w=>w&&w!=='default'&&w!=='title'&&!SMALL.has(w)).map(w=>UNITS[w]||w.replace(/^(\d+(?:\.\d+)?)(lbs|gr|grs)$/,(m,n,u)=>n+UNITS[u]));
// Plural and feminine endings: « Barres chocolatées » / « Barre chocolatée ».
const stem=w=>/^[a-z]{4,}$/.test(w)?w.replace(/[sx]$/,'').replace(/ee$/,'e'):w;
const wordKey=(product,variant)=>[product,variant].map(s=>[...new Set(words(s).map(stem))].sort().join(' ')).join('|');
// The product may hold « – » itself (« Atlas – Citrulline – 300g »): every cut is tried.
const cuts=s=>{const parts=String(s).split(/\s[—–]\s/);return parts.map((_,i)=>wordKey(parts.slice(0,i+1).join(' '),parts.slice(i+1).join(' ')));};
const unique=(map,k,code)=>map.set(k,map.has(k)&&map.get(k)!==code?null:code);
// Several Shopify variants may share a barcode: the same article sold
// « Gratuit! » or cleared out « Dernière Chance! » with its lot (« 01/2026 »),
// but also, by mistake, another flavour or the box of 12. The catalog keeps the
// last one read and lists the others in `also`; only those naming the same
// article, these labels aside, lead to its barcode (SKU and name).
const LABELS=/\bgratuit\b|\b\d{1,2}\/\d{4}\b/g;
const articleKey=v=>wordKey(nameKey(v.product).replace(LABELS,' '),nameKey(v.variant).replace(LABELS,' '));
export const articleVariants=v=>[v,...(v.also||[]).filter(a=>articleKey(a)===articleKey(v))];
export function addVariant(items,code,v){
 const prev=items[code];
 if(!prev){items[code]=v;return items;}
 const {also:before=[],...p}=prev,{also:after=[],...n}=v;
 items[code]={...n,also:[...before,{sku:p.sku||'',product:p.product,variant:p.variant||''},...after]};
 return items;
}
export function nameMatcher(catalog){
 const exact=new Map(),loose=new Map(),same=new Map();
 for(const [code,entry] of Object.entries(catalog||{}))for(const v of articleVariants(entry)){
  const name=v.variant?`${v.product} — ${v.variant}`:v.product;
  exact.set(nameKey(name),code);if(!v.variant)exact.set(nameKey(`${v.product} — Default Title`),code);
  unique(loose,compact(name),code);unique(same,wordKey(v.product,v.variant||''),code);
 }
 return title=>{
  const e=exact.get(nameKey(title))||loose.get(compact(title));if(e)return e;
  const found=new Set(cuts(title).filter(k=>same.has(k)).map(k=>same.get(k)));
  return found.size===1?[...found][0]:null;
 };
}

// The catalog wins when it knows the barcode; the description otherwise.
export const identify=(sku,description,catalog)=>catalog?.[barcodeKey(sku)]||{...describe(description),cost:null};
