// Jev (TypeSafe, through the Netlify AI Gateway) chooses each line's quantity
// among the rule's alternatives and gives the probability of each one.
// Jev does not write text: it answers typed questions with calibrated
// probabilities, so the rules supply the options and Jev weighs them.
import {choice} from '@typesafe-ai/sdk';

export const CHUNK=20;
// Below this confidence the line is marked for a second look.
export const REVIEW_BELOW=.6;
const DESCRIPTIONS={
 aucune:q=>`${q} unité : ne rien commander cette semaine (ventes nulles, produit en fin de vie ou stock suffisant).`,
 reduite:q=>`${q} unités : une caisse de moins que la règle (ventes en baisse, semaine exceptionnelle à ne pas reconduire, stock encore bon).`,
 regle:q=>`${q} unités : la quantité calculée par la règle.`,
 hausse:q=>`${q} unités : une caisse de plus que la règle (ventes en hausse, risque de rupture, dernière semaine sous le rythme normal par manque de stock).`
};
const RULES=['Shop Santé réapprovisionne chaque semaine les rayons de suppléments de quatre Metros.',
 'La règle couvre la période de commande (et le délai de livraison si le stock est connu) au rythme des 4 dernières semaines, arrondi à la caisse supérieure.',
 'Tendance : « hausse » si le rythme des 4 dernières semaines dépasse 1,3 fois celui des 12 semaines (+15 %), « baisse » s’il est sous 0,7 fois (−15 %).',
 'Les semaines sont les plus anciennes d’abord. Une semaine isolée très forte (promotion, livraison initiale) ne doit pas être reconduite; une rupture de stock (0 vendu entre de bonnes semaines) ne signifie pas que la demande a disparu.',
 'Éviter la rupture est plus important que d’éviter une caisse de trop, sauf pour un produit sans ventes récentes.'];

export function jevRequest(lines,settings){
 const state={contexte:RULES,parametres:{jours_couverts:settings.coverageDays,delai_livraison_jours:settings.leadDays,multiplicateur_securite:settings.safety},lignes:{}},questions={};
 lines.forEach((l,i)=>{
  const id='l'+i;
  state.lignes[id]={metro:l.metro,produit:l.product||l.sku,sku:l.sku,semaine_commandee:l.week,ventes_hebdo:l.history.map(h=>h.units),rythme_4_sem:l.v4,rythme_12_sem:l.v12,tendance:l.trend,stock:l.stock,colis:l.pack,urgence:l.urgency,calcul:l.rule};
  questions[id]=choice(`Ligne ${id} (${l.metro}, ${l.product||l.sku}) : quelle quantité commander pour la semaine du ${l.week}?`,Object.fromEntries(Object.entries(l.candidates).map(([k,q])=>[k,DESCRIPTIONS[k](q)])));
 });
 return {state,questions};
}

// Lines with a single possible answer (nothing sold, nothing to order) skip Jev.
export async function decideLines(client,lines,settings){
 const asked=lines.filter(l=>Object.keys(l.candidates).length>1),out=new Map();
 for(const l of lines)if(!asked.includes(l))out.set(l.key,{key:l.key,label:'aucune',qty:0,confidence:1,probabilities:{aucune:1},expected:0,source:'regle',review:false});
 if(asked.length){
  let answers=null,failure='';
  try{
   if(!client)throw Error('Jev n’est pas configuré (Netlify AI Gateway).');
   answers=(await client.systemOne(jevRequest(asked,settings),{timeout:25000})).answers;
  }catch(e){failure=e?.message||'Jev indisponible.';}
  asked.forEach((l,i)=>{
   const a=answers?.['l'+i];
   if(!a||!(a.choice in l.candidates)){
    const label=l.base>0?'regle':'aucune';
    out.set(l.key,{key:l.key,label,qty:l.candidates[label],confidence:null,probabilities:null,expected:null,source:'regle',review:true,note:failure||'Réponse de Jev incomplète : règle appliquée.'});
    return;
   }
   const probabilities=Object.fromEntries(Object.keys(l.candidates).map(k=>[k,a.probabilities[k]??0]));
   const expected=Object.entries(probabilities).reduce((n,[k,p])=>n+p*l.candidates[k],0);
   out.set(l.key,{key:l.key,label:a.choice,qty:l.candidates[a.choice],confidence:a.confidence,probabilities,expected:Math.round(expected*10)/10,source:'jev',review:a.confidence<REVIEW_BELOW});
  });
 }
 return lines.map(l=>out.get(l.key));
}
