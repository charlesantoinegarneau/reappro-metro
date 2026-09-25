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
  return {metro:l.metro,sku:l.sku,product:l.product||'',qty:l.qty,base:Number.isInteger(l.base)?l.base:null,jevQty:l.jevQty??null,confidence:l.confidence??null,manual:l.manual===true};
 });
 return {week,settings,lines};
}
const cell=v=>{const s=String(v??'');return /[",;\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
// One file per Metro, only the lines to order, in the sheet's order.
export function orderCsv(lines,metro){
 return ['SKU,Produit,Quantité',...lines.filter(l=>l.metro===metro&&l.qty>0).map(l=>[l.sku,l.product,l.qty].map(cell).join(','))].join('\n')+'\n';
}
