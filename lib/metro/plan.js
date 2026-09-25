// Weekly Metro replenishment: the rules compute a quantity and its
// alternatives for each Metro and product; Jev then chooses among them.
// The rules are those of the Vanier replenishment tool (SUMTRACKER):
// coverage + lead time, safety multiplier, trend ±15 % (recent rhythm
// above 1.3× or below 0.7× the longer one), rounding up to the case.
import {addDays,weekOf} from './sales.js';

export const DEFAULT_SETTINGS={coverageDays:7,leadDays:3,safety:1.25};
export function validSettings(s){
 const c=s?.coverageDays,l=s?.leadDays,f=s?.safety;
 if(!Number.isInteger(c)||c<1||c>28||!Number.isInteger(l)||l<0||l>14||typeof f!=='number'||f<1||f>2)throw Error('Paramètres de commande invalides.');
 return {coverageDays:c,leadDays:l,safety:f};
}
// The order is for the next week that has not started yet.
export const planWeek=today=>weekOf(addDays(today,7));
const ceilTo=(q,pack)=>q<=0?0:Math.ceil(q/pack-1e-9)*pack;

// One line per Metro and product, with its weekly history (oldest first).
export function planLines(rows,settings,today){
 const {coverageDays,leadDays,safety}=validSettings(settings),week=planWeek(today);
 // Only complete weeks, and for each Metro only the weeks its files cover:
 // a week missing from the files is unknown, not zero.
 const complete=rows.filter(r=>addDays(r.week,6)<today);
 const weeksOf=new Map();for(const r of complete){if(!weeksOf.has(r.metro))weeksOf.set(r.metro,new Set());weeksOf.get(r.metro).add(r.week);}
 const groups=new Map();for(const r of complete){const k=r.metro+'|'+r.sku;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 const lines=[];
 for(const [key,list] of groups){
  const metro=list[0].metro,sku=list[0].sku,weeks=[...weeksOf.get(metro)].sort().slice(-12),byWeek=new Map(list.map(r=>[r.week,r]));
  const history=weeks.map(w=>({week:w,units:byWeek.get(w)?.units??0}));
  const units=history.map(h=>Math.max(0,h.units)),recent=units.slice(-4);
  const v4=recent.reduce((a,b)=>a+b,0)/Math.max(1,recent.length),v12=units.reduce((a,b)=>a+b,0)/Math.max(1,units.length);
  const trend=v12===0?'stable':v4>v12*1.3?'hausse':v4<v12*.7?'baisse':'stable';
  const latest=list.reduce((a,b)=>b.week>a.week?b:a),pack=[...list].reverse().find(r=>r.pack)?.pack||1,product=[...list].reverse().find(r=>r.product)?.product||'';
  const stock=latest.week===weeks.at(-1)?latest.stock:null,daily=v4/7,factor=trend==='hausse'?1.15:trend==='baisse'?.85:1;
  let raw,rule;
  if(v12===0){raw=0;rule='Aucune vente sur '+units.length+' semaine'+(units.length>1?'s':'')+'.';}
  else if(stock!==null){
   // Stock known: cover the period and the lead time, minus what is on the shelf.
   raw=(daily*(coverageDays+leadDays)*safety)*factor-Math.max(0,stock);
   rule=`${round(daily*7)} / sem. × ${coverageDays+leadDays} j × ${safety}${factor!==1?(factor>1?' +15 %':' −15 %'):''} − stock ${Math.max(0,stock)}`;
  }else{
   // Stock unknown: replace what sells during the period (no weekly safety, which would pile up).
   raw=daily*coverageDays*factor;
   rule=`${round(daily*7)} / sem. × ${coverageDays} j${factor!==1?(factor>1?' +15 %':' −15 %'):''} (stock inconnu : remplacement des ventes)`;
  }
  const base=ceilTo(raw,pack);
  const urgency=stock===null||daily===0?'normale':stock<daily*leadDays?'rupture':stock<daily*leadDays*2?'urgente':'normale';
  lines.push({key,metro,sku,product,week,pack,stock,history,v4:round(v4),v12:round(v12),trend,urgency,base,rule,candidates:candidates(base,pack,v12>0)});
 }
 return lines.sort((a,b)=>a.metro.localeCompare(b.metro)||a.product.localeCompare(b.product)||a.sku.localeCompare(b.sku));
}
const round=n=>Math.round(n*10)/10;
// Alternatives around the rule, one case apart. Labels are stable for Jev.
export function candidates(base,pack,sold){
 const out={aucune:0};
 if(base-pack>0)out.reduite=base-pack;
 if(base>0)out.regle=base;
 if(sold||base>0)out.hausse=base+pack;
 return out;
}
