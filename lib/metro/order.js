// Picking: a line is still to pick (''), picked, or removed from the order.
// `planned` keeps the quantity decided before picking, `qty` the one kept.
export const STATUSES=['','picked','removed'];
// A week's validated order: the quantity kept for each Metro and product,
// with what Jev chose, so the decisions can be compared with the sales later.
import {validSettings} from './plan.js';

export function validOrder(order,week){
 if(order?.week!==week)throw Error('La commande doit viser la semaine du '+week+'.');
 const settings=validSettings(order.settings);
 if(!Array.isArray(order.lines)||order.lines.length>5000)throw Error('Commande invalide.');
 const lines=order.lines.map(l=>{
  const ok=typeof l?.metro==='string'&&l.metro.length<=120&&typeof l.sku==='string'&&l.sku.length<=60&&typeof (l.product??'')==='string'&&(l.product??'').length<=200
   &&Number.isInteger(l.qty)&&l.qty>=0&&l.qty<100000&&(l.jevQty===null||l.jevQty===undefined||Number.isInteger(l.jevQty))&&(l.confidence===null||l.confidence===undefined||typeof l.confidence==='number'&&l.confidence>=0&&l.confidence<=1);
  if(!ok)throw Error('Ligne de commande invalide.');
  if(l.status!==undefined&&!STATUSES.includes(l.status)||l.planned!==undefined&&l.planned!==null&&!(Number.isInteger(l.planned)&&l.planned>=0))throw Error('Ligne de commande invalide.');
  return {metro:l.metro,sku:l.sku,product:l.product||'',qty:l.qty,planned:l.planned??null,status:l.status||'',base:Number.isInteger(l.base)?l.base:null,jevQty:l.jevQty??null,confidence:l.confidence??null,manual:l.manual===true};
 });
 return {week,settings,lines};
}
const cell=v=>{const s=String(v??'');return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
// One file per Metro, in the sheet's order: the lines kept (not removed) with a quantity.
export function orderCsv(lines,metro){
 const kept=lines.filter(l=>l.metro===metro&&l.status!=='removed'&&l.qty>0);
 return ['UPC,Marque,Produit,Variante,Quantité',...kept.map(l=>[l.sku,l.brand??'',l.name??l.product,l.variant??'',l.qty].map(cell).join(','))].join('\n')+'\n';
}
