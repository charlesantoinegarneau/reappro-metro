// Invoices « Commande interne — détails des coûts » (PDF): what the branch
// delivered to a Metro, on the day the invoice was created. The transfer is
// already in Shopify's stock, so an invoice only counts after the date of the
// Metro's stock file. Lines carry no barcode: they are matched to the Shopify
// catalog by their title « Marque - Produit — Variante ».
// The PDF is read in the browser (pdf.js); the server receives the lines.
import {METROS} from './sales.js';
import {barcodeKey,nameKey,nameMatcher} from './catalog.js';

const money=s=>Number(String(s).replace(/[\s  ]/g,'').replace(',','.'));
// « Métro Ste-Foy » → Ste-Foy.
export function metroOf(client){
 const k=nameKey(client).replace(/^metro\s*/,'');
 return Object.values(METROS).find(m=>nameKey(m)===k)||Object.values(METROS).find(m=>k.includes(nameKey(m)))||null;
}

// Text lines of the PDF → {number, date, client, metro, lines: [{qty, title, brand, cost, total}], declared: {lines, items}}.
export function parseInvoiceText(textLines){
 const all=textLines.map(l=>String(l).replace(/\s+/g,' ').trim()).filter(Boolean);
 const at=re=>all.findIndex(l=>re.test(l));
 const head=at(/^Commande interne/i);
 if(head<0)throw Error('Ce PDF n’est pas une facture « Commande interne ».');
 const number=/^\d{4,}$/.test(all[head+1]||'')?all[head+1]:null,date=/^(\d{4}-\d{2}-\d{2})/.exec(all[head+2]||'')?.[1]||null;
 const c=all.indexOf('CLIENT'),client=c>=0?all[c+1]||'':'';
 const details=/(\d+) lignes? • (\d+) items?/.exec(all.find(l=>/lignes? • \d+ items?/.test(l))||'');
 if(!number||!date)throw Error('Numéro ou date de facture introuvable.');
 // The item table, without the headers and footers the browser prints on each
 // page (« about:blank », the tool's address and the date, « Page 2 sur 8 »).
 const end=at(/^Sous-total/),body=all.slice(at(/^Image Qty Item/)+1,end<0?undefined:end)
  .filter(l=>!/^Image Qty Item/.test(l)&&!/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2} Invoice/.test(l)&&!/^(about:blank|https?:\/\/)/.test(l)&&!/^Page \d+ (sur|of) \d+$/.test(l));
 // A line: quantity, title (possibly wrapped), « brand Taxable|Non taxable », unit cost and total.
 // Cut by a page break, its pieces come in another order, glued to their
 // neighbours (« 12 Marque Taxable 2,50 $ 30,00 $ », « — Saveur 2,00 $ 14,00 $ »):
 // each piece is read on its own, and the line ends once it has them all.
 const PRICES=/(?:^| )(-?\d{1,3}(?: \d{3})*,\d{2}) \$ (-?\d{1,3}(?: \d{3})*,\d{2}) \$$/,TAX=/^(.*?) ?(Non taxable|Taxable)$/,QTY=/^(\d{1,5})(?: (.+))?$/;
 const lines=[];let row={title:[]};
 const close=()=>{
  const title=row.title.join(' ').trim();
  if(row.qty==null||!title||!row.tax||row.cost==null||Math.abs(row.qty*row.cost-row.total)>.05)throw Error(`Ligne illisible dans la facture : ${title||'(sans titre)'}.`);
  lines.push({qty:row.qty,title,brand:row.brand,cost:row.cost,total:row.total});row={title:[]};
 };
 for(let l of body){
  const p=PRICES.exec(l);
  if(p){if(row.cost!=null)close();row.cost=money(p[1]);row.total=money(p[2]);l=l.slice(0,p.index).trim();}
  // The quantity comes first, alone or glued to the line beside it.
  const q=row.qty==null&&QTY.exec(l);
  if(q){row.qty=Number(q[1]);l=q[2]||'';}
  const t=TAX.exec(l);
  if(t){row.brand=t[1].trim();row.tax=t[2];}else if(l)row.title.push(l);
  if(row.qty!=null&&row.title.length&&row.tax&&row.cost!=null)close();
 }
 if(row.qty!=null||row.tax||row.cost!=null)close();
 if(!lines.length)throw Error('Aucune ligne de produit lisible dans cette facture.');
 const declared=details?{lines:Number(details[1]),items:Number(details[2])}:null;
 if(declared&&(declared.lines!==lines.length||declared.items!==lines.reduce((n,l)=>n+l.qty,0)))throw Error(`Facture ${number} lue partiellement : ${lines.length} lignes sur ${declared.lines}.`);
 return {number,date,client,metro:metroOf(client),lines};
}

// PDF (ArrayBuffer) → text lines, in the browser.
export async function readInvoicePdf(buffer){
 const pdfjs=await import('pdfjs-dist');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('pdfjs-dist/build/pdf.worker.min.mjs',import.meta.url).toString();
 const doc=await pdfjs.getDocument({data:new Uint8Array(buffer)}).promise,out=[];
 for(let p=1;p<=doc.numPages;p++){
  const content=await (await doc.getPage(p)).getTextContent();let line='';
  for(const it of content.items){if(!('str' in it))continue;line+=it.str;if(it.hasEOL){out.push(line);line='';}}
  if(line)out.push(line);
 }
 return parseInvoiceText(out);
}

export function validInvoice(inv){
 const ok=typeof inv?.number==='string'&&/^\d{4,20}$/.test(inv.number)&&/^\d{4}-\d{2}-\d{2}$/.test(inv.date||'')&&typeof inv.metro==='string'&&Object.values(METROS).includes(inv.metro)
  &&Array.isArray(inv.lines)&&inv.lines.length>0&&inv.lines.length<=2000
  &&inv.lines.every(l=>Number.isInteger(l?.qty)&&l.qty>=0&&l.qty<1e5&&typeof l.title==='string'&&l.title.length>0&&l.title.length<=300&&typeof l.brand==='string'&&l.brand.length<=120&&Number.isFinite(l.cost)&&Number.isFinite(l.total));
 if(!ok)throw Error('Facture invalide.');
 return {number:inv.number,date:inv.date,metro:inv.metro,lines:inv.lines.map(({qty,title,brand,cost,total})=>({qty,title,brand,cost,total}))};
}
// Lines + catalog → {items: {barcode: qty}, matched, unmatched: [titles]}.
export function matchInvoice(lines,catalog){
 const byName=nameMatcher(catalog),items={},unmatched=[];
 for(const l of lines){const code=byName(l.title);if(code){const k=barcodeKey(code);items[k]=(items[k]||0)+l.qty;}else unmatched.push(l.title);}
 return {items,matched:Object.keys(items).length,unmatched};
}
