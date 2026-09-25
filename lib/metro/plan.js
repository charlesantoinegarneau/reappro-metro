// Weekly Metro replenishment: the rules compute a quantity and its
// alternatives for each Metro and product; Jev then chooses among them.
// The rules are those of the Vanier replenishment tool (SUMTRACKER):
// coverage + lead time, safety multiplier, trend ±15 % (recent rhythm
// above 1.3× or below 0.7× the longer one), rounding up to the case.
// Adjusted to Metro's sales, a few units per product and week (backtest on
// three weeks of 2026: +39 % ordered vs sold with the Vanier rule, ~0 % with
// these): the rhythm blends the last 4 weeks with all weeks, the trend needs
// 12 units sold, and without a stock level the quantity is rounded to the
// nearest case rather than up.
import {addDays,weekOf} from './sales.js';
import {identify} from './catalog.js';

export const DEFAULT_SETTINGS={coverageDays:7,leadDays:3,safety:1.25};
export function validSettings(s){
 const c=s?.coverageDays,l=s?.leadDays,f=s?.safety;
 if(!Number.isInteger(c)||c<1||c>28||!Number.isInteger(l)||l<0||l>14||typeof f!=='number'||f<1||f>2)throw Error('Paramètres de commande invalides.');
 return {coverageDays:c,leadDays:l,safety:f};
}
// The order is for the next week that has not started yet.
export const planWeek=today=>weekOf(addDays(today,7));
const ceilTo=(q,pack)=>q<=0?0:Math.ceil(q/pack-1e-9)*pack;

// A week with no sale is a probable stock-out, not a lack of demand, when a
// zero was unlikely: at the Metro's own rhythm (other weeks), or across the
// network when the product sold nowhere although the Metros that carry it
// together sell it well (supplier back order). Zero sales at an expected
// rhythm λ happen with probability e^−λ: under 5 % from λ = 3 per week.
export const RUPTURE_RHYTHM=3;

// One line per Metro and product, with its weekly history (oldest first).
// `catalog` (Shopify export, by barcode) names the brand, product and variant.
export function planLines(rows,settings,today,catalog=null){
 const {coverageDays,leadDays,safety}=validSettings(settings),week=planWeek(today);
 // Only complete weeks.
 const complete=rows.filter(r=>addDays(r.week,6)<today);
 // For each Metro only the weeks its files cover (a week missing from the
 // files is unknown, not zero), minus its opening weeks: leading weeks
 // under half its median week (ramp-up) are not a sales rhythm.
 const weeksOf=new Map(),totals=new Map(),daysOf=new Map();
 for(const r of complete){daysOf.set(r.metro+'|'+r.week,r.days||7);const k=r.metro+'|'+r.week;totals.set(k,(totals.get(k)||0)+Math.max(0,r.units)*7/(r.days||7));if(!weeksOf.has(r.metro))weeksOf.set(r.metro,new Set());weeksOf.get(r.metro).add(r.week);}
 for(const [metro,set] of weeksOf){
  const weeks=[...set].sort(),sizes=weeks.map(w=>totals.get(metro+'|'+w)).sort((a,b)=>a-b),median=sizes[Math.floor((sizes.length-1)/2)]/2+sizes[Math.floor(sizes.length/2)]/2;
  for(const w of weeks){if(totals.get(metro+'|'+w)>=median/2)break;set.delete(w);}
 }
 const groups=new Map();for(const r of complete){if(!weeksOf.get(r.metro).has(r.week))continue;const k=r.metro+'|'+r.sku;if(!groups.has(k))groups.set(k,[]);groups.get(k).push(r);}
 // Weekly units scaled to 7 days, per Metro and product. Weeks before the
 // product's first sale anywhere in the network (not yet listed) are not
 // part of its history.
 const series=new Map(),launch=new Map();
 for(const [key,list] of groups){
  const metro=list[0].metro,sku=list[0].sku,weeks=[...weeksOf.get(metro)].sort().slice(-12),byWeek=new Map(list.map(r=>[r.week,r]));
  const history=weeks.map(w=>({week:w,units:byWeek.get(w)?.units??0,days:daysOf.get(metro+'|'+w),rupture:null}));
  for(const r of list)if(r.units>0&&(!launch.has(sku)||r.week<launch.get(sku)))launch.set(sku,r.week);
  series.set(key,{metro,sku,list,history});
 }
 for(const s of series.values()){
  const first=launch.get(s.sku);
  if(first)s.history=s.history.filter(h=>h.week>=first);
  s.scaled=s.history.map(h=>Math.max(0,h.units)*7/h.days);
  // Each week's rhythm expected from the product's other weeks at this Metro.
  const total=s.scaled.reduce((a,b)=>a+b,0);s.expected=s.scaled.map(u=>s.history.length>1?(total-u)/(s.history.length-1):0);
 }
 const network=new Map();
 for(const s of series.values())s.history.forEach((h,i)=>{const k=s.sku+'|'+h.week,n=network.get(k)||{sold:0,expected:0};n.sold+=s.scaled[i];n.expected+=s.expected[i];network.set(k,n);});
 for(const s of series.values())s.history.forEach((h,i)=>{
  if(s.scaled[i]>0)return;const n=network.get(s.sku+'|'+h.week);
  h.rupture=n.sold===0&&n.expected>=RUPTURE_RHYTHM?'reseau':s.expected[i]>=RUPTURE_RHYTHM?'magasin':null;
 });
 const lines=[];
 for(const [key,{metro,sku,list,history,scaled}] of series){
  // Probable stock-out weeks say nothing about demand: they are left out of the rhythm.
  const units=scaled.filter((u,i)=>!history[i].rupture),recent=units.slice(-4);
  const v4=recent.reduce((a,b)=>a+b,0)/Math.max(1,recent.length),v12=units.reduce((a,b)=>a+b,0)/Math.max(1,units.length);
  const sold=units.reduce((a,b)=>a+b,0),trend=v12===0||sold<12?'stable':v4>v12*1.3?'hausse':v4<v12*.7?'baisse':'stable';
  const latest=list.reduce((a,b)=>b.week>a.week?b:a),pack=[...list].reverse().find(r=>r.pack)?.pack||1,product=[...list].reverse().find(r=>r.product)?.product||'';
  const {brand,product:name,variant,cost}=identify(sku,product,catalog),ruptures=history.filter(h=>h.rupture).length,boNow=history.at(-1)?.rupture==='reseau';
  const stock=latest.week===history.at(-1)?.week?latest.stock:null,daily=(v4+v12)/2/7,factor=trend==='hausse'?1.15:trend==='baisse'?.85:1;
  let raw,rule;
  if(!history.length||v12===0){raw=0;rule='Aucune vente sur '+history.length+' semaine'+(history.length>1?'s':'')+'.';}
  else if(stock!==null){
   // Stock known: cover the period and the lead time, minus what is on the shelf.
   raw=(daily*(coverageDays+leadDays)*safety)*factor-Math.max(0,stock);
   rule=`${round(daily*7)} / sem. × ${coverageDays+leadDays} j × ${safety}${factor!==1?(factor>1?' +15 %':' −15 %'):''} − stock ${Math.max(0,stock)}`;
  }else{
   // Stock unknown: replace what sells during the period (no weekly safety, which would pile up).
   raw=daily*coverageDays*factor;
   rule=`${round(daily*7)} / sem. × ${coverageDays} j${factor!==1?(factor>1?' +15 %':' −15 %'):''} (stock inconnu : remplacement des ventes, arrondi)`;
  }
  const base=stock===null?Math.max(0,Math.round(raw/pack))*pack:ceilTo(raw,pack);
  const urgency=stock===null||daily===0?'normale':stock<daily*leadDays?'rupture':stock<daily*leadDays*2?'urgente':'normale';
  if(ruptures)rule+=` · ${ruptures} semaine${ruptures>1?'s':''} de rupture probable écartée${ruptures>1?'s':''}`;
  lines.push({key,metro,sku,product,brand,name,variant,cost,week,pack,stock,history,v4:round(v4),v12:round(v12),trend,urgency,base,rule,ruptures,boNow,candidates:candidates(base,pack,v12>0)});
 }
 // Network context for Jev: the same product's rhythm at the other Metros
 // (a single Metro's few units per week are noisy; the network is steadier).
 const others=new Map();for(const l of lines){const o=others.get(l.sku)||[];o.push(l);others.set(l.sku,o);}
 for(const l of lines){const o=others.get(l.sku).filter(x=>x.metro!==l.metro);l.network=o.length?{metros:o.length,rhythm:round(o.reduce((n,x)=>n+(x.v4+x.v12)/2,0)/o.length)}:null;}
 // Marque > Produit > Variante, as on the shelf.
 const by=(a,b)=>a.localeCompare(b,'fr',{sensitivity:'base'});
 return lines.sort((a,b)=>by(a.metro,b.metro)||by(a.brand,b.brand)||by(a.name,b.name)||by(a.variant,b.variant)||a.sku.localeCompare(b.sku));
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
